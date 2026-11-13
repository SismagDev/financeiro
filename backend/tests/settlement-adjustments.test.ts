import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { createSettlement, deleteSettlement, updateSettlement, type SettlementKind } from "../src/lancamentos/settlement.service";
import { liquidSettlementValue, remainingAmount } from "../../frontend/src/utils/accounts";

const company = "11111111-1111-4111-8111-111111111111";
const account = "22222222-2222-4222-8222-222222222222";
type Payment = { valor: number; desconto: number; acrescimo: number };

function fixture(table: SettlementKind, historical = { desconto: 0, acrescimo: 0 }) {
    const launch = { valor: "100.00", desconto: String(historical.desconto), acrescimo: String(historical.acrescimo), tipo: table === "recebimentos" ? "receber" : "pagar", status: "pendente" };
    const rows = new Map<string, Payment>();
    const client = { async query(sql: string, values: unknown[] = []) {
        if (sql.includes("FROM lancamentos")) { assert.deepEqual(values, [company, account]); return { rows: [{ ...launch }], rowCount: 1 }; }
        if (sql.includes("SELECT 1 FROM formas_pagamento")) return { rows: [{}], rowCount: 1 };
        if (sql.includes("SUM(valor)")) {
            assert.match(sql, /SUM\(desconto\)/);
            assert.match(sql, /SUM\(acrescimo\)/);
            const total = [...rows.entries()].filter(([id]) => id !== values[2]).reduce((sum, [, row]) => sum + row.valor + row.desconto - row.acrescimo, 0);
            return { rows: [{ total: total.toFixed(2) }], rowCount: 1 };
        }
        if (sql.startsWith(`INSERT INTO ${table}`)) {
            const id = String(rows.size + 1);
            rows.set(id, { valor: Number(values[3]), desconto: Number(values[5]), acrescimo: Number(values[6]) });
            return { rows: [{ id }], rowCount: 1 };
        }
        if (sql.startsWith(`SELECT lancamento_id`)) {
            const row = rows.get(String(values[1]));
            return { rows: row ? [{ ...row, lancamento_id: account, forma_pagamento_id: company }] : [], rowCount: row ? 1 : 0 };
        }
        if (sql.startsWith(`UPDATE ${table}`)) {
            const row = rows.get(String(values[4]))!;
            row.valor = Number(values[1]);
            return { rows: [{ id: String(values[4]) }], rowCount: 1 };
        }
        if (sql.startsWith(`DELETE FROM ${table}`)) { rows.delete(String(values[1])); return { rows: [{ id: String(values[1]) }], rowCount: 1 }; }
        if (sql.startsWith("UPDATE lancamentos SET status")) { launch.status = String(values[0]); return { rows: [], rowCount: 1 }; }
        if (sql.startsWith("UPDATE lancamentos SET acrescimo")) { launch.acrescimo = String(values[0]); return { rows: [], rowCount: 1 }; }
        assert.fail(sql);
    } } as unknown as PoolClient;
    return { client, rows, launch };
}

for (const table of ["movimentacoes", "recebimentos"] as const) {
    test(`${table}: baixas parciais com ajustes quitam o principal e preservam o caixa e o histórico da conta`, async () => {
        const { client, rows, launch } = fixture(table, { desconto: 5, acrescimo: 10 });
        const first = await createSettlement(client, company, table, { lancamentoId: account, formaPagamentoId: company, valor: 35, desconto: 5 });
        assert.equal(first.saldo, 65); // líquido antigo 105; principal quitado 40
        assert.equal(first.status, "parcial");
        const second = await createSettlement(client, company, table, { lancamentoId: account, formaPagamentoId: company, valor: 68, acrescimo: 3 });
        assert.equal(second.saldo, 0);
        assert.equal(second.status, "pago");
        assert.equal([...rows.values()].reduce((sum, row) => sum + row.valor, 0), 103);
        assert.equal(launch.desconto, "5");
        assert.equal(launch.acrescimo, "10");
        await deleteSettlement(client, company, table, first.id);
        assert.equal(launch.status, "parcial");
        assert.equal(remainingAmount({ id: account, tipo: launch.tipo, ...launch }, {
            [table]: [...rows.values()].map(row => ({ ...row, lancamento_id: account })),
        }), 40);
        await deleteSettlement(client, company, table, second.id);
        assert.equal(launch.status, "pendente");
    });

    test(`${table}: edição preserva os ajustes da baixa e valida o saldo sem duplicá-los`, async () => {
        const { client, rows } = fixture(table);
        const first = await createSettlement(client, company, table, { lancamentoId: account, formaPagamentoId: company, valor: 45, desconto: 5 });
        await createSettlement(client, company, table, { lancamentoId: account, formaPagamentoId: company, valor: 50 });
        await assert.rejects(updateSettlement(client, company, table, first.id, { valor: 46 }), /maior que o saldo/);
        await updateSettlement(client, company, table, first.id, { valor: 40 });
        assert.deepEqual(rows.get(first.id), { valor: 40, desconto: 5, acrescimo: 0 });
    });

    test(`${table}: rejeita excesso de principal, desconto inválido e confirmação legada junto com ajuste explícito`, async () => {
        const { client, rows } = fixture(table);
        const base = { lancamentoId: account, formaPagamentoId: company };
        await assert.rejects(createSettlement(client, company, table, { ...base, valor: 100, desconto: 1 }), /maior que o saldo/);
        await assert.rejects(createSettlement(client, company, table, { ...base, valor: 5, acrescimo: 10 }), /Confira/);
        await assert.rejects(createSettlement(client, company, table, { ...base, valor: 5, desconto: -1 }));
        await assert.rejects(createSettlement(client, company, table, { ...base, valor: 110, acrescimo: 10, acrescimo_confirmado: 10, saldo_confirmado: 100 }), /sem a confirmação/);
        assert.equal(rows.size, 0);
    });

    test(`${table}: consumidores antigos continuam podendo confirmar acréscimo acima do saldo`, async () => {
        const { client, launch } = fixture(table);
        const result = await createSettlement(client, company, table, { lancamentoId: account, formaPagamentoId: company, valor: 110, acrescimo_confirmado: 10, saldo_confirmado: 100 });
        assert.equal(result.status, "pago");
        assert.equal(result.saldo, 0);
        assert.equal(launch.acrescimo, "10.00");
    });

    test(`${table}: baixa abaixo, igual e acima do saldo persiste o excedente uma única vez`, async () => {
        for (const [value, surcharge, balance] of [[50, 0, 30], [80, 0, 0], [95, 15, 0]]) {
            const { client, rows, launch } = fixture(table);
            await createSettlement(client, company, table, { lancamentoId: account, formaPagamentoId: company, valor: 20 });
            const result = await createSettlement(client, company, table, {
                lancamentoId: account, formaPagamentoId: company, valor: value, acrescimo: surcharge,
            });
            assert.deepEqual(rows.get(result.id), { valor: value, desconto: 0, acrescimo: surcharge });
            assert.equal(result.saldo, balance);
            assert.equal(result.status, balance ? "parcial" : "pago");
            assert.equal(Number(launch.acrescimo), 0);
            await deleteSettlement(client, company, table, result.id);
            assert.equal(remainingAmount({ id: account, tipo: launch.tipo, ...launch }, {
                [table]: [...rows.values()].map(row => ({ ...row, lancamento_id: account })),
            }), 80);
        }
    });
}

test("valor efetivo da baixa mantém os centavos e distingue desconto de pagamento parcial", () => {
    assert.equal(liquidSettlementValue(0.3, 0.2, 0.1), 0.2);
    assert.equal(remainingAmount({ id: account, tipo: "pagar", valor: 100 }, { movimentacoes: [{ lancamento_id: account, valor: 90, desconto: 10 }] }), 0);
    assert.equal(remainingAmount({ id: account, tipo: "pagar", valor: 100 }, { movimentacoes: [{ lancamento_id: account, valor: 90 }] }), 10);
});
