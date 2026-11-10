import { useCallback, type ReactNode } from "react";
import { SettlementFilters, type SettlementFilterValues } from "../components/SettlementFilters";
import { Combobox } from "../components/Combobox";
import { Pagination } from "../components/Pagination";
import { Icon } from "../components/Icon";
import type { ListMeta, Row, OptionLoader } from "../types";

type CashFilters = SettlementFilterValues & { banco: string; natureza: string };

type CashRow = Row & {
    data: string;
    tipo: "Entrada" | "Saída";
    valor: number;
    saldo_antes: number;
    saldo_depois: number;
};

function currency(value: number) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}
function date(value: string) {
    return new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}T12:00:00`));
}

export function CashPage({
    companyFilter,
    rows,
    initial,
    onInitialChange,
    onRefresh,
    meta, balance, onPageChange,
    filters, onFiltersChange, loadOptions, lookups,
    previous, sort, onSort,
}: {
    companyFilter?: ReactNode;
    rows: CashRow[];
    initial: number;
    onInitialChange: (value: number) => void;
    onRefresh: () => void;
    meta: ListMeta;
    balance: number;
    onPageChange: (page: number) => void;
    filters: CashFilters; onFiltersChange: (filters: CashFilters) => void;
    loadOptions: OptionLoader; lookups: Record<string, Row[]>;
    previous: number; sort: { key: string; direction: "asc" | "desc" }; onSort: (key: string) => void;
}) {
    const loadPaymentOptions: OptionLoader = useCallback((source, query, page) => loadOptions(
        source === "formas" && filters.banco ? `formasBanco:${filters.banco}` : source, query, page), [loadOptions, filters.banco]);
    return (
        <>
            <div className="page-heading list-heading">
                <div>
                    <h1><Icon name="wallet" size={25} />Gestão de caixa</h1>
                    <p>Veja, em ordem, como cada entrada e saída alterou o saldo.</p>
                    {companyFilter}
                </div>
                <button className="button button-primary" onClick={onRefresh}>
                    <Icon name="arrows" size={17} /> Atualizar
                </button>
            </div>
            <section className="summary-grid">
                <article className="summary-card summary-main">
                    <div className="summary-top">
                        <span>Saldo atual</span>
                    </div>
                    <strong>{currency(balance)}</strong>
                    <div className="summary-foot">
                        <span>
                            {meta.total} lançamento{meta.total === 1 ? "" : "s"} no período
                        </span>
                    </div>
                </article>
                <article className="summary-card">
                    <div className="summary-top">
                        <span>Saldo inicial</span>
                    </div>
                    <strong>{currency(initial + previous)}</strong>
                    <div className="summary-foot">
                        <label>
                            Ajuste manual{" "}
                            <input
                                className="cash-input"
                                type="number"
                                step="0.01"
                                value={initial}
                                onChange={(e) => onInitialChange(Number(e.target.value) || 0)}
                            />
                        </label>
                    </div>
                </article>
            </section>
            <section className="panel list-panel cash-list-panel">
                <div className="list-toolbar">
                    <SettlementFilters filters={filters} onChange={values => onFiltersChange({ ...filters, ...values })}
                        paymentForms={(lookups.formas || []).filter(row => !filters.banco || row.banco_id === filters.banco)} loadOptions={loadPaymentOptions}>
                        <label>Banco<Combobox label="Filtrar por banco" placeholder="Todos os bancos" emptyLabel="Todos os bancos" source="bancos" loadOptions={loadOptions}
                            value={filters.banco} options={(lookups.bancos || []).map(row => [String(row.id), String(row.descricao)])}
                            onChange={banco => onFiltersChange({ ...filters, banco, formaPagamento: "" })} /></label>
                        <label>Natureza<Combobox label="Natureza do movimento" required value={filters.natureza}
                            options={[["ambos", "Entradas e saídas"], ["entradas", "Entradas"], ["saidas", "Saídas"]]}
                            onChange={natureza => onFiltersChange({ ...filters, natureza })} /></label>
                        <button type="button" className="button button-secondary" onClick={() => onFiltersChange({ dataInicial: "", dataFinal: "", banco: "", formaPagamento: "", natureza: "ambos" })}>Limpar filtros</button>
                    </SettlementFilters>
                </div>
                <div className="table-wrap">
                    <table className="data-table">
                        <thead>
                            <tr>
                                {[["data_baixa", "Data"], ["descricao", "Descrição"], ["natureza", "Tipo"], ["forma_pagamento_id", "Forma"], ["instituicao", "Instituição"], ["valor", "Valor"], ["saldo_antes", "Saldo antes"], ["saldo_depois", "Saldo depois"]].map(([key, label]) =>
                                    <th key={key} className={["valor", "saldo_antes", "saldo_depois"].includes(key) ? "align-right" : ""} aria-sort={key === "data_baixa" ? "ascending" : sort.key === key ? sort.direction === "asc" ? "ascending" : "descending" : undefined}>
                                        <button type="button" className={`sort-button ${key === "data_baixa" || sort.key === key ? "active" : ""}`} onClick={() => onSort(key)} title={key === "data_baixa" ? "Data crescente permanece como primeiro critério" : "Ordenar dentro de cada data"}>
                                            {label}{key === "data_baixa" ? " ↑" : sort.key === key ? sort.direction === "asc" ? " ↑" : " ↓" : ""}
                                        </button>
                                    </th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr
                                    key={String(row.id)}
                                    className={row.tipo === "Entrada" ? "income-row" : "expense-row"}
                                >
                                    <td>{date(row.data)}</td>
                                    <td>
                                        <b>{String(row.descricao)}</b>
                                    </td>
                                    <td>{row.tipo}</td>
                                    <td>{String(row.forma_pagamento || "—")}</td>
                                    <td>{String(row.instituicao || "—")}</td>
                                    <td className="align-right amount-cell">
                                        {row.valor >= 0 ? "+" : ""}
                                        {currency(row.valor)}
                                    </td>
                                    <td className="align-right">{currency(row.saldo_antes)}</td>
                                    <td className="align-right">
                                        <b>{currency(row.saldo_depois)}</b>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!rows.length && (
                        <div className="empty-state">
                            <b>Nenhuma movimentação no período</b>
                            <p>Registre uma baixa em uma conta para acompanhar o caixa.</p>
                        </div>
                    )}
                </div>
                <Pagination total={meta.total} page={meta.pagina} pageCount={meta.paginas} onPageChange={onPageChange} />
            </section>
        </>
    );
}
