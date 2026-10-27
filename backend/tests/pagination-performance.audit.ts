import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";

// Cópias temporárias permitem ANALYZE representativo sem alterar estatísticas dos dados reais.
export async function auditPerformance(client: PoolClient, company: string, form: string) {
    const tables = ["lancamentos", "movimentacoes", "recebimentos"];
    for (const table of tables) {
        await client.query(`CREATE TEMP TABLE audit_${table} ON COMMIT DROP AS SELECT * FROM ${table} WHERE empresa_id=$1`, [company]);
        const indexes = await client.query("SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 AND indexname NOT IN ('idx_lancamentos_empresa_vencimento_id','idx_movimentacoes_empresa_conta_data_id','idx_recebimentos_empresa_conta_data_id')", [table]);
        for (const row of indexes.rows) await client.query(row.indexdef.replace(`ON public.${table}`, `ON audit_${table}`));
    }
    await client.query(`INSERT INTO audit_lancamentos (id,empresa_id,descricao,valor,tipo,status,data_vencimento,numero)
        SELECT gen_random_uuid(),$1,'Performance ' || n,100,'pagar','pendente','2026-11-05'::date,1000000+n FROM generate_series(1,6000) n`, [company]);
    for (const [table, date] of [["movimentacoes", "data_movimentacao"], ["recebimentos", "data_recebimento"]])
        await client.query(`INSERT INTO audit_${table} (id,empresa_id,lancamento_id,forma_pagamento_id,valor,${date})
            SELECT gen_random_uuid(),l.empresa_id,l.id,$2,1,'2026-11-05'::date FROM audit_lancamentos l CROSS JOIN generate_series(1,3) n
            WHERE l.empresa_id=$1 AND l.descricao LIKE 'Performance %'`, [company, form]);
    for (const table of tables) await client.query(`ANALYZE audit_${table}`);
    const account = (await client.query("SELECT id FROM audit_lancamentos WHERE empresa_id=$1 AND descricao='Performance 1'", [company])).rows[0].id;
    const queries = [
        { label: "contas por período", sql: "SELECT id FROM audit_lancamentos WHERE empresa_id=$1 AND data_vencimento >= '2026-10-01'::date AND data_vencimento < '2026-11-01'::date ORDER BY data_vencimento,id LIMIT 50", values: [company], index: "idx_lancamentos_empresa_vencimento_id" },
        { label: "pagamentos por conta", sql: "SELECT valor FROM audit_movimentacoes WHERE empresa_id=$1 AND lancamento_id=$2 ORDER BY data_movimentacao,id", values: [company, account], index: "idx_movimentacoes_empresa_conta_data_id" },
        { label: "recebimentos por conta", sql: "SELECT valor FROM audit_recebimentos WHERE empresa_id=$1 AND lancamento_id=$2 ORDER BY data_recebimento,id", values: [company, account], index: "idx_recebimentos_empresa_conta_data_id" },
    ];
    const explain = async (sql: string, values: string[]) => (await client.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, values)).rows[0]["QUERY PLAN"][0];
    const before = [];
    for (const query of queries) before.push(await explain(query.sql, query.values));
    const migration = await readFile("migrations/010_indices_listagens.sql", "utf8");
    await client.query(migration.replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "").replace(/ON (lancamentos|movimentacoes|recebimentos) /g, "ON audit_$1 "));
    for (const [i, query] of queries.entries()) {
        const after = await explain(query.sql, query.values);
        assert.ok(JSON.stringify(after.Plan).includes(query.index), `Plano deve usar ${query.index}`);
        console.log(`PERF ${query.label}: ${before[i]["Execution Time"]} ms -> ${after["Execution Time"]} ms`);
    }
}
