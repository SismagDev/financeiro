import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import type { PoolClient } from "pg";
import { pool } from "../src/db";
import { createLaunches, installmentCompetence } from "../src/lancamentos/lancamentos.service";
import { competenceDate, competenceLabel, dateInputValue } from "../../frontend/src/utils/dates";
import { installmentPreview } from "../../frontend/src/utils/accounts";

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
            return { rows: [{ valor: row[2], tipo: row[3], status: row[12], desconto: row[15], acrescimo: row[16] }], rowCount: 1 };
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

test("parcelas editadas persistem valores e datas próprios nos dois modos e o total acompanha a soma", async () => {
    const parcelas_personalizadas = [{ valor: 41.02, data_vencimento: "2026-10-09" }, { valor: 33.33, data_vencimento: "2026-12-15" }, { valor: 29.99, data_vencimento: "2027-01-02" }];
    for (const modo_valor of ["total", "parcela"] as const) {
        inserts = [];
        const response = await createLaunches(company, { ...input, parcelas: 3, modo_valor, competencia: "2026-10-01", parcelas_personalizadas });
        assert.equal(response.ids?.length, 3);
        assert.equal(inserts.reduce((sum, row) => sum + Math.round(Number(row[2]) * 100), 0), 10434);
        inserts.forEach((row, index) => {
            assert.equal(row[0], company);
            assert.equal(row[2], parcelas_personalizadas[index]!.valor.toFixed(2));
            assert.equal(row[4], parcelas_personalizadas[index]!.data_vencimento);
            assert.equal(row[8], index + 1);
            assert.equal(row[10], ["2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"][index]);
        });
    }
});

test("parcela única editada e baixa imediata de consumidores existentes usam o valor personalizado", async () => {
    await createLaunches(company, { ...input, forma_pagamento_id: company, parcelas_personalizadas: [{ valor: 79.99, data_vencimento: "2026-12-21" }] });
    assert.equal(inserts[0]![2], "79.99");
    assert.equal(inserts[0]![4], "2026-12-21");
    assert.equal(settled["1"], 79.99);
});

test("parcelas personalizadas inválidas ou incompletas não gravam nenhuma conta", async () => {
    for (const parcelas_personalizadas of [[], [{ valor: 0, data_vencimento: "2026-10-01" }], [{ valor: 1.001, data_vencimento: "2026-10-01" }], [{ valor: 1, data_vencimento: "2026-02-30" }], [{ valor: 1, data_vencimento: "2026-10-01" }]]) {
        await assert.rejects(createLaunches(company, { ...input, parcelas: 2, parcelas_personalizadas }));
        assert.equal(inserts.length, 0);
        assert.ok(statements.includes("ROLLBACK"));
    }
});

test("prévia da criação corresponde aos valores, ajustes, datas e competências persistidos", async () => {
    for (const mode of ["total", "parcela"] as const) {
        for (const intervals of [undefined, [15, 45, 60]]) {
            inserts = [];
            const amounts = { valor: 100.01, desconto: 4.03, acrescimo: 1.02 };
            await createLaunches(company, { ...input, ...amounts, parcelas: 3, modo_valor: mode, competencia: "2026-12-01", intervalos: intervals });
            const preview = installmentPreview(amounts, 3, mode, input.data_vencimento, "dez/2026", intervals);
            assert.equal(preview.length, 3);
            preview.forEach((row, index) => {
                const saved = inserts[index]!;
                assert.equal(row.valor, Number(saved[2]));
                assert.equal(row.desconto, Number(saved[15]));
                assert.equal(row.acrescimo, Number(saved[16]));
                assert.equal(row.vencimento, saved[4]);
                assert.equal(row.competencia, competenceLabel(String(saved[10])));
            });
        }
    }
    assert.deepEqual(installmentPreview({ valor: 100 }, 3, "total", input.data_vencimento, "dez/2026", [15]), []);
    assert.deepEqual(installmentPreview({ valor: 100 }, 61, "total", input.data_vencimento, "dez/2026"), []);
});

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

test("baixa imediata usa o líquido e os ajustes são distribuídos em centavos no parcelamento", async () => {
    await createLaunches(company, { ...input, desconto: 10, acrescimo: 5, forma_pagamento_id: company });
    assert.equal(settled["1"], 95);
    assert.equal(inserts[0]![2], "100.00");
    assert.equal(inserts[0]![15], "10.00");
    inserts = []; settled = {};
    await createLaunches(company, { ...input, parcelas: 3, desconto: 1, acrescimo: 0.5, forma_pagamento_id: company });
    assert.deepEqual(inserts.map(row => row[15]), ["0.34", "0.33", "0.33"]);
    assert.deepEqual(inserts.map(row => row[16]), ["0.17", "0.17", "0.16"]);
    assert.equal(Math.round(Object.values(settled).reduce((sum, value) => sum + value, 0) * 100), 9950);
});

test("desconto inválido reverte a criação e desconto integral gera conta quitada sem baixa de zero", async () => {
    await assert.rejects(() => createLaunches(company, { ...input, desconto: 101 }), /desconto/);
    assert.ok(statements.includes("ROLLBACK"));
    assert.equal(inserts.length, 0);
    await createLaunches(company, { ...input, desconto: 100, forma_pagamento_id: company });
    assert.equal(inserts[0]![12], "pago");
    assert.deepEqual(settled, {});
});

