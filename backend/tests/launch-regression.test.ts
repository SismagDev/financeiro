import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import type { PoolClient } from "pg";
import { pool } from "../src/db";
import { createLaunches, installmentCompetence } from "../src/lancamentos/lancamentos.service";
import { competenceDate, competenceLabel, dateInputValue } from "../../frontend/src/utils/dates";

const company = "11111111-1111-4111-8111-111111111111";
const originalConnect = pool.connect.bind(pool);
let statements: string[] = [];
let inserts: unknown[][] = [];
let settled: Record<string, number> = {};
let failPayment = false;
let foreignPlan = false;
let released = false;
const client = {
    async query(sql: string, values: unknown[] = []) {
        statements.push(sql);
        if (sql.includes("SELECT 1 FROM planos_contas") && foreignPlan) return { rows: [], rowCount: 0 };
        if (sql.includes("SELECT 1 FROM formas_pagamento")) return { rows: failPayment ? [] : [{}], rowCount: failPayment ? 0 : 1 };
        if (sql.includes("INSERT INTO lancamentos")) {
            inserts.push(values);
            return { rows: [{ id: String(inserts.length) }], rowCount: 1 };
        }
        if (sql.includes("FROM lancamentos")) {
            const row = inserts[Number(values[1]) - 1]!;
            return { rows: [{ valor: row[2], tipo: row[3], status: row[12] }], rowCount: 1 };
        }
        if (sql.includes("SUM(valor)")) return { rows: [{ total: String(settled[String(values[1])] ?? 0) }], rowCount: 1 };
        if (sql.includes("INSERT INTO recebimentos") || sql.includes("INSERT INTO movimentacoes")) {
            settled[String(values[1])] = Number(values[3]);
            return { rows: [{ id: "baixa" }], rowCount: 1 };
        }
        return { rows: [{}], rowCount: 1 };
    },
    release() { released = true; },
} as unknown as PoolClient;
beforeEach(() => {
    statements = []; inserts = []; settled = {}; failPayment = false; foreignPlan = false; released = false;
    pool.connect = (async () => client) as typeof pool.connect;
});
after(() => { pool.connect = originalConnect; });
const input = { descricao: "Água", valor: 100, tipo: "pagar" as const, data_vencimento: "2026-10-05" };

test("datas ISO retornadas pela API preenchem campos de edição sem mudar o dia", () => {
    for (const value of ["2026-10-05", "2026-10-05T00:00:00.000Z", "2026-10-05T03:00:00.000Z"]) assert.equal(dateInputValue(value), "2026-10-05");
    assert.equal(dateInputValue(null), "");
});
test("competência usa mmm/yyyy e converte ao primeiro dia", () => {
    assert.equal(competenceLabel("2026-10-01T00:00:00.000Z"), "out/2026");
    assert.equal(competenceDate("jan/2026"), "2026-01-01");
    assert.equal(competenceDate("foo/2026"), "");
    assert.equal(installmentCompetence("2026-12-05", 1), "2027-01-01");
});
test("salvar sem forma de pagamento mantém lançamento sem baixa e gera competência", async () => {
    const result = await createLaunches(company, input);
    assert.deepEqual(result, { id: "1" });
    assert.equal(inserts[0]![10], "2026-10-01T00:00:00Z");
    assert.equal(inserts[0]![11], null);
    assert.equal(statements.some(sql => /INSERT INTO (movimentacoes|recebimentos)/.test(sql)), false);
    assert.ok(statements.includes("COMMIT"));
    assert.ok(released);
});
test("competência manual é preservada e avança mensalmente nas parcelas, com divisão em centavos", async () => {
    await createLaunches(company, { ...input, parcelas: 3, competencia: "2026-12-01" });
    assert.deepEqual(inserts.map(row => row[10]), ["2026-12-01T00:00:00Z", "2027-01-01T00:00:00Z", "2027-02-01T00:00:00Z"]);
    assert.deepEqual(inserts.map(row => row[2]), ["33.34", "33.33", "33.33"]);
    assert.equal(inserts[0]![4], "2026-10-05");
});
test("forma preenchida baixa todas as parcelas pelo serviço existente", async () => {
    await createLaunches(company, { ...input, parcelas: 2, forma_pagamento_id: company });
    assert.equal(statements.filter(sql => sql.includes("INSERT INTO movimentacoes")).length, 2);
    assert.deepEqual(Object.values(settled), [50, 50]);
    assert.ok(statements.includes("COMMIT"));
});
test("lançamento a receber gera recebimento na baixa imediata", async () => {
    await createLaunches(company, { ...input, tipo: "receber", forma_pagamento_id: company });
    assert.equal(statements.filter(sql => sql.includes("INSERT INTO recebimentos")).length, 1);
});
test("baixa inválida reverte a criação, sem commit", async () => {
    failPayment = true;
    await assert.rejects(() => createLaunches(company, { ...input, forma_pagamento_id: company }), /Forma de pagamento/);
    assert.ok(statements.includes("ROLLBACK"));
    assert.equal(statements.includes("COMMIT"), false);
    assert.ok(released);
});
test("plano de outra empresa é recusado antes de inserir", async () => {
    foreignPlan = true;
    await assert.rejects(() => createLaunches(company, { ...input, plano_conta_id: company }), /referência/);
    assert.equal(inserts.length, 0);
    assert.ok(statements.includes("ROLLBACK"));
});

