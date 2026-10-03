import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { deleteSettlement, type SettlementKind } from "../src/lancamentos/settlement.service";

for (const table of ["movimentacoes", "recebimentos"] as SettlementKind[]) {
    test(`remover uma de múltiplas baixas em ${table} preserva conta, outras baixas e recalcula status`, async () => {
        const empresaId = "11111111-1111-4111-8111-111111111111";
        const launchId = "22222222-2222-4222-8222-222222222222";
        const records = new Map([["primeira", 40], ["segunda", 60], ["outra-conta", 25]]);
        let status = "pago";
        const client = {
            async query(sql: string, values: unknown[]) {
                assert.ok(sql.includes("empresa_id ="), "Toda consulta deve respeitar a empresa");
                if (sql.startsWith(`SELECT lancamento_id FROM ${table}`)) {
                    assert.equal(values[0], empresaId);
                    return { rows: records.has(String(values[1])) ? [{ lancamento_id: launchId }] : [] };
                }
                if (sql.startsWith(`DELETE FROM ${table}`)) {
                    assert.equal(values[0], empresaId);
                    records.delete(String(values[1]));
                    return { rows: [{ id: values[1] }] };
                }
                if (sql.includes("FROM lancamentos")) {
                    assert.deepEqual(values, [empresaId, launchId]);
                    return { rows: [{ valor: "100", status }] };
                }
                if (sql.includes("SUM(valor)")) {
                    assert.ok(sql.includes(`FROM ${table}`));
                    assert.deepEqual(values, [empresaId, launchId]);
                    return { rows: [{ total: String((records.get("primeira") || 0) + (records.get("segunda") || 0)) }] };
                }
                if (sql.startsWith("UPDATE lancamentos SET status")) {
                    assert.deepEqual(values.slice(1), [empresaId, launchId]);
                    status = String(values[0]);
                    return { rows: [] };
                }
                assert.fail(`Consulta inesperada: ${sql}`);
            },
        } as unknown as PoolClient;
        assert.equal(await deleteSettlement(client, empresaId, table, "primeira"), "primeira");
        assert.equal(status, "parcial");
        assert.equal(records.get("segunda"), 60);
        assert.equal(records.get("outra-conta"), 25);
        assert.equal(100 - (records.get("segunda") || 0), 40);
        await deleteSettlement(client, empresaId, table, "segunda");
        assert.equal(status, "pendente");
        assert.equal(records.get("outra-conta"), 25);
        await assert.rejects(() => deleteSettlement(client, empresaId, table, "inexistente"), /Registro não encontrado/);
    });
}
