// Opt-in: PostgreSQL real, fixtures e migration em uma única transação SEM COMMIT.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool } from "../src/db";
import { createLaunches } from "../src/lancamentos/lancamentos.service";
import { createSettlement, updateSettlement } from "../src/lancamentos/settlement.service";
import { dashboardSummary, listRecords } from "../src/resources/list.service";
import express from "express";
import type { Server } from "node:http";
import type { PoolClient } from "pg";
import launchRoutes from "../src/lancamentos/lancamentos.routes";
import planRoutes from "../src/planos_contas/planos_contas.routes";
import paymentRoutes from "../src/movimentacoes/movimentacoes.routes";
import receiptRoutes from "../src/recebimentos/recebimentos.routes";

async function run() {
    const client = await pool.connect(), originalQuery = pool.query.bind(pool), originalConnect = pool.connect.bind(pool);
    let server: Server | undefined;
    const companies = [randomUUID(), randomUUID()];
    try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '5s'");
        for (const id of companies) await client.query("INSERT INTO empresas (id,nome,ativo) VALUES ($1,'Auditoria temporária',TRUE)", [id]);
        const company = companies[0], form = randomUUID();
        const legacy = (await client.query("INSERT INTO planos_contas (empresa_id,descricao) VALUES ($1,'Plano anterior') RETURNING id", [company])).rows[0].id;
        const migration = (await readFile("migrations/012_tipo_plano_contas.sql", "utf8")).replace(/^BEGIN;\s*/i, "").replace(/COMMIT;\s*$/i, "");
        await client.query(migration);
        await client.query(migration);
        assert.equal((await client.query("SELECT tipo FROM planos_contas WHERE id=$1", [legacy])).rows[0].tipo, "ambos");
        const planIds: Record<string, string> = { ambos: legacy };
        for (const tipo of ["receber", "pagar"]) planIds[tipo] = (await client.query("INSERT INTO planos_contas (empresa_id,descricao,tipo) VALUES ($1,$2::text,$2::text) RETURNING id", [company, tipo])).rows[0].id;
        const foreignPlan = (await client.query("INSERT INTO planos_contas (empresa_id,descricao) VALUES ($1,'Outro plano') RETURNING id", [companies[1]])).rows[0].id;
        await client.query("INSERT INTO formas_pagamento (id,empresa_id,descricao,tipo) VALUES ($1,$2,'Pix temporário','pix')", [form, company]);
        const base = { descricao: "Conta temporária", valor: 100, data_vencimento: "2099-01-10", competencia: "2099-01-01" };
        for (const tipo of ["receber", "pagar"] as const) {
            for (const planType of [tipo, "ambos"]) await createLaunches(company, { ...base, tipo, plano_conta_id: planIds[planType] }, client);
            for (const parcelas of [1, 3]) {
                await assert.rejects(() => createLaunches(company, { ...base, tipo, parcelas, plano_conta_id: planIds[tipo === "receber" ? "pagar" : "receber"] }, client));
                await assert.rejects(() => createLaunches(company, { ...base, tipo, parcelas, plano_conta_id: foreignPlan }, client));
            }
        }
        pool.query = client.query.bind(client) as typeof pool.query;
        for (const tipo of ["receber", "pagar"] as const) {
            const options = await listRecords({ table: "planos_contas", fields: ["descricao", "tipo"] }, { opcoes: "true", tipo_conta: tipo }, [company]);
            assert.deepEqual(options.data.map((row: { tipo: string }) => row.tipo).sort(), ["ambos", tipo].sort());
        }
        const get = async (id: string) => (await client.query("SELECT * FROM lancamentos WHERE empresa_id=$1 AND id=$2", [company, id])).rows[0];
        for (const tipo of ["pagar", "receber"] as const) {
            const table = tipo === "pagar" ? "movimentacoes" : "recebimentos";
            const created = await createLaunches(company, { ...base, tipo, desconto: 10, acrescimo: 5 }, client), id = created.id!;
            await createSettlement(client, company, table, { lancamentoId: id, formaPagamentoId: form, valor: 40 });
            await assert.rejects(() => createSettlement(client, company, table, { lancamentoId: id, formaPagamentoId: form, valor: 65 }), /maior que o saldo/);
            await assert.rejects(() => createSettlement(client, company, table, { lancamentoId: id, formaPagamentoId: form, valor: 65, acrescimo_confirmado: 10, saldo_confirmado: 60 }), /saldo foi alterado/);
            assert.equal(Number((await get(id)).acrescimo), 5);
            const settlement = await createSettlement(client, company, table, { lancamentoId: id, formaPagamentoId: form, valor: 65, acrescimo_confirmado: 10, saldo_confirmado: 55 });
            const saved = await get(id);
            assert.equal(Number(saved.valor), 100); assert.equal(Number(saved.desconto), 10); assert.equal(Number(saved.acrescimo), 15); assert.equal(saved.status, "pago");
            await updateSettlement(client, company, table, settlement.id, { valor: 70, acrescimo_confirmado: 5, saldo_confirmado: 65 });
            assert.equal(Number((await get(id)).acrescimo), 20);
            await assert.rejects(() => createSettlement(client, companies[1], table, { lancamentoId: id, formaPagamentoId: form, valor: 1 }), /não encontrado/);
            // Falha após atualizar o acréscimo precisa reverter junto com a baixa.
            await client.query("SAVEPOINT failed_settlement");
            await assert.rejects(() => createSettlement(client, company, table, { lancamentoId: id, formaPagamentoId: form, valor: 10, acrescimo_confirmado: 10, saldo_confirmado: 0, data: "invalid-date" }));
            await client.query("ROLLBACK TO SAVEPOINT failed_settlement");
            assert.equal(Number((await get(id)).acrescimo), 20);
            assert.equal(Number((await client.query(`SELECT SUM(valor) AS total FROM ${table} WHERE empresa_id=$1 AND lancamento_id=$2`, [company, id])).rows[0].total), 110);
        }
        const installments = await createLaunches(company, { ...base, tipo: "receber", parcelas: 2 }, client);
        await createSettlement(client, company, "recebimentos", { lancamentoId: installments.ids![0], formaPagamentoId: form, valor: 60, acrescimo_confirmado: 10, saldo_confirmado: 50 });
        assert.equal(Number((await get(installments.ids![0])).acrescimo), 10);
        assert.equal(Number((await get(installments.ids![1])).acrescimo), 0);
        const yearCompany = companies[1], yearForm = randomUUID();
        await client.query("INSERT INTO formas_pagamento (id,empresa_id,descricao,tipo) VALUES ($1,$2,'Pix temporário','pix')", [yearForm, yearCompany]);
        for (const tipo of ["pagar", "receber"] as const) {
            const account = await createLaunches(yearCompany, { ...base, tipo, valor: 200 }, client);
            for (const [data, valor] of [["2025-12-31", 10], ["2026-01-01", 20], ["2026-12-31", 30], ["2027-01-01", 40]] as const)
                await createSettlement(client, yearCompany, tipo === "pagar" ? "movimentacoes" : "recebimentos", { lancamentoId: account.id!, formaPagamentoId: yearForm, valor, data });
        }
        const year = (await dashboardSummary([yearCompany], "2026-10-30", 2026)).data;
        assert.equal(Number(year.totalPaid), 100);
        assert.equal(year.flowRows.length, 4);
        assert.ok(year.flowRows.every((row: { data_fluxo: string }) => row.data_fluxo.startsWith("2026-")));
        assert.equal(Number(year.pagar), 100); assert.equal(Number(year.receber), 100);
        assert.equal(Number((await dashboardSummary([yearCompany], "2026-10-30", 2025)).data.totalPaid), 20);
        assert.equal(Number((await dashboardSummary([yearCompany], "2026-10-30", 2027)).data.totalPaid), 80);
        assert.equal(Number((await dashboardSummary([yearCompany], "2026-10-30")).data.totalPaid), 200);
        // Exercita os contratos HTTP reais dentro de savepoints da mesma transação.
        const user = randomUUID();
        await client.query("INSERT INTO users (id,nome,email,password_hash,role,ativo) VALUES ($1,'Auditoria',$2,'sem-login','comum',TRUE)", [user, `${user}@audit.invalid`]);
        await client.query("UPDATE empresas SET licenca_expira_em='2099-01-01' WHERE id=$1", [company]);
        await client.query("INSERT INTO users_empresas (user_id,empresa_id,perfil) VALUES ($1,$2,'comum')", [user, company]);
        let sequence = 0;
        pool.connect = (async () => {
            const savepoint = `audit_http_${++sequence}`;
            return { query: async (sql: string, values?: unknown[]) => {
                if (sql === "BEGIN") return client.query(`SAVEPOINT ${savepoint}`);
                if (sql === "COMMIT") return client.query(`RELEASE SAVEPOINT ${savepoint}`);
                if (sql === "ROLLBACK") { await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`); return client.query(`RELEASE SAVEPOINT ${savepoint}`); }
                return client.query(sql, values);
            }, release() {} } as unknown as PoolClient;
        }) as typeof pool.connect;
        const app = express(); app.use(express.json());
        app.use((req, _res, next) => { req.session = { user: { id: user } } as typeof req.session; next(); });
        app.use("/lancamentos", launchRoutes); app.use("/planos-contas", planRoutes); app.use("/movimentacoes", paymentRoutes); app.use("/recebimentos", receiptRoutes);
        server = app.listen(0); await new Promise<void>(resolve => server!.on("listening", resolve));
        const address = server.address() as { port: number };
        async function request(path: string, method: string, body?: object, empresa = company) {
            const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method, headers: { "Content-Type": "application/json", "x-empresa-id": empresa }, body: body ? JSON.stringify(body) : undefined });
            return { status: response.status, body: await response.json() };
        }
        const newPlan = await request("/planos-contas", "POST", { descricao: "Plano via HTTP" });
        assert.equal(newPlan.status, 201);
        assert.equal((await request(`/planos-contas/${newPlan.body.id}`, "GET")).body.data.tipo, "ambos");
        assert.equal((await request(`/planos-contas/${newPlan.body.id}`, "PATCH", { tipo: "pagar" })).status, 200);
        assert.equal((await request(`/planos-contas/${newPlan.body.id}`, "PATCH", { tipo: "invalid" })).status, 400);
        assert.equal((await request("/lancamentos", "POST", { ...base, tipo: "receber", plano_conta_id: newPlan.body.id })).status, 400);
        const apiAccount = await request("/lancamentos", "POST", { ...base, tipo: "pagar", plano_conta_id: newPlan.body.id });
        assert.equal(apiAccount.status, 201);
        assert.equal((await request(`/lancamentos/${apiAccount.body.id}/baixar`, "POST", { forma_pagamento_id: form, valor: 30 })).status, 201);
        assert.equal((await request(`/lancamentos/${apiAccount.body.id}/baixar`, "POST", { forma_pagamento_id: form, valor: 80, acrescimo_confirmado: -1, saldo_confirmado: 70 })).status, 400);
        assert.equal((await request(`/lancamentos/${apiAccount.body.id}/baixar`, "POST", { forma_pagamento_id: form, valor: 80, acrescimo_confirmado: 10, saldo_confirmado: 100 })).status, 409);
        assert.equal((await request(`/lancamentos/${apiAccount.body.id}/baixar`, "POST", { forma_pagamento_id: form, valor: 80, acrescimo_confirmado: 10, saldo_confirmado: 70 })).status, 201);
        assert.equal(Number((await get(apiAccount.body.id)).acrescimo), 10);
        for (const tipo of ["receber", "pagar"] as const) {
            const account = await createLaunches(company, { ...base, tipo }, client);
            const endpoint = tipo === "receber" ? "/recebimentos" : "/movimentacoes";
            const settlement = await request(endpoint, "POST", { lancamento_id: account.id, forma_pagamento_id: form, valor: 110, acrescimo_confirmado: 10, saldo_confirmado: 100 });
            assert.equal(settlement.status, 201);
            assert.equal((await request(`${endpoint}/${settlement.body.id}`, "PATCH", { valor: 115, acrescimo_confirmado: 5, saldo_confirmado: 110 })).status, 200);
            assert.equal(Number((await get(account.id!)).acrescimo), 15);
        }
        assert.equal((await request("/lancamentos?resumo=dashboard&ano=2026", "GET")).status, 200);
        assert.equal((await request("/lancamentos?resumo=dashboard&ano=invalid", "GET")).status, 400);
        assert.equal((await request("/planos-contas", "POST", { descricao: "Sem acesso" }, yearCompany)).status, 403);
        console.log("PASS: contratos HTTP de planos, filtro anual e acréscimos nos três endpoints de baixa, validação Zod e isolamento por empresa.");
        console.log("PASS: PostgreSQL real — migration idempotente/legados, planos por tipo/empresa, criação simples/parcelada, acréscimo confirmado, confirmação desatualizada, edição de baixa, rollback, parcela isolada e ano pela baixa.");
    } finally {
        if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
        pool.query = originalQuery;
        pool.connect = originalConnect;
        await client.query("ROLLBACK"); client.release(); await pool.end();
        console.log("ROLLBACK concluído; fixtures e migration não foram persistidas.");
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
