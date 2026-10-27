// Opt-in: npm exec -- tsx tests/importacao.audit.ts (em backend).
// Usa PostgreSQL real com fixtures e migration inteiramente revertidas por ROLLBACK.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import express from "express";
import type { Server } from "node:http";
import { pool } from "../src/db";
import router from "../src/importacao/importacao.routes";
import { importId } from "../src/importacao/importacao.plan";
import { createSettlement, deleteSettlement } from "../src/lancamentos/settlement.service";
import { updateLaunch } from "../src/lancamentos/lancamentos.service";
import { accessFixture } from "./fixtures/access";
import bancos from "../src/bancos/bancos.routes";
import formas from "../src/formas_pagamento/formas_pagamento.routes";
import contas from "../src/lancamentos/lancamentos.routes";
import recebimentos from "../src/recebimentos/recebimentos.routes";
import movimentacoes from "../src/movimentacoes/movimentacoes.routes";
import caixa from "../src/caixa/caixa.routes";
import { historicalRecordId } from "../src/utils/access-import";

async function run() {
    const client = await pool.connect(), originalConnect = pool.connect, originalQuery = pool.query;
    let server: Server | undefined, sequence = 0, failInsert = false;
    const user = randomUUID(), input = accessFixture();
    input.filiais = { "1": randomUUID(), "2": randomUUID(), "3": randomUUID() };
    try {
        await client.query("BEGIN");
        const migration = await readFile("migrations/009_desconto_acrescimo_lancamentos.sql", "utf8");
        await client.query(migration.replace(/^BEGIN;/, "").replace(/COMMIT;\s*$/, ""));
        await client.query("INSERT INTO users (id, nome, email, password_hash, role, ativo) VALUES ($1, 'Teste importação', $2, 'sem-login', 'admin', TRUE)", [user, `${user}@audit.invalid`]);
        for (const company of Object.values(input.filiais)) {
            await client.query("INSERT INTO empresas (id, nome, ativo, licenca_expira_em) VALUES ($1, 'Teste importação', TRUE, CURRENT_TIMESTAMP + INTERVAL '1 year')", [company]);
            await client.query("INSERT INTO users_empresas (user_id, empresa_id, perfil) VALUES ($1, $2, 'admin')", [user, company]);
        }
        pool.query = ((sql: string, values?: unknown[]) => client.query(sql, values)) as typeof pool.query;
        pool.connect = (async () => {
            const point = `import_test_${++sequence}`;
            return { release() {}, async query(sql: string, values?: unknown[]) {
                if (sql === "BEGIN") return client.query(`SAVEPOINT ${point}`);
                if (sql === "COMMIT") return client.query(`RELEASE SAVEPOINT ${point}`);
                if (sql === "ROLLBACK") return client.query(`ROLLBACK TO SAVEPOINT ${point}`);
                if (failInsert && sql.startsWith("INSERT INTO formas_pagamento")) throw new Error("Falha simulada de persistência");
                return client.query(sql, values);
            } };
        }) as typeof pool.connect;
        const app = express();
        app.use(express.json({ limit: "12mb" }));
        app.use((req, _res, next) => { req.session = { user: req.header("x-test-anonymous") ? undefined : { id: user } } as typeof req.session; next(); });
        app.use("/importacao", router);
        app.use("/bancos", bancos); app.use("/formas-pagamento", formas); app.use("/lancamentos", contas);
        app.use("/recebimentos", recebimentos); app.use("/movimentacoes", movimentacoes); app.use("/caixa", caixa);
        server = app.listen(0, "127.0.0.1");
        await new Promise<void>(resolve => server!.once("listening", resolve));
        const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        async function request(body = input, extraHeaders: Record<string, string> = {}) {
            const response = await fetch(base + "/importacao/access", { method: "POST", headers: { "Content-Type": "application/json", "x-empresa-id": input.filiais["1"], ...extraHeaders }, body: JSON.stringify(body) });
            return { status: response.status, body: await response.json() };
        }
        assert.equal((await request(input, { "x-test-anonymous": "1" })).status, 401);
        assert.equal((await request({ ...input, filiais: { ...input.filiais, "3": randomUUID() } })).status, 403);
        assert.equal((await request(input, { "x-empresa-id": input.filiais["2"] })).status, 400);
        assert.equal((await request()).status, 200);
        const count = async () => Number((await client.query("SELECT COUNT(*) AS n FROM pessoas WHERE empresa_id = ANY($1::uuid[])", [Object.values(input.filiais)])).rows[0].n);
        assert.equal(await count(), 0, "Simulação não grava pessoas");
        failInsert = true;
        assert.equal((await request({ ...input, simular: false })).status, 500);
        assert.equal(await count(), 0, "Falha reverte inclusive cadastros já inseridos");
        failInsert = false;
        await client.query("SAVEPOINT before_fixture_import");
        const response = await request({ ...input, simular: false });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.totais.baixas, 3);
        const launches = await client.query("SELECT id, tipo, valor, desconto, acrescimo, status FROM lancamentos WHERE empresa_id = ANY($1::uuid[]) ORDER BY tipo", [Object.values(input.filiais)]);
        assert.equal(launches.rowCount, 3);
        const paid = launches.rows.find(row => row.tipo === "pagar");
        assert.equal(Number(paid.valor), 100); assert.equal(Number(paid.desconto), 10); assert.equal(Number(paid.acrescimo), 5); assert.equal(paid.status, "pago");
        assert.equal((await client.query("SELECT ativo FROM formas_pagamento WHERE empresa_id = $1", [input.filiais["1"]])).rows[0].ativo, false);
        assert.equal((await client.query("SELECT COUNT(DISTINCT empresa_id) AS n FROM pessoas WHERE nome = 'Cliente com conta' AND empresa_id = ANY($1::uuid[])", [Object.values(input.filiais)])).rows[0].n, "2");
        assert.equal((await request({ ...input, simular: false })).status, 409, "Repetição não duplica registros");
        await assert.rejects(updateLaunch(input.filiais["1"], paid.id, { desconto: 20 }), /total já baixado/);
        const partialId = importId(input.filiais["1"], "lancamentos", "1:1");
        await updateLaunch(input.filiais["1"], partialId, { desconto: 10 });
        const formId = importId(input.filiais["1"], "formas_pagamento", "1");
        await client.query("UPDATE formas_pagamento SET ativo = TRUE WHERE empresa_id = $1 AND id = $2", [input.filiais["1"], formId]);
        const serviceClient = await pool.connect() as PoolClient;
        await assert.rejects(createSettlement(serviceClient, input.filiais["1"], "recebimentos", { lancamentoId: partialId, formaPagamentoId: formId, valor: 51 }), /maior que o saldo/);
        const payment = await createSettlement(serviceClient, input.filiais["1"], "recebimentos", { lancamentoId: partialId, formaPagamentoId: formId, valor: 50 });
        assert.equal(payment.status, "pago");
        await deleteSettlement(serviceClient, input.filiais["1"], "recebimentos", payment.id);
        assert.equal((await client.query("SELECT status FROM lancamentos WHERE empresa_id = $1 AND id = $2", [input.filiais["1"], partialId])).rows[0].status, "parcial");
        await client.query("ROLLBACK TO SAVEPOINT before_fixture_import");
        const historical = structuredClone(input);
        historical.simular = false;
        historical.arquivos["recebimentos.txt"] = historical.arquivos["recebimentos.txt"].split("\r\n").filter(line => !line.startsWith('"1";') && !line.startsWith('"3";')).join("\r\n");
        historical.arquivos["contas_a_receber.txt"] = historical.arquivos["contas_a_receber.txt"].replace('"R$ 40,00"', '"R$ 80,00"').replace('"2";"2";"1";"1";"Serviço 2"', '"2";"2";"3";"1";"Serviço 2"');
        historical.arquivos["pessoas.txt"] += '\r\n"3";"";"";"1"';
        const historyResponse = await request(historical);
        assert.equal(historyResponse.status, 201, JSON.stringify(historyResponse.body));
        assert.equal(historyResponse.body.totais.baixas_historicas, 3);
        assert.equal(historyResponse.body.totais.valor_baixas_historicas, 185);
        assert.equal(historyResponse.body.totais.contas_sem_cliente, 1);
        const namelessAccount = await client.query("SELECT pessoa_id, status FROM lancamentos WHERE empresa_id = $1 AND id = $2", [input.filiais["2"], importId(input.filiais["2"], "lancamentos", "1:2")]);
        assert.equal(namelessAccount.rows[0].pessoa_id, null); assert.equal(namelessAccount.rows[0].status, "pago");
        async function api(path: string, method = "GET", body?: Record<string, unknown>, company = input.filiais["1"]) {
            const result = await fetch(base + path, { method, headers: { "Content-Type": "application/json", "x-empresa-id": company }, body: body ? JSON.stringify(body) : undefined });
            return { status: result.status, body: await result.json() };
        }
        for (const company of [input.filiais["1"], input.filiais["2"]]) {
            for (const [path, table] of [["/bancos", "bancos"], ["/formas-pagamento", "formas_pagamento"]]) {
                const id = historicalRecordId(company, table)!;
                assert.equal((await client.query(`SELECT ativo FROM ${table} WHERE empresa_id = $1 AND id = $2`, [company, id])).rows[0].ativo, false);
                for (const suffix of ["", "?ativo=false", "?descricao=Baixa%20hist%C3%B3rica"])
                    assert.equal((await api(path + suffix, "GET", undefined, company)).body.data.some((row: { id: string }) => row.id === id), false);
                assert.equal((await api(path + "/" + id, "GET", undefined, company)).status, 404);
                assert.equal((await api(path + "/" + id.toUpperCase(), "PATCH", { ativo: true, descricao: "Reativar" }, company)).status, 409);
                assert.equal((await api(path + "/" + id, "DELETE", undefined, company)).status, 409);
            }
        }
        const historicalBank = historicalRecordId(input.filiais["1"], "bancos")!, historicalForm = historicalRecordId(input.filiais["1"], "formas_pagamento")!;
        const newAccount = { descricao: "Conta normal", tipo: "receber", valor: 100, data_vencimento: "2026-10-20" };
        assert.equal((await api("/lancamentos", "POST", { ...newAccount, banco_id: historicalBank.toUpperCase() })).status, 400);
        assert.equal((await api("/lancamentos/parcelado", "POST", { ...newAccount, parcelas: 2, banco_id: historicalBank })).status, 400);
        assert.equal((await api("/lancamentos/" + partialId, "PATCH", { banco_id: historicalBank })).status, 400);
        assert.equal((await api("/formas-pagamento", "POST", { descricao: "Forma normal", tipo: "pix", banco_id: historicalBank })).status, 400);
        assert.equal((await api("/formas-pagamento/" + formId, "PATCH", { banco_id: historicalBank })).status, 400);
        // Mesmo que alguém reative o cadastro diretamente no banco, a API continua recusando o UUID reservado.
        await client.query("UPDATE formas_pagamento SET ativo = TRUE WHERE empresa_id = $1 AND id = $2", [input.filiais["1"], historicalForm]);
        const normalPayment = { lancamento_id: partialId, forma_pagamento_id: historicalForm.toUpperCase(), valor: 1 };
        assert.equal((await api("/recebimentos", "POST", normalPayment)).status, 400);
        assert.equal((await api("/lancamentos/" + partialId + "/baixar", "POST", { forma_pagamento_id: historicalForm, valor: 1 })).status, 400);
        assert.equal((await api("/lancamentos", "POST", { ...newAccount, forma_pagamento_id: historicalForm })).status, 400);
        assert.equal((await api("/lancamentos", "POST", { ...newAccount, desconto: 100, forma_pagamento_id: historicalForm })).status, 400);
        assert.equal((await api("/movimentacoes", "POST", { ...normalPayment, lancamento_id: paid.id })).status, 400);
        const detailed = await api("/recebimentos");
        assert.equal(detailed.status, 200);
        const historicalPayment = detailed.body.data.find((row: { forma_pagamento_id: string }) => row.forma_pagamento_id === historicalForm);
        assert.equal(historicalPayment.forma_pagamento_descricao, "Baixa histórica");
        assert.equal((await api("/recebimentos/" + historicalPayment.id)).body.data.forma_pagamento_descricao, "Baixa histórica");
        assert.equal((await api("/recebimentos/" + historicalPayment.id, "PATCH", { valor: 1 })).status, 409);
        const normalRecord = detailed.body.data.find((row: { forma_pagamento_id: string }) => row.forma_pagamento_id === formId);
        assert.equal((await api("/recebimentos/" + normalRecord.id, "PATCH", { forma_pagamento_id: historicalForm })).status, 400);
        const cash = await api("/caixa");
        assert.equal(cash.status, 200);
        assert.equal(cash.body.saldo_atual, -15);
        assert.equal(cash.body.data.filter((row: { forma_pagamento: string; instituicao: string }) => row.forma_pagamento === "Baixa histórica" && row.instituicao === "Baixa histórica").length, 2);
        assert.equal((await request(historical)).status, 409);
        console.log("PASS: importação normal/histórica, complemento, cliente nulo, rollback, duplicação, isolamento, cadastros ocultos e bloqueados por UUID, detalhes e caixa preservados.");
    } finally {
        if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
        pool.connect = originalConnect; pool.query = originalQuery;
        await client.query("ROLLBACK"); client.release(); await pool.end();
    }
}
run().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
