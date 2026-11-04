import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { SettlementFilters } from "./SettlementFilters";
import { remainingAmount } from "../utils/accounts";
import type { ListMeta, OptionLoader, Row } from "../types";
import { Pagination } from "./Pagination";
import { AccountValueSummary } from "./AccountValue";

type Props = {
    account: Row; data: Record<string, Row[]>; busy: boolean;
    formatValue: (key: string, value: Row[string]) => string;
    onRemove: (row: Row) => void; onSettle: () => void;
    loadOptions?: OptionLoader;
    loadSettlements: (filters: { formaPagamento: string; dataInicial: string; dataFinal: string }, page: number) => Promise<{ data: Row[]; meta: ListMeta }>;
    reloadKey: number;
    compact?: boolean;
    drafts?: Row[];
};
export function AccountSettlements({ account, data, busy, formatValue, onRemove, onSettle, loadOptions, loadSettlements, reloadKey, compact = false, drafts = [] }: Props) {
    const [filters, setFilters] = useState({ formaPagamento: "", dataInicial: "", dataFinal: "" });
    const [pagination, setPagination] = useState({ key: "", page: 1 });
    const key = JSON.stringify([account.id, filters]);
    const page = pagination.key === key ? pagination.page : 1;
    const [result, setResult] = useState<{ key: string; data: Row[]; meta: ListMeta } | null>(null);
    const [error, setError] = useState("");
    const [pending, setPending] = useState(true);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let active = true;
        const timer = window.setTimeout(() => {
            setPending(true); setError("");
            void (async () => {
                const first = await loadSettlements(filters, page);
                if (!compact) return first;
                const data = [...first.data];
                for (let next = 2; next <= first.meta.paginas; next++) {
                    if (!active) return first;
                    data.push(...(await loadSettlements(filters, next)).data);
                }
                return { ...first, data };
            })().then(response => {
                if (active) setResult({ key, ...response });
            }).catch(error => { if (active) { setResult(null); setError(error instanceof Error ? error.message : "Não foi possível carregar as baixas."); } })
                .finally(() => { if (active) setPending(false); });
        }, 200);
        return () => { active = false; window.clearTimeout(timer); };
    }, [filters, page, key, loadSettlements, reloadKey, retry, compact]);
    const rows = [...drafts, ...(result?.key === key ? result.data : [])];
    const canSettle = account.status !== "pago" && account.status !== "cancelado" && remainingAmount(account, data) > 0;
    return <section className="account-settlements" aria-label="Baixas da conta">
        {!compact && <AccountValueSummary account={account} />}
        <div className="settlement-heading"><div><h3>{compact ? "Baixas da Conta" : `Baixas da conta ${String(account.numero || "")}`}</h3>
            <p>Saldo em aberto: {formatValue("valor", remainingAmount(account, data))}</p></div>
            {canSettle && <button type="button" className="button button-primary" disabled={busy} onClick={onSettle}>
                <Icon name="plus" size={17} /> Dar baixa</button>}
        </div>
        {!compact && <SettlementFilters filters={filters} onChange={setFilters} paymentForms={data.formas || []} loadOptions={loadOptions}>
            <button type="button" className="filter-button reset-settlement-filters" onClick={() => setFilters({ formaPagamento: "", dataInicial: "", dataFinal: "" })}>Remover filtros</button>
        </SettlementFilters>}
        <div className="table-wrap settlement-list"><table className="data-table settlement-table">
            <thead><tr><th>Data de pagamento</th><th>Forma de pagamento</th><th>Valor</th><th aria-label="Ações" /></tr></thead>
            <tbody>{rows.map(row => <tr key={String(row.id)}>
                <td>{formatValue("data_baixa", row.data_recebimento || row.data_movimentacao)}</td>
                <td>{row.forma_pagamento_descricao || formatValue("forma_pagamento_id", row.forma_pagamento_id)}</td>
                <td className="amount-cell">{formatValue("valor", row.valor)}
                    {row.pendente && <small className="settlement-adjustment-note">Pendente de salvar</small>}
                    {Number(row.desconto) > 0 && <small className="settlement-adjustment-note">Desconto: {formatValue("valor", row.desconto)}</small>}
                    {Number(row.acrescimo) > 0 && <small className="settlement-adjustment-note">Acréscimo: {formatValue("valor", row.acrescimo)}</small>}
                </td>
                <td className="row-actions delete-actions"><button type="button" className="row-delete" disabled={busy} title="Excluir baixa" aria-label="Excluir esta baixa"
                    onClick={() => onRemove(row)}><Icon name="trash" size={16} /></button></td>
            </tr>)}</tbody>
        </table></div>
        {pending && <p role="status">Carregando baixas...</p>}
        {error && <p role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></p>}
        {!pending && !error && !rows.length && <p role="status">{compact ? "Nenhuma baixa encontrada para esta conta." : "Nenhuma baixa encontrada para esta conta e estes filtros."}</p>}
        {!compact && result?.key === key && <Pagination total={result.meta.total} page={result.meta.pagina} pageCount={result.meta.paginas} onPageChange={next => setPagination({ key, page: next })} />}
    </section>;
}
