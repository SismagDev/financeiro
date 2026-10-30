import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../db";
import { createSettlement, SettlementError } from "./settlement.service";
import { liquidValue, validateLaunchAmounts } from "./launch-values";
import { isHistoricalRecord } from "../utils/access-import";

export type LaunchInput = {
    observacoes?: string | null;
    num_doc?: string | null;
    descricao: string; valor: number; tipo: "pagar" | "receber";
    desconto?: number; acrescimo?: number;
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

export async function createLaunches(empresaId: string, input: LaunchInput, transactionClient?: PoolClient, importId?: string) {
    const client = transactionClient ?? await pool.connect();
    try {
        if (!transactionClient) await client.query("BEGIN");
        validateLaunchAmounts(input);
        if (isHistoricalRecord(empresaId, "formas_pagamento", input.forma_pagamento_id))
            throw new SettlementError("Forma de pagamento reservada à importação");
        const parcelas = input.parcelas ?? 1;
        if (importId && parcelas !== 1) throw new SettlementError("O ID de importação exige uma conta única");
        if (input.intervalos && input.intervalos.length !== parcelas)
            throw new SettlementError("Informe um vencimento em dias para cada parcela");
        for (const [field, table] of [["pessoa_id", "pessoas"], ["banco_id", "bancos"], ["plano_conta_id", "planos_contas"]] as const) {
            if (!input[field]) continue;
            if (isHistoricalRecord(empresaId, table, input[field]) && !(transactionClient && importId))
                throw new SettlementError("Cadastro reservado à importação");
            const result = await client.query(`SELECT 1 FROM ${table} WHERE empresa_id = $1 AND id = $2${field === "plano_conta_id" ? " AND tipo IN ('ambos', $3)" : ""}`,
                field === "plano_conta_id" ? [empresaId, input[field], input.tipo] : [empresaId, input[field]]);
            if (!result.rowCount) throw new SettlementError("Uma referência não existe ou pertence a outra empresa" + (field === "plano_conta_id" ? ", ou o plano é incompatível com o tipo da conta" : ""));
        }
        const totalCentavos = Math.round(input.valor * (input.modo_valor === "parcela" ? parcelas : 1) * 100);
        const base = Math.floor(totalCentavos / parcelas);
        const split = (value: number) => {
            const cents = Math.round(value * (input.modo_valor === "parcela" ? parcelas : 1) * 100);
            return (index: number) => (Math.floor(cents / parcelas) + (index < cents % parcelas ? 1 : 0)) / 100;
        };
        const discountAt = split(input.desconto ?? 0), surchargeAt = split(input.acrescimo ?? 0);
        if (base < 1) throw new SettlementError("O valor é muito baixo para esse número de parcelas");
        const grupoId = parcelas > 1 ? randomUUID() : null;
        const dataBase = new Date(`${input.data_vencimento}T00:00:00Z`);
        const ids: string[] = [];
        for (let index = 0; index < parcelas; index++) {
            const due = new Date(dataBase);
            due.setUTCDate(due.getUTCDate() + (input.intervalos ? input.intervalos[index]! : index * 30));
            const amount = (base + (index < totalCentavos % parcelas ? 1 : 0)) / 100;
            const desconto = discountAt(index), acrescimo = surchargeAt(index);
            const net = liquidValue(validateLaunchAmounts({ valor: amount, desconto, acrescimo }));
            const result = await client.query<{ id: string }>(
                `INSERT INTO lancamentos
                    (empresa_id, descricao, valor, tipo, data_vencimento, pessoa_id, banco_id,
                     grupo_parcelamento_id, numero_parcela, total_parcelas, competencia, plano_conta_id, status, observacoes, num_doc, desconto, acrescimo, id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
                [empresaId, input.descricao, amount.toFixed(2), input.tipo, due.toISOString().slice(0, 10),
                    input.pessoa_id ?? null, input.banco_id ?? null, grupoId, grupoId ? index + 1 : null, grupoId ? parcelas : null,
                    `${installmentCompetence(input.competencia ?? input.data_vencimento, index)}T00:00:00Z`,
                    input.plano_conta_id ?? null, input.status === "cancelado" ? "cancelado" : net === 0 ? "pago" : input.status ?? "pendente",
                    input.observacoes ?? null, input.num_doc ?? null, desconto.toFixed(2), acrescimo.toFixed(2), importId ?? randomUUID()],
            );
            const id = result.rows[0]!.id;
            ids.push(id);
            if (input.forma_pagamento_id && net > 0) await createSettlement(client, empresaId,
                input.tipo === "receber" ? "recebimentos" : "movimentacoes",
                { lancamentoId: id, formaPagamentoId: input.forma_pagamento_id, valor: net });
        }
        if (!transactionClient) await client.query("COMMIT");
        return parcelas > 1 ? { grupo_parcelamento_id: grupoId, parcelas, ids } : { id: ids[0] };
    } catch (error) {
        if (!transactionClient) await client.query("ROLLBACK");
        throw error;
    } finally { if (!transactionClient) client.release(); }
}

export async function updateLaunch(empresaId: string, id: string, input: Partial<LaunchInput>) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const found = await client.query<{ valor: string; desconto: string; acrescimo: string; tipo: "pagar" | "receber"; status: string }>(
            "SELECT valor, desconto, acrescimo, tipo, status FROM lancamentos WHERE empresa_id = $1 AND id = $2 FOR UPDATE", [empresaId, id]);
        const previous = found.rows[0];
        if (!previous) throw new SettlementError("Registro não encontrado", 404);
        const net = liquidValue(validateLaunchAmounts({ ...previous, ...input }));
        const sums = await client.query<{ total: string }>(
            `SELECT COALESCE(SUM(valor), 0) AS total FROM (
                SELECT valor FROM recebimentos WHERE empresa_id = $1 AND lancamento_id = $2
                UNION ALL SELECT valor FROM movimentacoes WHERE empresa_id = $1 AND lancamento_id = $2
             ) baixas`, [empresaId, id]);
        const settled = Number(sums.rows[0].total);
        if (settled - net > 0.009) throw new SettlementError("O valor líquido não pode ser menor que o total já baixado", 409);
        if (settled > 0 && input.tipo && input.tipo !== previous.tipo) throw new SettlementError("Remova as baixas antes de alterar o tipo da conta", 409);
        for (const [field, table] of [["pessoa_id", "pessoas"], ["banco_id", "bancos"], ["plano_conta_id", "planos_contas"]] as const) {
            if (!input[field]) continue;
            if (isHistoricalRecord(empresaId, table, input[field])) throw new SettlementError("Cadastro reservado à importação");
            if (!(await client.query(`SELECT 1 FROM ${table} WHERE empresa_id = $1 AND id = $2`, [empresaId, input[field]])).rowCount)
                throw new SettlementError("Uma referência não existe ou pertence a outra empresa");
        }
        const entries = Object.entries(input).filter(([, value]) => value !== undefined);
        const nextStatus = previous.status === "cancelado" || net === liquidValue(previous) ? previous.status
            : settled >= net - 0.005 ? "pago" : settled > 0 ? "parcial" : "pendente";
        entries.push(["status", nextStatus]);
        const values: unknown[] = entries.map(([, value]) => value);
        values.push(empresaId, id);
        await client.query(`UPDATE lancamentos SET ${entries.map(([field], index) => `${field} = $${index + 1}`).join(", ")}
            WHERE empresa_id = $${values.length - 1} AND id = $${values.length}`, values);
        await client.query("COMMIT");
        return { id };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
}

