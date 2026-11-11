import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../src/db";
import { importDailyCash } from "../src/importacao/caixa-diario.service";
import { cashFixture } from "./fixtures/daily-cash";

// Driver em memória com exclusão mútua no FOR UPDATE, complementado pela auditoria SQL real.
// Exercita duas execuções do serviço completo, sem substituir contas ou baixas por stubs.
async function race(different = false) {
    const input = { ...cashFixture(), acao: "importar" as const };
    const mapping = input.filiais["1"], bank = randomUUID(), plan = randomUUID(), commercePlan = randomUUID();
    const committed = new Map<string, { id: string; data: string; valor: string; tipo: string; status: string; plano_conta_id: string; desconto: string; acrescimo: string }>();
    let gate = Promise.resolve(), waits = 0, receiptCount = 0;
    const connect = pool.connect;
    pool.connect = (async () => {
        const staged = new Map<string, typeof committed extends Map<string, infer V> ? V : never>();
        const receipts: { id: string; valor: number }[] = [];
        let unlock: (() => void) | undefined;
        const rows = (items: unknown[]) => ({ rows: items, rowCount: items.length });
        return {
            release() {},
            async query(sql: string, values: unknown[] = []) {
                if (sql === "BEGIN") return rows([]);
                if (sql === "COMMIT" || sql === "ROLLBACK") {
                    if (sql === "COMMIT") { for (const [id, row] of staged) committed.set(id, row); receiptCount += receipts.length; }
                    unlock?.(); return rows([]);
                }
                if (sql.includes("FOR UPDATE OF e") || sql.startsWith("SELECT id FROM empresas")) {
                    if (!unlock) {
                        const previous = gate;
                        gate = new Promise<void>(resolve => { unlock = resolve; });
                        waits++;
                        await previous;
                    }
                    return rows([{ id: mapping.empresa_id }]);
                }
                if (sql.includes("FROM tipos_caixa_diario")) return rows([{ descricao: "Service/Zaal" }]);
                if (sql.includes("SELECT f.id")) return rows(Object.values(mapping.formas).map(id => ({ id, banco_id: bank })));
                if (sql.includes("FROM planos_contas")) return rows([{ id: values[1] === "Comerce" ? commercePlan : plan, tipo: "receber" }]);
                if (sql.includes("SELECT 1 FROM formas_pagamento")) return rows([{}]);
                if (sql.includes("SUM(valor)")) return rows([{ total: receipts.filter(row => row.id === values[1]).reduce((sum, row) => sum + row.valor, 0) }]);
                if (sql.includes("FROM lancamentos")) {
                    const all = new Map([...committed, ...staged]);
                    if (sql.includes("ANY($3::uuid[])")) return rows([...all.values()].filter(row => (values[1] as string[]).includes(row.data)));
                    if (sql.includes("SELECT 1 FROM")) return rows([...all.values()].filter(row => row.id === values[2] || (row.data === values[1] && (!values[4] || row.plano_conta_id === values[4]))));
                    return rows(all.has(String(values[1])) ? [all.get(String(values[1]))] : []);
                }
                if (sql.includes("INSERT INTO lancamentos")) {
                    const id = String(values[17]);
                    assert.equal(committed.has(id) || staged.has(id), false);
                    staged.set(id, { id, data: String(values[4]), valor: String(values[2]), tipo: String(values[3]), status: "pendente", plano_conta_id: String(values[11]), desconto: "0", acrescimo: "0" });
                    return rows([{ id }]);
                }
                if (sql.includes("INSERT INTO recebimentos")) { receipts.push({ id: String(values[1]), valor: Number(values[3]) }); return rows([{ id: values[7] }]); }
                if (sql.startsWith("UPDATE lancamentos SET status")) return rows([]);
                throw new Error(`SQL não previsto no teste: ${sql}`);
            },
        } as unknown as PoolClient;
    }) as typeof pool.connect;
    try {
        const results = await Promise.allSettled([importDailyCash(randomUUID(), input), importDailyCash(randomUUID(), different ? { ...input, sistema: "Comerce", arquivo: input.arquivo.replaceAll("Service/Zaal", "Comerce") } : input)]);
        assert.equal(results.filter(result => result.status === "fulfilled").length, 2);
        const reports = results.map(result => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof importDailyCash>>>).value);
        assert.equal(reports.reduce((sum, report) => sum + ("importados" in report ? report.importados : 0), 0), different ? 2 : 1);
        assert.equal(reports.reduce((sum, report) => sum + ("ignorados" in report ? report.ignorados : 0), 0), different ? 0 : 1);
        assert.equal(waits, 2); assert.equal(committed.size, different ? 2 : 1); assert.equal(receiptCount, different ? 6 : 3);
    } finally { pool.connect = connect; }
}
test("caixa: cargas concorrentes do mesmo Sistema gravam uma vez", () => race());
test("caixa: cargas concorrentes de Sistemas distintos gravam separadamente", () => race(true));
