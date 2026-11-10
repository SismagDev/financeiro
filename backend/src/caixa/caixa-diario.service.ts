import { pool } from "../db";
import type { PoolClient } from "pg";
import { z } from "zod";
import { adjustmentSchema } from "../lancamentos/launch-values";
import { importId } from "../utils/access-import";
import { createLaunches } from "../lancamentos/lancamentos.service";
import { createSettlement, SettlementError } from "../lancamentos/settlement.service";

export const dailyCashSchema = z.object({
    data: z.string().date(), tipo_caixa_diario_id: z.string().uuid(), valor: adjustmentSchema.refine(value => value > 0),
    observacoes: z.string().trim().max(5000).nullable().optional(),
    baixas: z.array(z.object({ banco_id: z.string().uuid(), forma_pagamento_id: z.string().uuid(),
        valor: adjustmentSchema.refine(value => value > 0) }).strict()).max(500),
}).strict();
export type DailyCashInput = z.infer<typeof dailyCashSchema>;
export const dailyCashImportId = (empresaId: string, date: string) => importId(empresaId, "lancamentos", `caixa-diario:${date}`);

export async function createDailyCash(empresaId: string, input: DailyCashInput, transactionClient?: PoolClient, imported = false, historical = false) {
    const client = transactionClient ?? await pool.connect();
    try {
        if (!transactionClient) await client.query("BEGIN");
        // O mesmo bloqueio protege importação, resolução manual e criação normal.
        await client.query("SELECT id FROM empresas WHERE id = $1 FOR UPDATE", [empresaId]);
        const existing = await client.query(
            `SELECT 1 FROM lancamentos WHERE empresa_id = $1 AND (id = $3 OR
             ($4::boolean AND tipo_caixa_diario_id IS NOT NULL AND data_vencimento = $2::date)) LIMIT 1`,
            [empresaId, input.data, dailyCashImportId(empresaId, input.data), imported]);
        if (existing.rowCount) throw new SettlementError(`Já existe Caixa Diário em ${input.data}`, 409);
        const type = await client.query<{ descricao: string }>(
            "SELECT descricao FROM tipos_caixa_diario WHERE empresa_id = $1 AND id = $2 FOR SHARE", [empresaId, input.tipo_caixa_diario_id]);
        if (!type.rows[0]) throw new SettlementError("Tipo de caixa não encontrado nesta empresa");
        // Serializa a obtenção/criação do plano por empresa, inclusive entre requisições simultâneas.
        let plan = (await client.query<{ id: string; tipo: string }>(
            "SELECT id, tipo FROM planos_contas WHERE empresa_id = $1 AND lower(btrim(descricao)) = lower('Caixa Diário') ORDER BY created_at, id LIMIT 1 FOR UPDATE", [empresaId])).rows[0];
        if (!plan) plan = (await client.query<{ id: string; tipo: string }>(
            "INSERT INTO planos_contas (empresa_id, descricao, tipo) VALUES ($1, 'Caixa Diário', 'receber') RETURNING id, tipo", [empresaId])).rows[0]!;
        else if (plan.tipo === "pagar") await client.query("UPDATE planos_contas SET tipo = 'ambos' WHERE empresa_id = $1 AND id = $2", [empresaId, plan.id]);
        const result = await createLaunches(empresaId, {
            descricao: type.rows[0].descricao, tipo: "receber", valor: input.valor, data_vencimento: input.data,
            observacoes: input.observacoes, plano_conta_id: plan.id, tipo_caixa_diario_id: input.tipo_caixa_diario_id,
        }, client, imported ? dailyCashImportId(empresaId, input.data) : undefined);
        for (const settlement of input.baixas) await createSettlement(client, empresaId, "recebimentos", {
            lancamentoId: result.id!, bancoId: settlement.banco_id, formaPagamentoId: settlement.forma_pagamento_id,
            valor: settlement.valor, data: input.data,
        }, historical && imported ? "importacao" : undefined);
        if (!transactionClient) await client.query("COMMIT");
        return result;
    } catch (error) { if (!transactionClient) await client.query("ROLLBACK"); throw error; }
    finally { if (!transactionClient) client.release(); }
}
