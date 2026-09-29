import type { PoolClient } from "pg";

export type SettlementKind = "movimentacoes" | "recebimentos";
type SettlementConfig = { table: SettlementKind; launchType: "pagar" | "receber"; dateColumn: "data_movimentacao" | "data_recebimento" };

type SettlementInput = { lancamentoId: string; formaPagamentoId: string; valor: number; data?: string };
type SettlementPatch = { formaPagamentoId?: string; valor?: number; data?: string };

export class SettlementError extends Error {
    constructor(message: string, readonly status = 400) { super(message); }
}

function configFor(table: SettlementKind): SettlementConfig {
    return table === "movimentacoes"
        ? { table, launchType: "pagar", dateColumn: "data_movimentacao" }
        : { table, launchType: "receber", dateColumn: "data_recebimento" };
}

async function findLaunch(client: PoolClient, empresaId: string, lancamentoId: string, config: SettlementConfig) {
    const result = await client.query<{ valor: string; tipo: "pagar" | "receber"; status: string }>(
        "SELECT valor, tipo, status FROM lancamentos WHERE empresa_id = $1 AND id = $2 FOR UPDATE",
        [empresaId, lancamentoId],
    );
    const lancamento = result.rows[0];
    if (!lancamento) throw new SettlementError("Lançamento não encontrado", 404);
    if (lancamento.tipo !== config.launchType) throw new SettlementError("O tipo do lançamento é incompatível com esta operação", 409);
    if (lancamento.status === "cancelado") throw new SettlementError("Não é possível dar baixa em um lançamento cancelado", 409);
    return lancamento;
}

async function validatePaymentForm(client: PoolClient, empresaId: string, formaPagamentoId: string) {
    const result = await client.query(
        "SELECT 1 FROM formas_pagamento WHERE empresa_id = $1 AND id = $2 AND ativo = TRUE",
        [empresaId, formaPagamentoId],
    );
    if (!result.rowCount) throw new SettlementError("Forma de pagamento não encontrada ou inativa");
}

async function ensureValueFits(
    client: PoolClient,
    empresaId: string,
    lancamentoId: string,
    launchValue: number,
    value: number,
    config: SettlementConfig,
    ignoredId?: string,
) {
    const result = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(valor), 0) AS total FROM ${config.table}
         WHERE empresa_id = $1 AND lancamento_id = $2 AND ($3::uuid IS NULL OR id <> $3)`,
        [empresaId, lancamentoId, ignoredId ?? null],
    );
    const total = Number(result.rows[0].total);
    const remaining = Math.round((launchValue - total) * 100) / 100;
    if (value - remaining > 0.009) throw new SettlementError(`O valor informado é maior que o saldo de ${remaining.toFixed(2)}`, 409);
}

async function refreshLaunchStatus(client: PoolClient, empresaId: string, lancamentoId: string, config: SettlementConfig) {
    const launchResult = await client.query<{ valor: string; status: string }>(
        "SELECT valor, status FROM lancamentos WHERE empresa_id = $1 AND id = $2 FOR UPDATE",
        [empresaId, lancamentoId],
    );
    const launch = launchResult.rows[0];
    if (!launch || launch.status === "cancelado") return { status: launch?.status ?? "pendente", saldo: 0 };
    const sumResult = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(valor), 0) AS total FROM ${config.table} WHERE empresa_id = $1 AND lancamento_id = $2`,
        [empresaId, lancamentoId],
    );
    const total = Number(sumResult.rows[0].total);
    const value = Number(launch.valor);
    const status = total >= value - 0.005 ? "pago" : total > 0 ? "parcial" : "pendente";
    await client.query("UPDATE lancamentos SET status = $1 WHERE empresa_id = $2 AND id = $3", [status, empresaId, lancamentoId]);
    return { status, saldo: Math.max(0, Math.round((value - total) * 100) / 100) };
}

export async function createSettlement(client: PoolClient, empresaId: string, table: SettlementKind, input: SettlementInput) {
    const config = configFor(table);
    const launch = await findLaunch(client, empresaId, input.lancamentoId, config);
    await validatePaymentForm(client, empresaId, input.formaPagamentoId);
    await ensureValueFits(client, empresaId, input.lancamentoId, Number(launch.valor), input.valor, config);
    const result = await client.query<{ id: string }>(
        `INSERT INTO ${config.table} (empresa_id, lancamento_id, forma_pagamento_id, valor, ${config.dateColumn})
         VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE)) RETURNING id`,
        [empresaId, input.lancamentoId, input.formaPagamentoId, input.valor.toFixed(2), input.data ?? null],
    );
    const launchStatus = await refreshLaunchStatus(client, empresaId, input.lancamentoId, config);
    return { id: result.rows[0].id, ...launchStatus };
}

export async function updateSettlement(client: PoolClient, empresaId: string, table: SettlementKind, id: string, input: SettlementPatch) {
    const config = configFor(table);
    const existingResult = await client.query<{ lancamento_id: string; forma_pagamento_id: string; valor: string; data: string }>(
        `SELECT lancamento_id, forma_pagamento_id, valor, ${config.dateColumn}::text AS data
         FROM ${config.table} WHERE empresa_id = $1 AND id = $2 FOR UPDATE`,
        [empresaId, id],
    );
    const existing = existingResult.rows[0];
    if (!existing) throw new SettlementError("Registro não encontrado", 404);
    const launch = await findLaunch(client, empresaId, existing.lancamento_id, config);
    const value = input.valor ?? Number(existing.valor);
    const paymentFormId = input.formaPagamentoId ?? existing.forma_pagamento_id;
    await validatePaymentForm(client, empresaId, paymentFormId);
    await ensureValueFits(client, empresaId, existing.lancamento_id, Number(launch.valor), value, config, id);
    const result = await client.query<{ id: string }>(
        `UPDATE ${config.table} SET forma_pagamento_id = $1, valor = $2, ${config.dateColumn} = COALESCE($3::date, ${config.dateColumn})
         WHERE empresa_id = $4 AND id = $5 RETURNING id`,
        [paymentFormId, value.toFixed(2), input.data ?? null, empresaId, id],
    );
    await refreshLaunchStatus(client, empresaId, existing.lancamento_id, config);
    return result.rows[0].id;
}

export async function deleteSettlement(client: PoolClient, empresaId: string, table: SettlementKind, id: string) {
    const config = configFor(table);
    const existingResult = await client.query<{ lancamento_id: string }>(
        `SELECT lancamento_id FROM ${config.table} WHERE empresa_id = $1 AND id = $2 FOR UPDATE`,
        [empresaId, id],
    );
    const existing = existingResult.rows[0];
    if (!existing) throw new SettlementError("Registro não encontrado", 404);
    const result = await client.query<{ id: string }>(
        `DELETE FROM ${config.table} WHERE empresa_id = $1 AND id = $2 RETURNING id`,
        [empresaId, id],
    );
    await refreshLaunchStatus(client, empresaId, existing.lancamento_id, config);
    return result.rows[0].id;
}




