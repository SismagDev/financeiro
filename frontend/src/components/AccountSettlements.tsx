import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import { SettlementFilters } from "./SettlementFilters";
import { matchesSettlementFilters, remainingAmount } from "../utils/accounts";
import type { Row } from "../types";

type Props = {
    account: Row; data: Record<string, Row[]>; busy: boolean;
    formatValue: (key: string, value: Row[string]) => string;
    onRemove: (row: Row) => void; onSettle: () => void;
};
export function AccountSettlements({ account, data, busy, formatValue, onRemove, onSettle }: Props) {
    const [filters, setFilters] = useState({ formaPagamento: "", dataInicial: "", dataFinal: "" });
    const rows = useMemo(() => (data[account.tipo === "receber" ? "recebimentos" : "movimentacoes"] || []).filter(row => row.lancamento_id === account.id &&
        matchesSettlementFilters(row, filters))
        .sort((a, b) => String(b.data_recebimento || b.data_movimentacao || "").localeCompare(String(a.data_recebimento || a.data_movimentacao || "")) ||
            String(b.created_at || "").localeCompare(String(a.created_at || ""))), [data, account.id, account.tipo, filters]);
    const canSettle = account.status !== "pago" && account.status !== "cancelado" && remainingAmount(account, data) > 0;
    return <section className="account-settlements" aria-label="Baixas da conta">
        <div className="settlement-heading"><div><h3>Baixas da conta {String(account.numero || "")}</h3>
            <p>Saldo em aberto: {formatValue("valor", remainingAmount(account, data))}</p></div>
            {canSettle && <button type="button" className="button button-primary" disabled={busy} onClick={onSettle}>
                <Icon name="plus" size={17} /> Dar baixa</button>}
        </div>
        <SettlementFilters filters={filters} onChange={setFilters} paymentForms={data.formas || []}>
            <button type="button" className="filter-button reset-settlement-filters" onClick={() => setFilters({ formaPagamento: "", dataInicial: "", dataFinal: "" })}>Remover filtros</button>
        </SettlementFilters>
        <div className="table-wrap settlement-list"><table className="data-table settlement-table">
            <thead><tr><th>Data de pagamento</th><th>Forma de pagamento</th><th>Valor</th><th aria-label="Ações" /></tr></thead>
            <tbody>{rows.map(row => <tr key={String(row.id)}>
                <td>{formatValue("data_baixa", row.data_recebimento || row.data_movimentacao)}</td>
                <td>{formatValue("forma_pagamento_id", row.forma_pagamento_id)}</td>
                <td className="amount-cell">{formatValue("valor", row.valor)}</td>
                <td className="row-actions delete-actions"><button type="button" className="row-delete" disabled={busy} title="Excluir baixa" aria-label="Excluir esta baixa"
                    onClick={() => onRemove(row)}><Icon name="trash" size={16} /></button></td>
            </tr>)}</tbody>
        </table></div>
        {!rows.length && <p role="status">Nenhuma baixa encontrada para esta conta e estes filtros.</p>}
    </section>;
}
