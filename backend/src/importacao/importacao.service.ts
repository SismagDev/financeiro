import type { PoolClient } from "pg";
import { pool } from "../db";
import { createLaunches } from "../lancamentos/lancamentos.service";
import { createSettlement, SettlementError } from "../lancamentos/settlement.service";
import { savePerson } from "../pessoas/pessoas.service";
import { importReport, prepareImport, type ImportInput, type ImportPlan } from "./importacao.plan";
import { isHistoricalRecord } from "../utils/access-import";

async function validateCompanies(client: PoolClient, userId: string, companies: string[]) {
    const result = await client.query<{ empresa_id: string }>(
        `SELECT ue.empresa_id FROM users_empresas ue JOIN empresas e ON e.id = ue.empresa_id
         WHERE ue.user_id = $1 AND ue.empresa_id = ANY($2::uuid[]) AND e.ativo = TRUE`, [userId, companies]);
    if (new Set(result.rows.map(row => row.empresa_id)).size !== companies.length)
        throw new SettlementError("Você não tem acesso a todas as filiais de destino", 403);
}

async function ensureNotImported(client: PoolClient, plan: ImportPlan) {
    const groups = { pessoas: plan.pessoas, bancos: plan.bancos, formas_pagamento: plan.formas, planos_contas: plan.planos, lancamentos: plan.contas };
    for (const [table, records] of Object.entries(groups)) {
        if (!records.length) continue;
        const existing = await client.query(`SELECT 1 FROM ${table} WHERE id = ANY($1::uuid[]) AND empresa_id = ANY($2::uuid[]) LIMIT 1`,
            [records.map(record => record.id), [...new Set(records.map(record => record.empresaId))]]);
        if (existing.rowCount) throw new SettlementError("Há registros desta importação no destino. A carga foi recusada para evitar duplicação", 409);
    }
}

export async function importAccess(userId: string, input: ImportInput) {
    const plan = prepareImport(input);
    const report = importReport(plan);
    const companies = Object.values(input.filiais).filter((id): id is string => Boolean(id)).sort();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        for (const company of companies) await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`importacao-access:${company}`]);
        await validateCompanies(client, userId, companies);
        await ensureNotImported(client, plan);
        if (input.simular) {
            await client.query("ROLLBACK");
            return { simulado: true, ...report };
        }
        for (const person of plan.pessoas) await savePerson(person.empresaId, person.values, undefined, client, person.id);
        for (const bank of plan.bancos) await client.query("INSERT INTO bancos (id, empresa_id, descricao, ativo) VALUES ($1, $2, $3, $4)",
            [bank.id, bank.empresaId, bank.values.descricao, bank.values.ativo]);
        for (const accountPlan of plan.planos) await client.query("INSERT INTO planos_contas (id, empresa_id, descricao) VALUES ($1, $2, $3)",
            [accountPlan.id, accountPlan.empresaId, accountPlan.values.descricao]);
        // Formas historicamente inativas precisam aceitar suas baixas antes de restaurar o estado do legado.
        for (const form of plan.formas) await client.query("INSERT INTO formas_pagamento (id, empresa_id, descricao, tipo, banco_id, ativo) VALUES ($1, $2, $3, $4, $5, $6)",
            [form.id, form.empresaId, form.values.descricao, form.values.tipo, form.values.banco_id, !isHistoricalRecord(form.empresaId, "formas_pagamento", form.id)]);
        for (const account of plan.contas) {
            await createLaunches(account.empresaId, account.input, client, account.id);
            for (const payment of account.payments) await createSettlement(client, account.empresaId,
                account.input.tipo === "pagar" ? "movimentacoes" : "recebimentos", {
                    lancamentoId: account.id, formaPagamentoId: payment.formaId, valor: payment.valor, data: payment.data,
                }, "importacao");
        }
        for (const form of plan.formas) if (form.values.ativo === false)
            await client.query("UPDATE formas_pagamento SET ativo = FALSE WHERE empresa_id = $1 AND id = $2", [form.empresaId, form.id]);
        await client.query("COMMIT");
        return { simulado: false, ...report };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
}
