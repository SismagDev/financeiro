// Verificação opt-in e enxuta: node --import tsx tests/banks-basic.audit.ts
// Usa as rotas reais, bancos temporários e rollback de todas as fixtures.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import type { Server } from "node:http";
import { pool } from "../src/db";
import banks from "../src/bancos/bancos.routes";
import { buildList } from "../src/resources/list.service";

async function run() {
    const client = await pool.connect(), originalQuery = pool.query;
    const user = randomUUID(), companies = [randomUUID(), randomUUID()];
    let server: Server | undefined;
    try {
        await client.query("BEGIN");
        await client.query("CREATE TEMP TABLE bancos (LIKE public.bancos INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP");
        const migration = (await readFile("migrations/014_bancos_agencia_conta.sql", "utf8")).replace(/^BEGIN;\s*/, "").replace(/COMMIT;\s*$/, "");
        await client.query(migration);
        await client.query("INSERT INTO users (id,nome,email,password_hash,role,ativo) VALUES ($1,'Teste bancos',$2,'sem-login','comum',TRUE)", [user, `${user}@audit.invalid`]);
        for (const id of companies) {
            await client.query("INSERT INTO empresas (id,nome,ativo,licenca_expira_em) VALUES ($1,'Teste bancos',TRUE,CURRENT_TIMESTAMP + INTERVAL '1 year')", [id]);
            await client.query("INSERT INTO users_empresas (user_id,empresa_id,perfil) VALUES ($1,$2,'comum')", [user, id]);
        }
        pool.query = (async (sql: string, values?: unknown[]) => {
            await client.query("SAVEPOINT bank_query");
            try { return await client.query(sql, values); }
            catch (error) { await client.query("ROLLBACK TO SAVEPOINT bank_query"); throw error; }
            finally { await client.query("RELEASE SAVEPOINT bank_query"); }
        }) as typeof pool.query;
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.session = { user: req.header("x-test-anonymous") ? undefined : { id: user } } as typeof req.session;
            next();
        });
        app.use("/bancos", banks);
        server = app.listen(0, "127.0.0.1");
        await new Promise<void>(resolve => server!.once("listening", resolve));
        const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/bancos`;
        async function request(path: string, method = "GET", data?: Record<string, unknown>, company = companies[0], anonymous = false) {
            const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", "x-empresa-id": company!, ...(anonymous ? { "x-test-anonymous": "true" } : {}) }, body: data ? JSON.stringify(data) : undefined });
            return { status: response.status, body: await response.json() };
        }
        const bank = await request("", "POST", { descricao: "Itaú", agencia: " 001 ", conta: "0002-3" });
        assert.equal(bank.status, 201);
        const duplicateName = await request("", "POST", { descricao: " itaú ", agencia: null, conta: null });
        assert.equal(duplicateName.status, 400); assert.match(duplicateName.body.message, /nome/);
        const duplicatePair = await request("", "POST", { descricao: "Outro", agencia: "001", conta: "0002-3" });
        assert.equal(duplicatePair.status, 400); assert.match(duplicatePair.body.message, /agência e conta/);
        const other = await request("", "POST", { descricao: "Fulano - Itaú", agencia: null, conta: null });
        assert.equal(other.status, 201);
        assert.equal((await request("", "POST", { descricao: "Ciclano - Itaú", agencia: "001", conta: null })).status, 201);
        assert.equal((await request(`/${bank.body.id}`, "PATCH", { descricao: "Itaú", agencia: "001", conta: "0002-3" })).status, 200);
        assert.equal((await request(`/${other.body.id}`, "PATCH", { agencia: "001", conta: "0002-3" })).status, 400);
        assert.equal((await request(`/${other.body.id}`, "PATCH", { descricao: "Itaú" })).status, 400);
        assert.equal((await request(`/${bank.body.id}`, "PATCH", { agencia: null, conta: null })).status, 200);
        const cleared = await request(`/${bank.body.id}`);
        assert.equal(cleared.body.data.agencia, null); assert.equal(cleared.body.data.conta, null);
        assert.equal((await request("", "POST", { descricao: "Itaú", agencia: "001", conta: "0002-3" }, companies[1])).status, 201);
        console.log("PASS bancos: migration, criação/edição, duplicidades, campos nulos e empresas distintas");

        assert.equal((await request("", "POST", { descricao: "Anônimo" }, companies[0], true)).status, 401);
        assert.equal((await request("", "POST", { descricao: "Sem acesso" }, randomUUID())).status, 403);
        assert.equal((await request(`/${bank.body.id}`, "PATCH", { descricao: "Invasão" }, companies[1])).status, 404);
        assert.equal((await request("", "POST", { descricao: "Forjado", empresa_id: companies[1] })).status, 400);
        const listing = await request(`?empresas=${companies[1]}&pagina=1`);
        assert.ok(listing.body.data.every((row: { empresa_id: string }) => row.empresa_id === companies[1]));
        console.log("PASS segurança: autenticação, acesso, isolamento e rejeição de empresa no payload");

        const config = { table: "lancamentos", fields: ["tipo", "pessoa_id", "valor"] };
        const rows = `SELECT * FROM (VALUES
            ('1','receber','2026-01-01'::date,'Ana','Conta','1',1::numeric,0::numeric,0::numeric),
            ('2','pagar','2026-02-01'::date,'Bia','Conta','1',3::numeric,0::numeric,0::numeric),
            ('3','pagar','2026-02-01'::date,'Ana','Conta','1',2::numeric,0::numeric,0::numeric)
        ) t(id,tipo,data_vencimento,pessoa_nome,descricao,num_doc,valor,desconto,acrescimo) CROSS JOIN (SELECT $1::uuid AS empresa_id) e`;
        const defaults = buildList(config, {}, companies).order;
        assert.deepEqual((await client.query(`${rows} ORDER BY ${defaults}`, [companies[0]])).rows.map(row => row.id), ["3", "2", "1"]);
        const byValue = buildList(config, { ordem: "valor", direcao: "desc" }, companies).order;
        assert.deepEqual((await client.query(`${rows} ORDER BY ${byValue} LIMIT 2`, [companies[0]])).rows.map(row => row.id), ["2", "3"]);
        console.log("PASS ordenação: PostgreSQL executa prioridade padrão e valor descendente antes do limite");
    } finally {
        if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
        pool.query = originalQuery;
        await client.query("ROLLBACK");
        client.release();
        await pool.end();
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
