import { pool } from "../db";
import { createLaunches } from "../lancamentos/lancamentos.service";
import { createSettlement, SettlementError } from "../lancamentos/settlement.service";

type DailyCashInput = {
    data: string; tipo_caixa_diario_id: string; valor: number; observacoes?: string | null;
    baixas: { banco_id: string; forma_pagamento_id: string; valor: number }[];
};

export async function createDailyCash(empresaId: string, input: DailyCashInput) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const type = await client.query<{ descricao: string }>(
            "SELECT descricao FROM tipos_caixa_diario WHERE empresa_id = $1 AND id = $2 FOR SHARE", [empresaId, input.tipo_caixa_diario_id]);
        if (!type.rows[0]) throw new SettlementError("Tipo de caixa não encontrado nesta empresa");
        // Serializa a obtenção/criação do plano por empresa, inclusive entre requisições simultâneas.
        await client.query("SELECT id FROM empresas WHERE id = $1 FOR UPDATE", [empresaId]);
        let plan = (await client.query<{ id: string; tipo: string }>(
            "SELECT id, tipo FROM planos_contas WHERE empresa_id = $1 AND lower(btrim(descricao)) = lower('Caixa Diário') ORDER BY created_at, id LIMIT 1 FOR UPDATE", [empresaId])).rows[0];
        if (!plan) plan = (await client.query<{ id: string; tipo: string }>(
            "INSERT INTO planos_contas (empresa_id, descricao, tipo) VALUES ($1, 'Caixa Diário', 'receber') RETURNING id, tipo", [empresaId])).rows[0]!;
        else if (plan.tipo === "pagar") await client.query("UPDATE planos_contas SET tipo = 'ambos' WHERE empresa_id = $1 AND id = $2", [empresaId, plan.id]);
        const result = await createLaunches(empresaId, {
            descricao: type.rows[0].descricao, tipo: "receber", valor: input.valor, data_vencimento: input.data,
            observacoes: input.observacoes, plano_conta_id: plan.id, tipo_caixa_diario_id: input.tipo_caixa_diario_id,
        }, client);
        for (const settlement of input.baixas) await createSettlement(client, empresaId, "recebimentos", {
            lancamentoId: result.id!, bancoId: settlement.banco_id, formaPagamentoId: settlement.forma_pagamento_id,
            valor: settlement.valor, data: input.data,
        });
        await client.query("COMMIT");
        return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
}
