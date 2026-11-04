import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import type { PoolClient } from "pg";
import { pool } from "../src/db";
import { updateLaunch, type PendingSettlement } from "../src/lancamentos/lancamentos.service";

const empresa = "11111111-1111-4111-8111-111111111111", conta = "22222222-2222-4222-8222-222222222222";
const forma = "33333333-3333-4333-8333-333333333333";
const connect = pool.connect;
type Stored = Record<string, string>;
let account: Stored, rows: Map<string, Stored>, transaction: { account: Stored; rows: Map<string, Stored> }, commits: number;
const client = {
    async query(sql: string, values: unknown[] = []) {
        if (sql === "BEGIN") transaction = { account: { ...account }, rows: new Map(rows) };
        if (sql === "ROLLBACK") { account = transaction.account; rows = transaction.rows; }
        if (sql === "COMMIT") commits++;
        if (sql.includes("FROM lancamentos")) return { rows: values[0] === empresa && values[1] === conta ? [{ ...account }] : [], rowCount: 1 };
        if (sql.includes("SUM(valor)")) return { rows: [{ total: String([...rows.values()].reduce((sum, row) => sum + Number(row.valor) + Number(row.desconto) - Number(row.acrescimo), 0)) }] };
        if (sql.includes("SELECT 1 FROM formas_pagamento")) return { rows: [], rowCount: values[1] === forma ? 1 : 0 };
        if (sql.startsWith("SELECT lancamento_id")) return { rows: rows.has(String(values[1])) ? [rows.get(String(values[1]))] : [] };
        if (sql.startsWith("UPDATE lancamentos SET")) {
            const columns = sql.split(" SET ")[1]!.split("WHERE")[0]!.split(",").map(part => part.trim().split(" = ")[0]!);
            columns.forEach((column, index) => { account[column] = String(values[index]); });
        }
        if (sql.startsWith("INSERT INTO recebimentos") || sql.startsWith("INSERT INTO movimentacoes")) {
            const id = String(values[7]);
            assert.equal(rows.has(id), false);
            rows.set(id, { lancamento_id: String(values[1]), forma_pagamento_id: String(values[2]), valor: String(values[3]),
                data: String(values[4]), desconto: String(values[5]), acrescimo: String(values[6]) });
            return { rows: [{ id }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
    },
    release() {},
} as unknown as PoolClient;
beforeEach(() => {
    account = { valor: "100", desconto: "10", acrescimo: "5", tipo: "pagar", status: "pendente", descricao: "Original" };
    rows = new Map(); commits = 0;
    pool.connect = (async () => client) as typeof pool.connect;
});
after(() => { pool.connect = connect; });
const drafts: PendingSettlement[] = [
    { id: "44444444-4444-4444-8444-444444444444", forma_pagamento_id: forma, valor: 35, desconto: 5, acrescimo: 0, data: "2026-11-04" },
    { id: "55555555-5555-4555-8555-555555555555", forma_pagamento_id: forma, valor: 57, desconto: 0, acrescimo: 2, data: "2026-11-05" },
];
for (const tipo of ["pagar", "receber"] as const) {
    test(`${tipo}: grava conta e baixas juntas, preserva ajustes e não duplica na repetição`, async () => {
        account.tipo = tipo;
        const input = { descricao: "Editada", valor: 100, baixas_pendentes: drafts };
        await updateLaunch(empresa, conta, input);
        assert.equal(account.descricao, "Editada");
        assert.equal(account.tipo, tipo);
        assert.equal(account.desconto, "10"); assert.equal(account.acrescimo, "5");
        assert.equal(account.status, "pago"); assert.equal(rows.size, 2); assert.equal(commits, 1);
        await updateLaunch(empresa, conta, input);
        assert.equal(rows.size, 2); assert.equal(account.status, "pago"); assert.equal(commits, 2);
    });
}
test("falha na segunda baixa reverte campos e primeira baixa; nova tentativa grava uma vez", async () => {
    await assert.rejects(updateLaunch(empresa, conta, { descricao: "Não gravar", baixas_pendentes: [drafts[0]!, { ...drafts[1]!, forma_pagamento_id: conta }] }), /Forma de pagamento/);
    assert.equal(rows.size, 0); assert.equal(account.descricao, "Original"); assert.equal(commits, 0);
    await updateLaunch(empresa, conta, { descricao: "Agora sim", baixas_pendentes: drafts });
    assert.equal(rows.size, 2); assert.equal(commits, 1);
});
test("recusa baixa acima do saldo e reutilização de UUID com conteúdo diferente", async () => {
    await assert.rejects(updateLaunch(empresa, conta, { baixas_pendentes: [{ ...drafts[0]!, valor: 100 }] }), /maior que o saldo/);
    assert.equal(rows.size, 0);
    await updateLaunch(empresa, conta, { baixas_pendentes: [drafts[0]!] });
    await assert.rejects(updateLaunch(empresa, conta, { descricao: "Não alterar", baixas_pendentes: [{ ...drafts[0]!, valor: 20 }] }), /outros dados/);
    assert.equal(rows.size, 1); assert.equal(account.descricao, "Original");
});
test("empresa sem a conta não grava dados nem baixas", async () => {
    await assert.rejects(updateLaunch(forma, conta, { descricao: "Não alterar", baixas_pendentes: drafts }), /Registro não encontrado/);
    assert.equal(rows.size, 0); assert.equal(account.descricao, "Original"); assert.equal(commits, 0);
});
