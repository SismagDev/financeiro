// Opt-in: valida a migration e o service somente em tabela temporária, sem dados reais.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pool } from "../src/db";
import { updateCompanySettings } from "../src/empresas/empresas.service";
import { alertsSummary, dashboardSummary } from "../src/resources/list.service";
import { createLaunches, type LaunchInput } from "../src/lancamentos/lancamentos.service";
import { cloneAccountValues } from "../../frontend/src/utils/account-form";

async function run() {
    const client = await pool.connect();
    const query = pool.query;
    try {
        await client.query("CREATE TEMP TABLE empresas (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome TEXT NOT NULL, caixa_data_inicio TIMESTAMPTZ)");
        const migration = await readFile("migrations/016_preferencias_empresa.sql", "utf8");
        await client.query(migration);
        await client.query(migration);
        const rows = await client.query("INSERT INTO empresas (nome) VALUES ('Sintética A'), ('Sintética B') RETURNING *");
        const [a, b] = rows.rows;
        assert.equal(a.contas_modo_valor, "total");
        assert.equal(a.vencimento_dias_urgente, 1);
        assert.equal(a.vencimento_dias_atencao, 7);
        assert.equal(a.avisar_contas_vencidas, true);
        // A conexão mantém a tabela temporária à frente da tabela real no search_path.
        pool.query = client.query.bind(client) as typeof pool.query;
        await updateCompanySettings(a.id, { nome: "Sintética A", contas_modo_valor: "parcela", vencimento_dias_urgente: 0, vencimento_dias_atencao: 14, avisar_contas_vencidas: false });
        await updateCompanySettings(a.id, { nome: "Sintética A atualizada" });
        const saved = await client.query("SELECT * FROM empresas WHERE id = $1", [a.id]);
        assert.equal(saved.rows[0].contas_modo_valor, "parcela");
        assert.equal(saved.rows[0].vencimento_dias_atencao, 14);
        const unchanged = await client.query("SELECT * FROM empresas WHERE id = $1", [b.id]);
        assert.deepEqual(unchanged.rows[0], b);
        await assert.rejects(client.query("UPDATE empresas SET vencimento_dias_atencao = 0 WHERE id = $1", [a.id]), { code: "23514" });
        for (const table of ["lancamentos", "movimentacoes", "recebimentos", "pessoas", "planos_contas", "formas_pagamento", "bancos"]) {
            await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS)`);
        }
        // Evita consumir a sequência da tabela real ao criar a conta sintética.
        await client.query("ALTER TABLE pg_temp.lancamentos ALTER COLUMN numero SET DEFAULT 1000");
        await client.query(`INSERT INTO lancamentos (id, empresa_id, numero, descricao, valor, tipo, status, data_vencimento, competencia)
            VALUES (gen_random_uuid(), $1, 1, 'Parcial vencida A', 100, 'receber', 'parcial', '2026-11-10', '2026-11-01'),
                (gen_random_uuid(), $2, 2, 'Pendente vencida B', 100, 'pagar', 'pendente', '2026-11-10', '2026-11-01'),
                (gen_random_uuid(), $2, 3, 'Quitada B', 100, 'pagar', 'pago', '2026-11-10', '2026-11-01'),
                (gen_random_uuid(), $2, 4, 'Cancelada B', 100, 'pagar', 'cancelado', '2026-11-10', '2026-11-01')`, [a.id, b.id]);
        for (const summary of [await alertsSummary([a.id, b.id], "2026-11-11"), await dashboardSummary([a.id, b.id], "2026-11-11")]) {
            assert.equal(summary.data.overdue, 2, "avisos incluem contas parciais vencidas, sem pagas e canceladas");
            assert.equal(summary.data.automaticOverdue, 1, "abertura automática considera somente empresas com a preferência ativa");
        }
        const source = (await client.query("SELECT * FROM lancamentos WHERE descricao = 'Quitada B'")).rows[0];
        const clone = cloneAccountValues({ ...source, data_vencimento: "2026-11-10", competencia: "2026-11-01" });
        const created = await createLaunches(b.id, clone as LaunchInput, client);
        const savedClone = (await client.query("SELECT * FROM lancamentos WHERE id = $1", [created.id])).rows[0];
        assert.notEqual(savedClone.id, source.id);
        assert.equal(savedClone.empresa_id, b.id);
        assert.equal(savedClone.status, "pendente");
        assert.equal(savedClone.grupo_parcelamento_id, null);
        assert.deepEqual((await client.query("SELECT * FROM lancamentos WHERE id = $1", [source.id])).rows[0], source);
        assert.equal((await client.query("SELECT COUNT(*)::int AS total FROM movimentacoes WHERE lancamento_id = $1", [created.id])).rows[0].total, 0);
        assert.equal((await client.query("SELECT COUNT(*)::int AS total FROM recebimentos WHERE lancamento_id = $1", [created.id])).rows[0].total, 0);
        console.log("OK: migration idempotente, padrões, persistência, preservação por omissão, isolamento entre empresas e constraint — tabela temporária.");
        console.log("OK: avisos manuais/automáticos respeitam empresas, contas parciais, pagas e canceladas — tabelas temporárias.");
        console.log("OK: clone salvo pelo service existente com novo UUID, pendente, sem baixas, sem grupo e sem alterar origem — tabelas temporárias.");
    } finally {
        pool.query = query;
        client.release();
        await pool.end();
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
