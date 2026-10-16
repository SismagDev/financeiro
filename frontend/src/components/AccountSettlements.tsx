import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import { Pagination } from "./Pagination";
import { SettlementFilters } from "./SettlementFilters";
import { usePagination } from "../hooks/usePagination";
import { matchesAccount, matchesSettlementFilters, remainingAmount } from "../utils/accounts";
import type { Row } from "../types";

type Props = {
    account: Row; data: Record<string, Row[]>; busy: boolean;
    formatValue: (key: string, value: Row[string]) => string;
    onRemove: (row: Row) => void; onSettle: () => void;
};
export function AccountSettlements({ account, data, busy, formatValue, onRemove, onSettle }: Props) {
    const [search, setSearch] = useState("");
    const [filters, setFilters] = useState({ formaPagamento: "", dataInicial: "", dataFinal: "" });
    const records = data[account.tipo === "receber" ? "recebimentos" : "movimentacoes"] || [];
    const rows = useMemo(() => records.filter(row => row.lancamento_id === account.id &&
        matchesAccount(account, search, data.pessoas || []) && matchesSettlementFilters(row, filters))
        .sort((a, b) => String(b.data_recebimento || b.data_movimentacao || "").localeCompare(String(a.data_recebimento || a.data_movimentacao || "")) ||
            String(b.created_at || "").localeCompare(String(a.created_at || ""))), [records, account, search, filters, data.pessoas]);
    const pagination = usePagination(rows, JSON.stringify({ account: account.id, search, filters }));
    const canSettle = account.status !== "pago" && account.status !== "cancelado" && remainingAmount(account, data) > 0;
    return <section className="account-settlements" aria-label="Baixas da conta">
        <div className="settlement-heading"><div><h3>Baixas da conta {String(account.numero || "")}</h3>
            <p>Saldo em aberto: {formatValue("valor", remainingAmount(account, data))}</p></div>
            {canSettle && <button type="button" className="button button-primary" disabled={busy} onClick={onSettle}>
                <Icon name="plus" size={17} /> Dar baixa</button>}
        </div>
        <SettlementFilters search={search} onSearch={setSearch} filters={filters} onChange={setFilters} paymentForms={data.formas || []} />
        <div className="table-wrap"><table className="data-table settlement-table">
            <thead><tr><th>Data de pagamento</th><th>Forma de pagamento</th><th>Valor</th><th aria-label="Ações" /></tr></thead>
            <tbody>{pagination.pageRows.map(row => <tr key={String(row.id)}>
                <td>{formatValue("data_baixa", row.data_recebimento || row.data_movimentacao)}</td>
                <td>{formatValue("forma_pagamento_id", row.forma_pagamento_id)}</td>
                <td className="amount-cell">{formatValue("valor", row.valor)}</td>
                <td><button type="button" className="icon-button" disabled={busy} title="Excluir baixa" aria-label="Excluir esta baixa"
                    onClick={() => onRemove(row)}><Icon name="trash" size={16} /></button></td>
            </tr>)}</tbody>
        </table></div>
        {!rows.length && <p role="status">Nenhuma baixa encontrada para esta conta e estes filtros.</p>}
        <Pagination total={rows.length} page={pagination.page} pageCount={pagination.pageCount} onPageChange={pagination.onPageChange} />
    </section>;
}
