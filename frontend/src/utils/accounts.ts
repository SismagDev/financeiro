import type { Row } from "../types";

export function netAmount(row: Row) {
    return (Math.round(Number(row.valor || 0) * 100) - Math.round(Number(row.desconto || 0) * 100)
        + Math.round(Number(row.acrescimo || 0) * 100)) / 100;
}

export function matchesAccount(account: Row, search: string, people: Row[]) {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    const person = people.find(item => item.id === account.pessoa_id);
    return !term || [person?.nome, account.descricao].some(value => String(value ?? "").toLocaleLowerCase("pt-BR").includes(term));
}

export function remainingAmount(row: Row, data: Record<string, Row[]>) {
    if (row.saldo !== undefined && row.saldo !== null) return Number(row.saldo);
    const records = row.tipo === "receber" ? data.recebimentos || [] : data.movimentacoes || [];
    const settled = records
        .filter(item => item.lancamento_id === row.id)
        .reduce((sum, item) => sum + Number(item.valor || 0), 0);
    return Math.max(0, Math.round((netAmount(row) - settled) * 100) / 100);
}

export function matchesSettlementFilters(row: Row, filters: { formaPagamento: string; dataInicial: string; dataFinal: string }) {
    if (filters.formaPagamento && row.forma_pagamento_id !== filters.formaPagamento) return false;
    // Mantém os demais filtros enquanto o usuário corrige um período inválido.
    if (filters.dataInicial && filters.dataFinal && filters.dataInicial > filters.dataFinal) return true;
    const day = String(row.data_baixa || row.data_recebimento || row.data_movimentacao || "").slice(0, 10);
    return (!filters.dataInicial || day >= filters.dataInicial) && (!filters.dataFinal || day <= filters.dataFinal);
}
