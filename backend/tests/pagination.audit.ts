// Opt-in: npm exec -- tsx tests/pagination.audit.ts (a partir de backend).
// Exercita PostgreSQL real e HTTP; todos os dados de teste são revertidos.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import { pool } from "../src/db";
import accounts from "../src/lancamentos/lancamentos.routes";
import people from "../src/pessoas/pessoas.routes";
import payments from "../src/movimentacoes/movimentacoes.routes";
import receipts from "../src/recebimentos/recebimentos.routes";
import forms from "../src/formas_pagamento/formas_pagamento.routes";
import banks from "../src/bancos/bancos.routes";
import plans from "../src/planos_contas/planos_contas.routes";
import cash from "../src/caixa/caixa.routes";

async function run() {
    const client = await pool.connect(), originalQuery = pool.query, originalConnect = pool.connect;
    const user = randomUUID(), ids = [randomUUID(), randomUUID()];
    let server: Server | undefined, sequence = 0, passed = 0;
    let queryQueue = Promise.resolve();
    const transactionQuery = (sql: string, values?: unknown[]) => {
        const result = queryQueue.then(() => client.query(sql, values));
        queryQueue = result.then(() => undefined, () => undefined);
        return result;
    };
    const check = (label: string) => { passed++; console.log(`PASS ${label}`); };
    try {
        await client.query("BEGIN");
        await client.query("INSERT INTO users (id,nome,email,password_hash,role,ativo) VALUES ($1,'Auditoria paginação',$2,'sem-login','comum',TRUE)", [user, `${user}@audit.invalid`]);
        for (const [index, id] of ids.entries()) {
            await client.query("INSERT INTO empresas (id,nome,identificador,ativo,licenca_expira_em) VALUES ($1,'Auditoria paginação',$2,TRUE,CURRENT_TIMESTAMP + INTERVAL '1 year')", [id, `AUD-${index}`]);
            await client.query("INSERT INTO users_empresas (user_id,empresa_id,perfil) VALUES ($1,$2,'comum')", [user, id]);
            await client.query(`INSERT INTO pessoas (empresa_id,nome,documento,celular,cliente,fornecedor)
                SELECT $1, 'Pessoa ' || lpad(n::text,3,'0'), '123.456.' || lpad(n::text,3,'0') || '-00', '(11) 99999-0000', n % 2 = 0, n % 2 = 1 FROM generate_series(1,80) n`, [id]);
            await client.query(`INSERT INTO lancamentos (empresa_id,descricao,valor,tipo,status,data_vencimento,pessoa_id)
                SELECT $1, CASE WHEN n > 60 THEN 'Descrição repetida' ELSE 'Conta ' || lpad(n::text,3,'0') END, 100,
                    CASE WHEN n % 2 = 0 THEN 'receber' ELSE 'pagar' END, 'pendente',
                    CASE WHEN n % 2 = 0 THEN '2026-10-31'::date ELSE '2026-10-01'::date END,
                    (SELECT id FROM pessoas WHERE empresa_id=$1 ORDER BY nome LIMIT 1)
                FROM generate_series(1,70) n`, [id]);
        }
        const form = (await client.query("INSERT INTO formas_pagamento (empresa_id,descricao,tipo) VALUES ($1,'Pix auditoria','pix') RETURNING id", [ids[0]])).rows[0].id;
        const account = (await client.query("SELECT id FROM lancamentos WHERE empresa_id=$1 AND tipo='pagar' ORDER BY id LIMIT 1", [ids[0]])).rows[0].id;
        await client.query(`INSERT INTO movimentacoes (empresa_id,lancamento_id,forma_pagamento_id,valor,data_movimentacao)
            SELECT $1,$2,$3,1,'2026-10-01'::date FROM generate_series(1,70)`, [ids[0], account, form]);
        await client.query("UPDATE lancamentos SET status='parcial' WHERE empresa_id=$1 AND id=$2", [ids[0], account]);
        const receiving = (await client.query("SELECT id FROM lancamentos WHERE empresa_id=$1 AND tipo='receber' LIMIT 1", [ids[0]])).rows[0].id;
        await client.query("INSERT INTO recebimentos (empresa_id,lancamento_id,forma_pagamento_id,valor,data_recebimento) VALUES ($1,$2,$3,25,'2026-10-31')", [ids[0], receiving, form]);
        await client.query("UPDATE lancamentos SET status='parcial' WHERE empresa_id=$1 AND id=$2", [ids[0], receiving]);
        pool.query = transactionQuery as typeof pool.query;
        pool.connect = (async () => {
            const savepoint = `pagination_${++sequence}`;
            return { release() {}, query(sql: string, values?: unknown[]) {
                return transactionQuery(sql === "BEGIN" ? `SAVEPOINT ${savepoint}` : sql === "COMMIT" ? `RELEASE SAVEPOINT ${savepoint}` : sql === "ROLLBACK" ? `ROLLBACK TO SAVEPOINT ${savepoint}` : sql, values);
            } };
        }) as typeof pool.connect;
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => { req.session = { user: { id: user } } as typeof req.session; next(); });
        app.get("/auth/me", (_req, res) => res.json({ data: { id: user, nome: "Auditoria", role: "comum", email: "audit@audit.invalid" } }));
        app.get("/empresas", (_req, res) => res.json({ data: ids.map((id, index) => ({ id, nome: `Empresa ${index}`, identificador: `AUD-${index}`, perfil: "comum", licenca_status: "ativa" })) }));
        app.use("/lancamentos", accounts); app.use("/pessoas", people);
        app.use("/movimentacoes", payments); app.use("/recebimentos", receipts); app.use("/formas-pagamento", forms);
        app.use("/bancos", banks); app.use("/planos-contas", plans); app.use("/caixa", cash);
        server = app.listen(0, "127.0.0.1");
        await new Promise<void>(resolve => server!.once("listening", resolve));
        const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        async function request(path: string, status = 200, options: RequestInit = {}) {
            const response = await fetch(base + path, { ...options, headers: { "x-empresa-id": ids[0]!, "Content-Type": "application/json", ...options.headers } });
            const body = await response.json();
            assert.equal(response.status, status, JSON.stringify(body));
            return body;
        }
        const scope = `empresas=${ids.join(",")}&pagina=1&tamanho=50`;
        const first = await request(`/lancamentos?${scope}&ordem=data_vencimento&direcao=asc`);
        assert.equal(first.data.length, 50); assert.equal(first.meta.total, 140); assert.equal(first.meta.paginas, 3);
        assert.equal(typeof first.data[0].valor, "string"); assert.equal(typeof first.data[0].numero, "string");
        assert.equal(Number(first.meta.pagar), 6930); assert.equal(Number(first.meta.receber), 6975);
        const second = await request(`/lancamentos?${scope.replace("pagina=1", "pagina=2")}&ordem=data_vencimento&direcao=asc`);
        assert.equal(second.data.length, 50); assert.ok(second.data.every((row: { id: string }) => !first.data.some((item: { id: string }) => item.id === row.id)));
        assert.deepEqual((await request(`/lancamentos?${scope}&ordem=data_vencimento&direcao=asc`)).data, first.data);
        const last = await request(`/lancamentos?${scope.replace("pagina=1", "pagina=999")}`);
        assert.equal(last.meta.pagina, 3); assert.equal(last.data.length, 40);
        check("paginação coletiva, ordem estável, totais completos e ajuste da última página");
        const dates = await request(`/lancamentos?${scope}&data_inicial=2026-10-31&data_final=2026-10-31&mostrar_em_aberto=true&mostrar_pagos=false`);
        assert.equal(dates.meta.total, 70); assert.equal(Number(dates.meta.receber), 6975);
        assert.equal((await request(`/lancamentos?${scope}&mostrar_em_aberto=false&mostrar_pagos=false`)).meta.total, 0);
        assert.equal((await request(`/lancamentos?${scope}&busca=Pessoa%20001`)).meta.total, 140);
        assert.equal((await request(`/lancamentos?${scope}&busca=inexistente`)).meta.total, 0);
        assert.equal((await request(`/lancamentos?${scope}&busca=%25`)).meta.total, 0);
        assert.equal((await request(`/lancamentos?${scope}&forma_pagamento_id=${form}`)).meta.total, 2);
        check("período inclusivo, busca por pessoa/descrição, status e forma antes da paginação");
        assert.equal((await request(`/pessoas?${scope}&mostrar_clientes=true&mostrar_fornecedores=false`)).meta.total, 80);
        assert.equal((await request(`/pessoas?${scope}&mostrar_clientes=false&mostrar_fornecedores=false`)).meta.total, 0);
        assert.equal((await request(`/pessoas?${scope}&busca=12345600100`)).meta.total, 2);
        check("filtros de pessoas e CPF com ou sem formatação");
        const unified = await request(`/movimentacoes?${scope}&unificadas=true&ordem=data_baixa`);
        assert.equal(unified.meta.total, 71); assert.equal(unified.data.length, 50);
        assert.equal((await request(`/movimentacoes?${scope}&unificadas=true&data_inicial=2026-10-31&data_final=2026-10-31`)).meta.total, 1);
        assert.equal((await request(`/movimentacoes?${scope}&unificadas=true&mostrar_pagamentos=false`)).meta.total, 1);
        assert.equal((await request(`/movimentacoes?${scope}&lancamento_id=${account}`)).meta.total, 70);
        check("baixas unificadas e detalhes por conta com filtros no SQL");
        const cashPage = await request(`/caixa?${scope}&saldo_inicial=100`);
        const cashNext = await request(`/caixa?${scope.replace("pagina=1", "pagina=2")}&saldo_inicial=100`);
        assert.equal(cashPage.meta.total, 71); assert.equal(cashPage.saldo_atual, 55);
        assert.equal(cashPage.data[49].saldo_depois, cashNext.data[0].saldo_antes);
        assert.equal(cashNext.data.at(-1).saldo_depois, 55);
        check("caixa conserva saldo acumulado entre páginas e saldo final global");
        const summary = await request(`/lancamentos?empresas=${ids.join(",")}&resumo=dashboard`);
        assert.equal(Number(summary.data.pagar), 6930); assert.equal(Number(summary.data.receber), 6975);
        assert.equal(Number(summary.data.totalPaid), 95); assert.ok(summary.data.rows.length <= 6); assert.equal(summary.data.flowRows.length, 2);
        const alert = await request(`/lancamentos?empresas=${ids.join(",")}&resumo=alertas`);
        assert.ok(alert.data.overdueRows.length <= 5); assert.ok(!("flowRows" in alert.data));
        const suggestions = await request(`/lancamentos?${scope}&opcoes=descricoes&busca=repetida`);
        assert.equal(suggestions.meta.total, 1); assert.equal(suggestions.data.length, 1);
        check("dashboard agregado, alertas limitados e descrições sem duplicação");
        await request(`/pessoas?${scope}&pagina=0`, 400);
        await request(`/pessoas?${scope}&tamanho=1000`, 400);
        await request(`/lancamentos?${scope}&ordem=id;SELECT`, 400);
        await request(`/lancamentos?${scope}&data_inicial=invalida`, 400);
        await request(`/lancamentos?empresas=${ids[0]},${randomUUID()}&pagina=1`, 403);
        await request(`/lancamentos?empresas=invalida&pagina=1`, 400);
        assert.equal((await request(`/lancamentos?empresas=${ids[0]},${ids[0]!.toUpperCase()}&pagina=1`)).meta.total, 70);
        check("validação e autorização de todas as empresas, sem resultados parciais");
        const before = (await request(`/lancamentos?pagina=1&busca=Conta&status=pendente`)).meta.total;
        const remove = (await request(`/lancamentos?pagina=999&tamanho=1&busca=Conta&status=pendente`)).data[0];
        const deleted = await fetch(base + "/lancamentos/" + remove.id, { method: "DELETE", headers: { "x-empresa-id": ids[0]! } });
        assert.equal(deleted.status, 204);
        const adjusted = await request(`/lancamentos?pagina=${before}&tamanho=1&busca=Conta&status=pendente`);
        assert.equal(adjusted.meta.total, before - 1); assert.equal(adjusted.meta.pagina, before - 1); assert.equal(adjusted.data.length, 1);
        check("exclusão na última página mantém a listagem em uma página existente");
        if (process.env.PAGINATION_UI === "1") {
            const { auditUi } = await import("./pagination-ui.audit");
            await auditUi(base, ids, account);
            check("requests no Chromium: carga sob demanda, paginação, filtros, seletores e baixa");
        }
        if (process.env.PAGINATION_PERF === "1") {
            await queryQueue;
            const { auditPerformance } = await import("./pagination-performance.audit");
            await auditPerformance(client, ids[0]!, form);
            check("EXPLAIN ANALYZE confirma uso dos três índices com 6000 contas e 36000 baixas adicionais");
        }
        await queryQueue;
        await client.query("INSERT INTO pessoas (empresa_id,nome,cliente,fornecedor) VALUES ($1,'Legada sem vínculo',FALSE,FALSE)", [ids[0]]);
        const legacy = await request(`/pessoas?${scope}&busca=Legada&mostrar_clientes=true&mostrar_fornecedores=true`);
        assert.equal(legacy.meta.total, 1); assert.equal(legacy.meta.sem_vinculo, 1);
        assert.equal((await request(`/pessoas?${scope}&busca=Legada&mostrar_clientes=true&mostrar_fornecedores=false`)).meta.total, 0);
        check("pessoa legada permanece acessível e o indicador é calculado no conjunto filtrado");
        console.log(`TOTAL PASS: ${passed}`);
    } finally {
        if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
        pool.query = originalQuery; pool.connect = originalConnect;
        await queryQueue;
        await client.query("ROLLBACK"); client.release(); await pool.end();
    }
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
