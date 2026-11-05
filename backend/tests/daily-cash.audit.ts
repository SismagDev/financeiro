// Opt-in: node --import tsx tests/daily-cash.audit.ts. SQL e HTTP reais, com rollback externo.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import type { Server } from "node:http";
import { pool } from "../src/db";
import launches from "../src/lancamentos/lancamentos.routes";
import types from "../src/caixa/tipos-caixa-diario.routes";
import plans from "../src/planos_contas/planos_contas.routes";
import receipts from "../src/recebimentos/recebimentos.routes";
import forms from "../src/formas_pagamento/formas_pagamento.routes";

async function run() {
    const client = await pool.connect(), originalQuery = pool.query, originalConnect = pool.connect;
    const user = randomUUID(), company = randomUUID(), otherCompany = randomUUID();
    const bank = randomUUID(), otherBank = randomUUID(), payment = randomUUID();
    let server: Server | undefined, sequence = 0;
    try {
        await client.query("BEGIN");
        const migration = (await readFile("migrations/015_caixa_diario.sql", "utf8")).replace(/^BEGIN;\s*/, "").replace(/COMMIT;\s*$/, "");
        await client.query(migration);
        await client.query("INSERT INTO users (id,nome,email,password_hash,role,ativo) VALUES ($1,'Teste Caixa Diário',$2,'sem-login','comum',TRUE)", [user, `${user}@audit.invalid`]);
        for (const id of [company, otherCompany]) {
            await client.query("INSERT INTO empresas (id,nome,ativo,licenca_expira_em) VALUES ($1,'Teste Caixa Diário',TRUE,CURRENT_TIMESTAMP + INTERVAL '1 year')", [id]);
            await client.query("INSERT INTO users_empresas (user_id,empresa_id,perfil) VALUES ($1,$2,'comum')", [user, id]);
        }
        await client.query("INSERT INTO bancos (id,empresa_id,descricao) VALUES ($1,$2,'Banco A'),($3,$4,'Banco B')", [bank, company, otherBank, otherCompany]);
        await client.query("INSERT INTO formas_pagamento (id,empresa_id,descricao,tipo,banco_id) VALUES ($1,$2,'Pix teste','pix',$3)", [payment, company, bank]);
        pool.query = (async (sql: string, values?: unknown[]) => {
            await client.query("SAVEPOINT daily_query");
            try { return await client.query(sql, values); }
            catch (error) { await client.query("ROLLBACK TO SAVEPOINT daily_query"); throw error; }
            finally { await client.query("RELEASE SAVEPOINT daily_query"); }
        }) as typeof pool.query;
        pool.connect = (async () => {
            const point = `daily_service_${++sequence}`;
            return { release() {}, query: (sql: string, values?: unknown[]) => client.query(
                sql === "BEGIN" ? `SAVEPOINT ${point}` : sql === "COMMIT" ? `RELEASE SAVEPOINT ${point}` : sql === "ROLLBACK" ? `ROLLBACK TO SAVEPOINT ${point}` : sql, values) };
        }) as typeof pool.connect;
        const app = express(); app.use(express.json());
        app.use((req, _res, next) => { req.session = { user: req.header("x-test-anonymous") ? undefined : { id: user } } as typeof req.session; next(); });
        app.use("/lancamentos", launches); app.use("/tipos-caixa-diario", types); app.use("/planos-contas", plans); app.use("/recebimentos", receipts); app.use("/formas-pagamento", forms);
        server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server!.once("listening", resolve));
        const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        async function request(path: string, method = "GET", data?: unknown, scope = company, anonymous = false) {
            const response = await fetch(base + path, { method, headers: { "content-type": "application/json", "x-empresa-id": scope, ...(anonymous ? { "x-test-anonymous": "true" } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
            return { status: response.status, body: await response.json().catch(() => null) };
        }
        const type = await request("/tipos-caixa-diario", "POST", { descricao: "Vendas balcão" }); assert.equal(type.status, 201);
        assert.equal((await request(`/tipos-caixa-diario/${type.body.id}`, "PATCH", { descricao: "Vendas do dia" })).status, 200);
        const input = { data: "2026-11-05", tipo_caixa_diario_id: type.body.id, valor: 100, observacoes: "Conferência", baixas: [{ banco_id: bank, forma_pagamento_id: payment, valor: 40 }, { banco_id: bank, forma_pagamento_id: payment, valor: 60 }] };
        const saved = await request("/lancamentos/caixa-diario", "POST", input); assert.equal(saved.status, 201, JSON.stringify(saved.body));
        const account = (await request(`/lancamentos/${saved.body.id}`)).body.data;
        assert.equal(account.tipo, "receber"); assert.equal(account.status, "pago"); assert.equal(account.pessoa_id, null);
        assert.equal(account.descricao, "Vendas do dia"); assert.equal(account.observacoes, "Conferência"); assert.equal(account.tipo_caixa_diario_id, type.body.id);
        assert.ok(account.data_vencimento.startsWith(input.data)); assert.ok(account.competencia.startsWith("2026-11-01"));
        assert.equal(Number(account.saldo), 0); assert.equal(Number(account.quantidade_baixas), 2);
        const dates = await client.query("SELECT data_recebimento::text AS data FROM recebimentos WHERE empresa_id=$1 AND lancamento_id=$2", [company, saved.body.id]);
        assert.ok(dates.rows.every(row => row.data === input.data));
        const partial = await request("/lancamentos/caixa-diario", "POST", { ...input, baixas: input.baixas.slice(0, 1) }); assert.equal(partial.status, 201);
        assert.equal((await request(`/lancamentos/${partial.body.id}`)).body.data.status, "parcial");
        const planCount = await client.query("SELECT count(*)::int AS total FROM planos_contas WHERE empresa_id=$1 AND descricao='Caixa Diário'", [company]); assert.equal(planCount.rows[0].total, 1);
        assert.equal((await request(`/planos-contas/${account.plano_conta_id}`, "DELETE")).status, 409);
        assert.equal((await request(`/tipos-caixa-diario/${type.body.id}`, "DELETE")).status, 409);
        const unused = await request("/tipos-caixa-diario", "POST", { descricao: "Excluir" }); assert.equal((await request(`/tipos-caixa-diario/${unused.body.id}`, "DELETE")).status, 204);
        console.log("PASS fluxo básico: CRUD, conta/baixas, data, saldo, plano único e proteção de vínculos");

        const before = Number((await client.query("SELECT count(*) AS total FROM lancamentos WHERE empresa_id=$1", [company])).rows[0].total);
        const invalid = await request("/lancamentos/caixa-diario", "POST", { ...input, baixas: [input.baixas[0], { ...input.baixas[1], banco_id: otherBank }] });
        assert.equal(invalid.status, 400);
        assert.equal(Number((await client.query("SELECT count(*) AS total FROM lancamentos WHERE empresa_id=$1", [company])).rows[0].total), before);
        const otherType = await request("/tipos-caixa-diario", "POST", { descricao: "Outra empresa" }, otherCompany);
        assert.equal((await request("/lancamentos/caixa-diario", "POST", { ...input, tipo_caixa_diario_id: otherType.body.id })).status, 400);
        assert.equal((await request("/lancamentos/caixa-diario", "POST", input, company, true)).status, 401);
        assert.equal((await request("/lancamentos/caixa-diario", "POST", input, randomUUID())).status, 403);
        assert.equal((await request(`/tipos-caixa-diario/${type.body.id}`, "PATCH", { descricao: "Invasão" }, otherCompany)).status, 404);
        const formsList = await request(`/formas-pagamento?banco_id=${bank}&opcoes=true&ativo=true`); assert.equal(formsList.body.data.length, 1);
        assert.equal((await request(`/formas-pagamento?banco_id=${otherBank}&opcoes=true`)).body.data.length, 0);
        assert.equal((await request("/recebimentos", "POST", { lancamento_id: partial.body.id, forma_pagamento_id: payment, banco_id: otherBank, valor: 10 })).status, 400);
        assert.equal((await request(`/lancamentos/${partial.body.id}/baixar`, "POST", { forma_pagamento_id: payment, valor: 60 })).status, 201);
        console.log("PASS segurança: rollback, autenticação, isolamento, banco/forma e exceção da baixa rápida");
    } finally {
        if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
        pool.query = originalQuery; pool.connect = originalConnect;
        await client.query("ROLLBACK"); client.release(); await pool.end();
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
