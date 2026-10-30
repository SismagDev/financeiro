import type { Row } from "../types";
import { competenceDate, competenceLabel } from "./dates";

// Prévia das regras de createLaunches: vencimentos em dias, competência mensal e rateio em centavos.
export function installmentPreview(account: Row, count: number, mode: string, due: string, competence: string, intervals?: number[]) {
    const baseCompetence = competenceDate(competence);
    if (!due || !baseCompetence || !Number.isInteger(count) || count < 1 || count > 60 ||
        !Number.isFinite(Number(account.valor)) || Number(account.valor) <= 0 ||
        (intervals && (intervals.length !== count || intervals.some(value => !Number.isInteger(value) || value <= 0)))) return [];
    const split = (value: number, index: number) => {
        const cents = Math.round(value * (mode === "parcela" ? count : 1) * 100);
        return (Math.floor(cents / count) + (index < cents % count ? 1 : 0)) / 100;
    };
    return Array.from({ length: count }, (_, index) => {
        const date = new Date(`${due}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() + (intervals ? intervals[index] : index * 30));
        const month = new Date(`${baseCompetence}T00:00:00Z`);
        month.setUTCMonth(month.getUTCMonth() + index);
        return { numero: index + 1, vencimento: date.toISOString().slice(0, 10), competencia: competenceLabel(month.toISOString()),
            valor: split(Number(account.valor), index), desconto: split(Number(account.desconto || 0), index), acrescimo: split(Number(account.acrescimo || 0), index) };
    });
}

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
