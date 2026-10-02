import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { createSettlement, SettlementError } from "./settlement.service";

export type LaunchInput = {
    descricao: string; valor: number; tipo: "pagar" | "receber";
    data_vencimento: string; competencia?: string;
    pessoa_id?: string | null; banco_id?: string | null; plano_conta_id?: string | null;
    status?: "pendente" | "parcial" | "pago" | "cancelado";
    parcelas?: number; modo_valor?: "total" | "parcela"; intervalos?: number[];
    forma_pagamento_id?: string;
};

export function installmentCompetence(value: string, index = 0) {
    const [year, month] = value.split("-").map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year!, month! - 1 + index, 1);
    return date.toISOString().slice(0, 10);
}

export async function createLaunches(empresaId: string, input: LaunchInput) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const parcelas = input.parcelas ?? 1;
        if (input.intervalos && input.intervalos.length !== parcelas)
            throw new SettlementError("Informe um vencimento em dias para cada parcela");
        for (const [field, table] of [["pessoa_id", "pessoas"], ["banco_id", "bancos"], ["plano_conta_id", "planos_contas"]] as const) {
            if (!input[field]) continue;
            const result = await client.query(`SELECT 1 FROM ${table} WHERE empresa_id = $1 AND id = $2`, [empresaId, input[field]]);
            if (!result.rowCount) throw new SettlementError("Uma referência não existe ou pertence a outra empresa");
        }
        const totalCentavos = Math.round(input.valor * (input.modo_valor === "parcela" ? parcelas : 1) * 100);
        const base = Math.floor(totalCentavos / parcelas);
        if (base < 1) throw new SettlementError("O valor é muito baixo para esse número de parcelas");
        const grupoId = parcelas > 1 ? randomUUID() : null;
        const dataBase = new Date(`${input.data_vencimento}T00:00:00Z`);
        const ids: string[] = [];
        for (let index = 0; index < parcelas; index++) {
            const due = new Date(dataBase);
            due.setUTCDate(due.getUTCDate() + (input.intervalos ? input.intervalos[index]! : index * 30));
            const amount = (base + (index < totalCentavos % parcelas ? 1 : 0)) / 100;
            const result = await client.query<{ id: string }>(
                `INSERT INTO lancamentos
                    (empresa_id, descricao, valor, tipo, data_vencimento, pessoa_id, banco_id,
                     grupo_parcelamento_id, numero_parcela, total_parcelas, competencia, plano_conta_id, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
                [empresaId, input.descricao, amount.toFixed(2), input.tipo, due.toISOString().slice(0, 10),
                    input.pessoa_id ?? null, input.banco_id ?? null, grupoId, grupoId ? index + 1 : null, grupoId ? parcelas : null,
                    `${installmentCompetence(input.competencia ?? input.data_vencimento, index)}T00:00:00Z`,
                    input.plano_conta_id ?? null, input.status ?? "pendente"],
            );
            const id = result.rows[0]!.id;
            ids.push(id);
            if (input.forma_pagamento_id) await createSettlement(client, empresaId,
                input.tipo === "receber" ? "recebimentos" : "movimentacoes",
                { lancamentoId: id, formaPagamentoId: input.forma_pagamento_id, valor: amount });
        }
        await client.query("COMMIT");
        return parcelas > 1 ? { grupo_parcelamento_id: grupoId, parcelas, ids } : { id: ids[0] };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally { client.release(); }
}

