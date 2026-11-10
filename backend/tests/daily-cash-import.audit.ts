// SQL e HTTP reais apenas com fixtures sintéticas, revertidas por transação externa.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import type { Server } from "node:http";
import { pool } from "../src/db";
import router from "../src/importacao/importacao.routes";
import { historicalRecordId } from "../src/utils/access-import";
import { cashFixture, cashText, cashHeader } from "./fixtures/daily-cash";
import { cashColumns } from "../src/importacao/caixa-diario.plan";
import { dailyCashImportId } from "../src/caixa/caixa-diario.service";

async function run() {
    const client = await pool.connect(), originalQuery = pool.query, originalConnect = pool.connect;
    const fixture = cashFixture(), company = fixture.filiais["1"].empresa_id, mapping = fixture.filiais["1"];
    const user = randomUUID(), foreign = randomUUID(), bank = randomUUID();
    let server: Server | undefined, sequence = 0;
    try {
        await client.query("BEGIN");
        const migration = (await readFile("migrations/015_caixa_diario.sql", "utf8")).replace(/^BEGIN;\s*/, "").replace(/COMMIT;\s*$/, "");
        await client.query(migration);
        await client.query("INSERT INTO users (id,nome,email,password_hash,role,ativo) VALUES ($1,'Teste Importação Caixa',$2,'sem-login','comum',TRUE)", [user, `${user}@audit.invalid`]);
        for (const id of [company, foreign]) await client.query("INSERT INTO empresas (id,nome,ativo,licenca_expira_em) VALUES ($1,'Teste Importação Caixa',TRUE,CURRENT_TIMESTAMP + INTERVAL '1 year')", [id]);
        await client.query("INSERT INTO users_empresas (user_id,empresa_id,perfil) VALUES ($1,$2,'comum')", [user, company]);
        await client.query("INSERT INTO bancos (id,empresa_id,descricao) VALUES ($1,$2,'Banco teste')", [bank, company]);
        await client.query("INSERT INTO tipos_caixa_diario (id,empresa_id,descricao) VALUES ($1,$2,'Service/Zaal')", [mapping.tipo_caixa_diario_id, company]);
        for (const column of cashColumns) await client.query("INSERT INTO formas_pagamento (id,empresa_id,descricao,tipo,banco_id) VALUES ($1,$2,$3,'outro',$4)", [mapping.formas[column], company, column, bank]);
        pool.query = (async (sql: string, values?: unknown[]) => client.query(sql, values)) as typeof pool.query;
        pool.connect = (async () => {
            const point = `cash_import_${++sequence}`;
            return { release() {}, query: (sql: string, values?: unknown[]) => client.query(
                sql === "BEGIN" ? `SAVEPOINT ${point}` : sql === "COMMIT" ? `RELEASE SAVEPOINT ${point}` : sql === "ROLLBACK" ? `ROLLBACK TO SAVEPOINT ${point}` : sql, values) };
        }) as typeof pool.connect;
        const app = express(); app.use(express.json());
        app.use((req, _res, next) => { req.session = { user: req.header("x-test-anonymous") ? undefined : { id: user } } as typeof req.session; next(); });
        app.use("/importacao", router);
        server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server!.once("listening", resolve));
        const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        async function request(body: unknown, anonymous = false) {
            const response = await fetch(`${base}/importacao/caixa-diario`, { method: "POST", headers: { "content-type": "application/json", "x-empresa-id": company, ...(anonymous ? { "x-test-anonymous": "true" } : {}) }, body: JSON.stringify(body) });
            return { status: response.status, body: await response.json() };
        }
        assert.equal((await request(fixture, true)).status, 401);
        assert.equal((await request({ ...fixture, data_inicial: "inválida" })).status, 400);
        assert.equal((await request({ ...fixture, filiais: { "1": { ...mapping, empresa_id: foreign } } })).status, 403);
        const before = await client.query("SELECT count(*)::int AS n FROM lancamentos WHERE empresa_id = $1", [company]);
        const preview = await request(fixture);
        assert.equal(preview.status, 200, JSON.stringify(preview.body));
        assert.equal(preview.body.quantidade, 1); assert.equal(preview.body.total, 63.3);
        assert.equal(preview.body.dias[1].status, "pendente");
        assert.equal(preview.body.dias[1].valores_formulario.baixas.length, 3);
        assert.equal(preview.body.dias[1].valores_formulario.valor, 60);
        assert.equal((await client.query("SELECT count(*)::int AS n FROM lancamentos WHERE empresa_id = $1", [company])).rows[0].n, before.rows[0].n);
        const manual = { ...fixture, acao: "manual", chave: "1:2025-01-03", valores: preview.body.dias[1].valores_formulario };
        const invalidManual = await request({ ...manual, valores: { ...manual.valores, valor: 1 } });
        assert.equal(invalidManual.status, 409); // A baixa excede o total; conta e baixas são revertidas.
        assert.equal((await client.query("SELECT count(*)::int AS n FROM lancamentos WHERE empresa_id = $1", [company])).rows[0].n, before.rows[0].n);
        assert.equal((await request(manual)).status, 201);
        assert.equal((await request(manual)).status, 409);
        const resolved = { ...fixture, resolvidos: [manual.chave] };
        const previewResolved = await request(resolved);
        assert.equal(previewResolved.body.conflitos.length, 0);
        assert.equal(previewResolved.body.dias[1].status, "resolvido");
        const imported = await request({ ...resolved, acao: "importar" });
        assert.equal(imported.status, 201, JSON.stringify(imported.body));
        assert.equal(imported.body.importados, 1);
        const repeated = await request({ ...resolved, acao: "importar" });
        assert.equal(repeated.status, 201); assert.equal(repeated.body.importados, 0); assert.equal(repeated.body.ignorados, 1);
        const conflicts = await request(resolved);
        assert.deepEqual(conflicts.body.conflitos, [{ filial: "1", data: "2025-01-02" }]);
        const saved = await client.query("SELECT id, valor, status, to_char(competencia AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS competencia FROM lancamentos WHERE empresa_id = $1 ORDER BY data_vencimento", [company]);
        assert.equal(saved.rows.length, 2); assert.equal(Number(saved.rows[0].valor), 63.3);
        assert.equal(saved.rows[0].id, dailyCashImportId(company, "2025-01-02"));
        assert.equal(saved.rows[0].status, "pago"); assert.ok(saved.rows[0].competencia.startsWith("2025-01-01"));
        const receiptTotal = await client.query("SELECT sum(valor)::text AS total, count(*)::int AS n FROM recebimentos WHERE empresa_id=$1", [company]);
        assert.equal(receiptTotal.rows[0].n, 6); assert.equal(Number(receiptTotal.rows[0].total), 123.3);

        // Injeção de falha de persistência no segundo dia, depois que o primeiro já foi inserido.
        const failing = { ...fixture, acao: "importar", arquivo: [cashHeader + ';Receita_Service;Receita_Zaal;Despesas', ...['1/2/2025', '2/2/2025'].map(date => ['1',date,'Service/Zaal','','','','','','','R$ 10,00','',''].join(';'))].join('\r\n') };
        const wrappedConnect = pool.connect;
        pool.connect = (async () => {
            const transaction = await wrappedConnect.call(pool);
            const query = transaction.query.bind(transaction);
            transaction.query = (async (sql: string, values?: unknown[]) => {
                if (sql.includes("INSERT INTO lancamentos") && values?.includes(dailyCashImportId(company, "2025-02-02"))) throw new Error("Falha controlada no segundo dia");
                return query(sql, values);
            }) as typeof transaction.query;
            return transaction;
        }) as typeof pool.connect;
        assert.equal((await request(failing)).status, 500);
        pool.connect = wrappedConnect;
        assert.equal((await client.query("SELECT count(*)::int AS n FROM lancamentos WHERE empresa_id=$1", [company])).rows[0].n, 2);

        // Após a carga automática, ainda é possível resolver outro dia negativo sem conflito com os dias importados.
        const later = { ...fixture, arquivo: `${fixture.arquivo}\r\n1;5/1/2025;Service/Zaal;R$ 10,00;R$ 20,00;;-R$ 2,00;;`, acao: "manual", chave: "1:2025-01-05", valores: { ...manual.valores, data: "2025-01-05", valor: 30, baixas: manual.valores.baixas.slice(0, 2) } };
        assert.equal((await request(later)).status, 201);
        const mixed = { ...resolved, arquivo: fixture.arquivo + '\r\n1;6/1/2025;Service/Zaal;R$ 10,00;;;;;\r\n1;7/1/2025;Service/Zaal;R$ 15,00;;;;;' };
        const mixedPreview = await request(mixed);
        assert.equal(mixedPreview.body.quantidade, 2); assert.equal(mixedPreview.body.total, 25);
        assert.equal(mixedPreview.body.ignorados, 1); assert.equal(mixedPreview.body.total_ignorado, 63.3);
        // Um concorrente grava outro dia depois da prévia.
        assert.equal((await request({ ...fixture, arquivo: cashText('1;6/1/2025;Service/Zaal;R$ 10,00;;;;;'), acao: 'importar' })).body.importados, 1);
        const mixedResult = await request({ ...mixed, acao: 'importar' });
        assert.equal(mixedResult.status, 201); assert.equal(mixedResult.body.importados, 1);
        assert.equal(mixedResult.body.ignorados, 2); assert.equal(mixedResult.body.total, 15);
        assert.deepEqual(mixedResult.body.dias_importados, [{ filial: '1', data: '2025-01-07' }]);
        // Históricos sem mapeamento de formas: prévia não cria cadastros; gravação usa IDs por empresa.
        const foreignType = randomUUID();
        await client.query("INSERT INTO users_empresas (user_id,empresa_id,perfil) VALUES ($1,$2,'comum')", [user, foreign]);
        await client.query("INSERT INTO tipos_caixa_diario (id,empresa_id,descricao) VALUES ($1,$2,'Service/Zaal')", [foreignType, foreign]);
        const historical = { ...fixture, filiais: { '1': { ...mapping, formas: {} }, '2': { empresa_id: foreign, tipo_caixa_diario_id: foreignType, formas: {} } },
            arquivo: [cashHeader + ';Receita_Service;Receita_Zaal;Despesas',
                ['1','8/1/2025','Service/Zaal','','R$ 0,00','','R$ 0,00','R$ 900,00','R$ 700,00','R$ 100,10','R$ 20,20','R$ 10,05'].join(';'),
                ['2','8/1/2025','Service/Zaal','','','','','','','R$ 30,00','','R$ 5,00'].join(';'),
                ['1','9/1/2025','Service/Zaal','','','','','','','R$ 10,00','','R$ 15,00'].join(';'),
                ['1','10/1/2025','Service/Zaal','','','','','','','R$ 10,00','','R$ 10,00'].join(';')].join('\r\n') };
        const historicalPreview = await request(historical);
        assert.equal(historicalPreview.status, 200, JSON.stringify(historicalPreview.body));
        assert.equal(historicalPreview.body.quantidade, 2); assert.equal(historicalPreview.body.total, 135.25);
        assert.equal(historicalPreview.body.dias[2].status, 'pendente');
        assert.equal(historicalPreview.body.dias[2].valores_formulario.baixas.length, 0);
        assert.equal((await client.query('SELECT id FROM bancos WHERE id=$1', [historicalRecordId(company, 'bancos')])).rows.length, 0);
        assert.equal((await request({ ...historical, acao: 'importar' })).body.importados, 2);
        const historicalRows = await client.query(`SELECT r.valor, r.data_recebimento::text AS data, r.empresa_id, f.id AS forma, f.ativo, l.status
            FROM recebimentos r JOIN formas_pagamento f ON f.id=r.forma_pagamento_id JOIN lancamentos l ON l.id=r.lancamento_id
            WHERE f.id = ANY($1::uuid[]) ORDER BY r.valor`, [[historicalRecordId(company, 'formas_pagamento'), historicalRecordId(foreign, 'formas_pagamento')]]);
        assert.equal(historicalRows.rows.length, 2);
        for (const row of historicalRows.rows) { assert.equal(row.forma, historicalRecordId(row.empresa_id, 'formas_pagamento')); assert.equal(row.ativo, false); assert.equal(row.status, 'pago'); assert.equal(row.data, '2025-01-08'); }
        assert.equal(Number(historicalRows.rows[0].valor), 25); assert.equal(Number(historicalRows.rows[1].valor), 110.25);
        assert.equal((await request({ ...historical, acao: 'importar' })).body.importados, 0);
        console.log("PASS importação SQL/HTTP: prévia sem escrita, mapeamentos, pendência integral, resolução manual, conflitos, reenvio, datas, baixas e rollback da carga inteira.");
    } finally {
        if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
        pool.query = originalQuery; pool.connect = originalConnect;
        await client.query("ROLLBACK"); client.release(); await pool.end();
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
