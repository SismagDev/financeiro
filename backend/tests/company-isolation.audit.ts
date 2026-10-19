// Auditoria opt-in: executar em backend com `node --import tsx tests/company-isolation.audit.ts`.
// SQL real em uma conexão com rollback externo; apenas a sessão HTTP é fornecida pelo teste.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import { pool } from "../src/db";
import pessoas from "../src/pessoas/pessoas.routes";
import bancos from "../src/bancos/bancos.routes";
import formas from "../src/formas_pagamento/formas_pagamento.routes";
import planos from "../src/planos_contas/planos_contas.routes";
import contas from "../src/lancamentos/lancamentos.routes";
import pagamentos from "../src/movimentacoes/movimentacoes.routes";
import recebimentos from "../src/recebimentos/recebimentos.routes";

type Fixture = { empresa: string; pessoa: string; banco: string; forma: string; plano: string; pagar: string; receber: string; pagamento: string; recebimento: string };
type Body = Record<string, unknown>;
const tables = ["pessoas", "bancos", "formas_pagamento", "planos_contas", "lancamentos", "movimentacoes", "recebimentos"];

async function run() {
    const client = await pool.connect();
    const originalQuery = pool.query;
    const originalConnect = pool.connect;
    let server: Server | undefined;
    let passed = 0;
    const failures: { scenario: string; error: string }[] = [];
    const user = randomUUID();
    const fixtures: Fixture[] = [];
    try {
        await client.query("BEGIN");
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '120s'");
        await client.query("INSERT INTO users (id, nome, email, password_hash, role, ativo) VALUES ($1, 'Auditoria isolada', $2, 'sem-login', 'comum', TRUE)", [user, `${user}@audit.invalid`]);
        for (let index = 0; index < 3; index++) {
            const f: Fixture = Object.fromEntries(["empresa", "pessoa", "banco", "forma", "plano", "pagar", "receber", "pagamento", "recebimento"].map(key => [key, randomUUID()])) as Fixture;
            fixtures.push(f);
            await client.query("INSERT INTO empresas (id, nome, ativo, licenca_expira_em) VALUES ($1, $2, TRUE, CURRENT_TIMESTAMP + INTERVAL '1 year')", [f.empresa, `Auditoria ${index}`]);
            if (index < 2) await client.query("INSERT INTO users_empresas (user_id, empresa_id, perfil) VALUES ($1, $2, 'comum')", [user, f.empresa]);
            await client.query("INSERT INTO pessoas (id, empresa_id, nome, cliente, fornecedor) VALUES ($1, $2, 'Pessoa auditoria', TRUE, FALSE)", [f.pessoa, f.empresa]);
            await client.query("INSERT INTO bancos (id, empresa_id, descricao) VALUES ($1, $2, 'Banco auditoria')", [f.banco, f.empresa]);
            await client.query("INSERT INTO formas_pagamento (id, empresa_id, descricao, tipo, banco_id) VALUES ($1, $2, 'Forma auditoria', 'pix', $3)", [f.forma, f.empresa, f.banco]);
            await client.query("INSERT INTO planos_contas (id, empresa_id, descricao) VALUES ($1, $2, 'Plano auditoria')", [f.plano, f.empresa]);
            for (const tipo of ["pagar", "receber"] as const) {
                await client.query("INSERT INTO lancamentos (id, empresa_id, descricao, valor, tipo, status, data_vencimento, competencia, pessoa_id, banco_id, plano_conta_id) VALUES ($1, $2, 'Conta auditoria', 1000, $3, 'parcial', CURRENT_DATE, date_trunc('month', CURRENT_TIMESTAMP), $4, $5, $6)", [f[tipo], f.empresa, tipo, f.pessoa, f.banco, f.plano]);
            }
            await client.query("INSERT INTO movimentacoes (id, empresa_id, lancamento_id, forma_pagamento_id, valor, data_movimentacao) VALUES ($1,$2,$3,$4,10,CURRENT_DATE)", [f.pagamento, f.empresa, f.pagar, f.forma]);
            await client.query("INSERT INTO recebimentos (id, empresa_id, lancamento_id, forma_pagamento_id, valor, data_recebimento) VALUES ($1,$2,$3,$4,10,CURRENT_DATE)", [f.recebimento, f.empresa, f.receber, f.forma]);
        }

        // Encaminha os routers reais à mesma transação externa. Transações dos services
        // viram savepoints, para que nenhum COMMIT da aplicação persista as fixtures.
        pool.query = ((sql: string, values?: unknown[]) => client.query(sql, values)) as typeof pool.query;
        let serviceNumber = 0;
        pool.connect = (async () => {
            const savepoint = `audit_service_${++serviceNumber}`;
            return { release() {}, query(sql: string, values?: unknown[]) {
                if (sql === "BEGIN") return client.query(`SAVEPOINT ${savepoint}`);
                if (sql === "COMMIT") return client.query(`RELEASE SAVEPOINT ${savepoint}`);
                if (sql === "ROLLBACK") return client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
                return client.query(sql, values);
            } };
        }) as typeof pool.connect;
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => { req.session = { user: req.header("x-audit-anonymous") ? undefined : { id: user } } as typeof req.session; next(); });
        for (const [path, router] of [["pessoas", pessoas], ["bancos", bancos], ["formas-pagamento", formas], ["planos-contas", planos], ["lancamentos", contas], ["movimentacoes", pagamentos], ["recebimentos", recebimentos]] as const) app.use("/" + path, router);
        server = app.listen(0, "127.0.0.1");
        await new Promise<void>(resolve => server!.once("listening", resolve));
        const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        async function request(path: string, method: string, body?: Body, empresa?: string, anonymous = false) {
            const headers: Record<string, string> = { "content-type": "application/json" };
            if (empresa !== undefined) headers["x-empresa-id"] = empresa;
            if (anonymous) headers["x-audit-anonymous"] = "1";
            const response = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
            return { status: response.status, body: await response.json() };
        }
        async function snapshot() {
            const snapshots: unknown[] = [];
            for (const table of tables) snapshots.push((await client.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE empresa_id = ANY($1::uuid[]) ORDER BY id`, [fixtures.map(f => f.empresa)])).rows);
            return snapshots;
        }
        async function scenario(name: string, action: () => Promise<void>) {
            await client.query("SAVEPOINT audit_case");
            try { await action(); passed++; }
            catch (error) { failures.push({ scenario: name, error: error instanceof Error ? error.message : String(error) }); }
            finally { await client.query("ROLLBACK TO SAVEPOINT audit_case"); await client.query("RELEASE SAVEPOINT audit_case"); }
        }
        const a = fixtures[0]!, b = fixtures[1]!, outsider = fixtures[2]!;
        const configs = [
            { path: "/pessoas", table: "pessoas", id: "pessoa", create: (_f: Fixture): Body => ({ nome: "Pessoa nova", cliente: true }), patch: { nome: "Pessoa editada" } },
            { path: "/bancos", table: "bancos", id: "banco", create: (_f: Fixture): Body => ({ descricao: "Banco novo" }), patch: { descricao: "Banco editado" } },
            { path: "/formas-pagamento", table: "formas_pagamento", id: "forma", create: (f: Fixture): Body => ({ descricao: "Forma nova", tipo: "pix", banco_id: f.banco }), patch: { descricao: "Forma editada" } },
            { path: "/planos-contas", table: "planos_contas", id: "plano", create: (_f: Fixture): Body => ({ descricao: "Plano novo" }), patch: { descricao: "Plano editado" } },
            { path: "/lancamentos", table: "lancamentos", id: "pagar", create: (f: Fixture): Body => ({ descricao: "Conta nova", valor: 100, tipo: "pagar", data_vencimento: "2026-10-20", pessoa_id: f.pessoa, banco_id: f.banco, plano_conta_id: f.plano }), patch: { descricao: "Conta editada" } },
            { path: "/movimentacoes", table: "movimentacoes", id: "pagamento", create: (f: Fixture): Body => ({ lancamento_id: f.pagar, forma_pagamento_id: f.forma, valor: 1 }), patch: { valor: 2 } },
            { path: "/recebimentos", table: "recebimentos", id: "recebimento", create: (f: Fixture): Body => ({ lancamento_id: f.receber, forma_pagamento_id: f.forma, valor: 1 }), patch: { valor: 2 } },
        ] as const;
        for (const config of configs) {
            for (const f of [a, b]) {
                await scenario(`${config.path}: criação na empresa escolhida`, async () => {
                    const answer = await request(config.path, "POST", config.create(f), f.empresa);
                    assert.equal(answer.status, 201, JSON.stringify(answer));
                    const row = await client.query(`SELECT empresa_id FROM ${config.table} WHERE id = $1`, [answer.body.id]);
                    assert.equal(row.rows[0].empresa_id, f.empresa);
                });
                await scenario(`${config.path}: edição mantém a empresa de origem`, async () => {
                    const answer = await request(`${config.path}/${f[config.id]}`, "PATCH", config.patch, f.empresa);
                    assert.equal(answer.status, 200, JSON.stringify(answer));
                    const row = await client.query(`SELECT empresa_id FROM ${config.table} WHERE id = $1`, [f[config.id]]);
                    assert.equal(row.rows[0].empresa_id, f.empresa);
                });
            }
            for (const [name, empresa, status] of [["ausente", undefined, 400], ["vazio", "", 400], ["inválido", "invalido", 400], ["inexistente", randomUUID(), 403], ["sem vínculo", outsider.empresa, 403]] as const) {
                for (const method of ["GET", "POST", "PATCH"] as const) await scenario(`${config.path}: ${method}, empresa ${name}`, async () => {
                    const before = await snapshot();
                    const answer = await request(config.path + (method === "PATCH" ? `/${a[config.id]}` : ""), method, method === "GET" ? undefined : method === "POST" ? config.create(a) : config.patch, empresa);
                    assert.equal(answer.status, status, JSON.stringify(answer));
                    assert.deepEqual(await snapshot(), before);
                    assert.equal(answer.body.data, undefined);
                });
            }
            for (const foreign of [b, outsider]) {
                for (const method of ["GET", "PATCH"] as const) await scenario(`${config.path}: ${method} ID de outra empresa`, async () => {
                    const before = await snapshot();
                    const answer = await request(`${config.path}/${foreign[config.id]}`, method, method === "PATCH" ? config.patch : undefined, a.empresa);
                    assert.equal(answer.status, 404, JSON.stringify(answer));
                    assert.deepEqual(await snapshot(), before);
                    assert.equal(answer.body.data, undefined);
                });
            }
            await scenario(`${config.path}: listagem não mistura empresas`, async () => {
                const answer = await request(config.path, "GET", undefined, a.empresa);
                assert.equal(answer.status, 200);
                assert.ok(answer.body.data.length > 0);
                assert.ok(answer.body.data.every((row: { empresa_id: string }) => row.empresa_id === a.empresa));
            });
            await scenario(`${config.path}: usuário não autenticado`, async () => {
                const before = await snapshot();
                assert.equal((await request(config.path, "POST", config.create(a), a.empresa, true)).status, 401);
                assert.deepEqual(await snapshot(), before);
            });
            await scenario(`${config.path}: corpo não pode trocar empresa`, async () => {
                const before = await snapshot();
                assert.equal((await request(`${config.path}/${a[config.id]}`, "PATCH", { ...config.patch, empresa_id: b.empresa }, a.empresa)).status, 400);
                assert.deepEqual(await snapshot(), before);
            });
        }
        for (const foreign of [b, outsider]) {
            for (const [path, field, id] of [["/formas-pagamento", "banco_id", "banco"], ["/lancamentos", "pessoa_id", "pessoa"], ["/lancamentos", "banco_id", "banco"], ["/lancamentos", "plano_conta_id", "plano"], ["/movimentacoes", "forma_pagamento_id", "forma"], ["/recebimentos", "forma_pagamento_id", "forma"], ["/movimentacoes", "lancamento_id", "pagar"], ["/recebimentos", "lancamento_id", "receber"]] as const) {
                const config = configs.find(c => c.path === path)!;
                for (const method of field === "lancamento_id" ? ["POST"] : ["POST", "PATCH"]) await scenario(`${path}: ${method} referência ${field} de outra empresa`, async () => {
                    const before = await snapshot();
                    const body = { ...(method === "POST" ? config.create(a) : config.patch), [field]: foreign[id] };
                    const answer = await request(path + (method === "PATCH" ? `/${a[config.id]}` : ""), method, body, a.empresa);
                    assert.ok([400, 404].includes(answer.status), JSON.stringify(answer));
                    assert.deepEqual(await snapshot(), before);
                });
            }
        }
        for (const f of [a, b]) await scenario("conta parcelada com baixa imediata respeita empresa", async () => {
            const answer = await request("/lancamentos/parcelado", "POST", { ...configs[4].create(f), parcelas: 2, forma_pagamento_id: f.forma }, f.empresa);
            assert.equal(answer.status, 201, JSON.stringify(answer));
            const rows = await client.query("SELECT empresa_id FROM lancamentos WHERE id = ANY($1::uuid[])", [answer.body.ids]);
            assert.equal(rows.rowCount, 2);
            assert.ok(rows.rows.every(row => row.empresa_id === f.empresa));
        });
        for (const foreign of [b, outsider]) {
            for (const path of ["/lancamentos", "/lancamentos/parcelado"]) await scenario(`${path}: baixa imediata com forma de outra empresa reverte conta`, async () => {
                const before = await snapshot();
                const answer = await request(path, "POST", { ...configs[4].create(a), ...(path.endsWith("parcelado") ? { parcelas: 2 } : {}), forma_pagamento_id: foreign.forma }, a.empresa);
                assert.equal(answer.status, 400, JSON.stringify(answer));
                assert.deepEqual(await snapshot(), before);
            });
            await scenario("baixa pela conta recusa conta de outra empresa", async () => {
                const before = await snapshot();
                assert.equal((await request(`/lancamentos/${foreign.pagar}/baixar`, "POST", { forma_pagamento_id: a.forma, valor: 1 }, a.empresa)).status, 404);
                assert.deepEqual(await snapshot(), before);
            });
        }
        console.log(JSON.stringify({ mode: "HTTP e PostgreSQL reais; sessão de teste; rollback externo", passed, failed: failures.length, failures }, null, 2));
        if (failures.length) process.exitCode = 1;
    } finally {
        if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
        pool.query = originalQuery;
        pool.connect = originalConnect;
        await client.query("ROLLBACK");
        client.release();
        // Verifica a remoção das fixtures após o rollback, usando uma conexão normal.
        const remaining = await pool.query("SELECT id FROM users WHERE id = $1 UNION ALL SELECT id FROM empresas WHERE id = ANY($2::uuid[])", [user, fixtures.map(f => f.empresa)]);
        assert.equal(remaining.rowCount, 0, "O rollback deve remover todas as fixtures");
        await pool.end();
        console.log("Rollback confirmado: usuário e empresas temporários não persistiram.");
    }
}
run().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
