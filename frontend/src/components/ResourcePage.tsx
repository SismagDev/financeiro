import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pagination } from "./Pagination";
import { SearchInput } from "./SearchInput";
import { SettlementFilters } from "./SettlementFilters";
import { Combobox } from "./Combobox";
import { Icon } from "./Icon";
import { EmptyState } from "./EmptyState";
import { Status } from "./Status";
import type { ListMeta, OptionLoader, Resource, Row } from "../types";
import { netAmount } from "../utils/accounts";

type Filters = {
    formaPagamento: string;
    mostrarEmAberto: boolean;
    dataInicial: string;
    dataFinal: string;
    mostrarPagos: boolean;
    tipo: "todos" | "pagar" | "receber";
};
type DateFilters = Pick<Filters, "dataInicial" | "dataFinal" | "formaPagamento"> & { mostrarRecebimentos: boolean; mostrarPagamentos: boolean };

function formatDocument(value: Row[string]) {
    const text = String(value ?? "");
    if (!/^[\d.\-/\s]+$/.test(text)) return text || "—";
    const digits = text.replace(/\D/g, "");
    if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
    if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
    return text;
}
type Props = {
    resource: Resource;
    meta: ListMeta;
    sort: { key: string; direction: "asc" | "desc" };
    onSort: (key: string) => void;
    onPageChange: (page: number) => void;
    loadOptions?: OptionLoader;
    companyFilter?: ReactNode;
    visibleRows: Row[];
    loading: boolean;
    search: string;
    formatValue: (key: string, value: Row[string]) => string;
    onSearch: (value: string) => void;
    onCreate: (tipo?: "receber" | "pagar") => void;
    onDailyCash: () => void;
    onEdit: (row: Row) => void;
    onDelete: (row: Row) => void;
    onSettle: (row: Row) => void;
    onQuickSettle: (row: Row, paymentForm: string) => Promise<boolean>;
    loadQuickSettlementOptions: (row: Row) => OptionLoader;
    busy: boolean;
    onShowSettlements: (row: Row) => void;
    hasSettlements: (row: Row) => boolean;
    lancamentoFilters?: Filters;
    onLancamentoFiltersChange?: (filters: Filters) => void;
    personFilters?: { mostrarClientes: boolean; mostrarFornecedores: boolean };
    onPersonFiltersChange?: (filters: { mostrarClientes: boolean; mostrarFornecedores: boolean }) => void;
    paymentForms: Row[];
    dateFilters?: DateFilters;
    onDateFiltersChange?: (filters: DateFilters) => void;
};

export function ResourcePage({
    resource,
    meta, sort, onSort, onPageChange, loadOptions,
    companyFilter,
    visibleRows,
    loading,
    search,
    formatValue,
    onSearch,
    onCreate,
    onDailyCash,
    onEdit,
    onDelete,
    onSettle,
    onQuickSettle,
    loadQuickSettlementOptions,
    busy,
    onShowSettlements,
    hasSettlements,
    lancamentoFilters,
    onLancamentoFiltersChange,
    personFilters,
    onPersonFiltersChange,
    paymentForms,
    dateFilters,
    onDateFiltersChange,
}: Props) {
    const [quickSettlement, setQuickSettlement] = useState<{ row: Row; paymentForm: string } | null>(null);
    const quickRoot = useRef<HTMLDivElement>(null);
    const tableWrap = useRef<HTMLDivElement>(null);
    const submitting = useRef(false);
    const quickAccount = quickSettlement?.row;
    const quickOptions = useMemo(() => quickAccount ? loadQuickSettlementOptions(quickAccount) : undefined,
        [quickAccount, loadQuickSettlementOptions]);
    useLayoutEffect(() => {
        if (quickAccount && tableWrap.current) tableWrap.current.scrollLeft = tableWrap.current.scrollWidth;
    }, [quickAccount]);
    useEffect(() => {
        if (!quickSettlement) return;
        const outside = (event: Event) => {
            if (event.target instanceof Node && !quickRoot.current?.contains(event.target)) setQuickSettlement(null);
        };
        // Fecha no clique para não mover o botão de outra linha entre pointerdown e pointerup.
        document.addEventListener("click", outside, true);
        document.addEventListener("keydown", outside, true);
        return () => {
            document.removeEventListener("click", outside, true);
            document.removeEventListener("keydown", outside, true);
        };
    }, [quickSettlement]);
    async function confirmQuickSettlement() {
        if (!quickSettlement?.paymentForm || busy || submitting.current) return;
        submitting.current = true;
        try {
            if (await onQuickSettle(quickSettlement.row, quickSettlement.paymentForm)) {
                setQuickSettlement(current => current === quickSettlement ? null : current);
            }
        } finally { submitting.current = false; }
    }
    const columns: [string, string][] = ["lancamentos", "baixas", "pessoas", "formas", "bancos"].includes(resource.key)
        ? [["empresa_identificador", "Empresa"], ...resource.columns] : resource.columns;
    const showSettlement = resource.key === "lancamentos";
    const hasFilters = Boolean((personFilters && (!personFilters.mostrarClientes || !personFilters.mostrarFornecedores)) || search || dateFilters?.dataInicial || dateFilters?.dataFinal || dateFilters?.formaPagamento ||
        (dateFilters && (!dateFilters.mostrarRecebimentos || !dateFilters.mostrarPagamentos)) ||
        (lancamentoFilters && (lancamentoFilters.dataInicial || lancamentoFilters.dataFinal || lancamentoFilters.formaPagamento ||
            lancamentoFilters.tipo !== "todos" || !lancamentoFilters.mostrarPagos || !lancamentoFilters.mostrarEmAberto)));
    const paginated = true;
    const page = meta.pagina;
    const pageCount = meta.paginas;
    const totals = { pagar: Number(meta.pagar || 0), receber: Number(meta.receber || 0) };
    const sortable = ["lancamentos", "baixas"].includes(resource.key);
    const columnClass = (key: string) => [
        key === "numero" ? "account-number" : "",
        showSettlement && key === "descricao" ? "account-description-cell" : "",
        showSettlement && key === "tipo" ? "account-type-cell" : "",
        resource.key === "pessoas" && key === "endereco" ? "person-address-cell" : "",
        resource.key === "pessoas" && key === "responsavel_nome" ? "person-contact-cell" : "",
        resource.key === "pessoas" && ["documento", "responsavel_cpf"].includes(key) ? "person-document-cell" : "",
        ["numero", "empresa_identificador", "num_doc", "tipo", "natureza", "competencia", "documento", "celular", "responsavel_cpf", "valor", "saldo", "status", "cliente", "fornecedor"].includes(key) || key.startsWith("data_") ? "nowrap-cell" : "",
        ["nome", "descricao", "razao_social", "endereco", "pessoa_id", "observacoes"].includes(key) ? "text-cell" : "",
        resource.key === "pessoas" && ["cliente", "fornecedor"].includes(key) ? "person-role-cell" : "",
        (showSettlement && ["competencia", "plano_conta_id"].includes(key)) ||
        (resource.key === "pessoas" && ["razao_social", "endereco", "responsavel_nome", "responsavel_cpf", "observacoes"].includes(key)) ? "mobile-secondary" : "",
    ].filter(Boolean).join(" ");
    const changeSort = onSort;
    return (
        <>
            <div className="page-heading list-heading">
                <div>
                    <h1><Icon name={resource.key === "baixas" ? "check" : resource.icon} size={25} />{resource.title}</h1>
                    <p>Consulte e organize os registros da sua empresa.</p>
                    {companyFilter}
                </div>
                {showSettlement ? <div className="account-create-buttons">
                    <button className="button daily-cash-button" onClick={onDailyCash}><Icon name="wallet" size={18} /> Caixa Diário</button>
                    <button className="button account-receive-button" onClick={() => onCreate("receber")}><Icon name="arrowDown" size={18} /> Receber</button>
                    <button className="button account-pay-button" onClick={() => onCreate("pagar")}><Icon name="arrowUp" size={18} /> Pagar</button>
                </div> : <button className="button button-primary" onClick={() => onCreate()}>
                    <Icon name="plus" size={18} /> {showSettlement || resource.key === "baixas" || resource.key === "pessoas" ? "Nova" : "Novo"} {resource.singular}
                </button>}
            </div>
            <section className="panel list-panel">
                <div className={`list-toolbar ${personFilters ? "people-toolbar" : ""}`}>
                    <div className="list-count">
                        <b>{meta.total}</b> {meta.total === 1 ? "registro" : "registros"}
                    </div>
                    {!dateFilters && !showSettlement && <label className="search-box">
                        <Icon name="search" size={17} />
                        <SearchInput value={search} onChange={onSearch}
                            placeholder={showSettlement ? "Cliente ou descrição" : resource.key === "pessoas" ? "Nome, CPF ou celular" : "Buscar registros..."}
                            aria-label={showSettlement ? "Buscar cliente ou descrição" : resource.key === "pessoas" ? "Buscar nome, CPF ou celular" : "Buscar registros"} />
                    </label>}
                    {!showSettlement && !personFilters && !dateFilters && <button className="filter-button" onClick={() => onSearch("")}>
                        <Icon name="close" size={16} /> Limpar busca
                    </button>}
                </div>
                    {personFilters && onPersonFiltersChange && <div className="filter-toggles people-role-filters">
                        <label className="paid-filter"><input type="checkbox" checked={personFilters.mostrarClientes}
                            onChange={event => onPersonFiltersChange({ ...personFilters, mostrarClientes: event.target.checked })} /> Mostrar clientes</label>
                        <label className="paid-filter"><input type="checkbox" checked={personFilters.mostrarFornecedores}
                            onChange={event => onPersonFiltersChange({ ...personFilters, mostrarFornecedores: event.target.checked })} /> Mostrar fornecedores</label>
                    </div>}
                {personFilters && Number(meta.sem_vinculo) > 0 && <p className="legacy-people-note" role="status">
                    Há {meta.sem_vinculo} pessoa(s) antiga(s) sem vínculo. Com os dois filtros marcados, edite esses cadastros para indicar cliente ou fornecedor.
                </p>}
                {dateFilters && onDateFiltersChange && <SettlementFilters search={search} onSearch={onSearch}
                    filters={dateFilters} onChange={filters => onDateFiltersChange({ ...dateFilters, ...filters })} paymentForms={paymentForms} loadOptions={loadOptions}>
                    <button type="button" className="filter-button clear-settlement-search" onClick={() => onSearch("")}><Icon name="close" size={16} /> Limpar busca</button>
                </SettlementFilters>}
                {dateFilters && onDateFiltersChange && <div className="filter-toggles settlement-type-filters">
                        <label className="paid-filter"><input type="checkbox" checked={dateFilters.mostrarRecebimentos}
                            onChange={event => onDateFiltersChange({ ...dateFilters, mostrarRecebimentos: event.target.checked })} /> Mostrar recebimentos</label>
                        <label className="paid-filter"><input type="checkbox" checked={dateFilters.mostrarPagamentos}
                            onChange={event => onDateFiltersChange({ ...dateFilters, mostrarPagamentos: event.target.checked })} /> Mostrar pagamentos</label>
                </div>}
                {showSettlement && lancamentoFilters && onLancamentoFiltersChange && (
                    <div className="launch-filters">
                        <div className="launch-filters-fields inline-filters">
                            <label className="filter-search">Cliente ou descrição
                                <SearchInput value={search} onChange={onSearch} placeholder="Cliente ou descrição" aria-label="Buscar cliente ou descrição" />
                            </label>
                            <label>Forma de pagamento
                                <Combobox source="formas" loadOptions={loadOptions} label="Filtrar por forma de pagamento" placeholder="Todas as formas" emptyLabel="Todas as formas" value={lancamentoFilters.formaPagamento}
                                    options={paymentForms.map(item => [String(item.id), String(item.descricao)])}
                                    onChange={formaPagamento => onLancamentoFiltersChange({ ...lancamentoFilters, formaPagamento })} />
                            </label>
                            <label>Tipo
                                <Combobox label="Tipo de conta" required value={lancamentoFilters.tipo}
                                    options={[["pagar", "A pagar"], ["receber", "A receber"], ["todos", "Todos"]]}
                                    onChange={tipo => onLancamentoFiltersChange({ ...lancamentoFilters, tipo: (tipo || "todos") as Filters["tipo"] })} />
                            </label>
                            <label>
                                Data inicial
                                <input
                                    type="date"
                                    value={lancamentoFilters.dataInicial}
                                    onChange={(event) =>
                                        onLancamentoFiltersChange({
                                            ...lancamentoFilters,
                                            dataInicial: event.target.value,
                                        })
                                    }
                                />
                            </label>
                            <label>
                                Data final
                                <input
                                    type="date"
                                    value={lancamentoFilters.dataFinal}
                                    onChange={(event) =>
                                        onLancamentoFiltersChange({
                                            ...lancamentoFilters,
                                            dataFinal: event.target.value,
                                        })
                                    }
                                />
                            </label>
                        </div>
                        <div className="filter-toggles">
                            <label className="paid-filter"><input type="checkbox" checked={lancamentoFilters.mostrarEmAberto}
                                onChange={event => onLancamentoFiltersChange({ ...lancamentoFilters, mostrarEmAberto: event.target.checked })} /> Mostrar em aberto</label>
                            <label className="paid-filter">
                                <input
                                    type="checkbox"
                                    checked={lancamentoFilters.mostrarPagos}
                                    onChange={(event) =>
                                        onLancamentoFiltersChange({
                                            ...lancamentoFilters,
                                            mostrarPagos: event.target.checked,
                                        })
                                    }
                                />{" "}
                                Mostrar pagos
                            </label>
                        </div>
                    </div>
                )}
                <div className="table-wrap" ref={tableWrap}>
                    <table className={`data-table resource-table resource-${resource.key}`}>
                        <thead>
                            <tr>
                                {columns.map(([key, label]) => (
                                    <th key={key} className={columnClass(key)}>
                                        {sortable ? (
                                            <button
                                                className={`sort-button ${sort.key === key ? "active" : ""}`}
                                                onClick={() => changeSort(key)}
                                            >
                                                {label}
                                                {sort.key === key && (
                                                    <span>{sort.direction === "asc" ? " ↑" : " ↓"}</span>
                                                )}
                                            </button>
                                        ) : (
                                            label
                                        )}
                                    </th>
                                ))}
                                <th className="action-head" />
                            </tr>
                        </thead>
                        <tbody>
                            {visibleRows.map((row, index) => (
                                <tr
                                    className={
                                        showSettlement
                                            ? row.tipo === "receber"
                                                ? "income-row"
                                                : "expense-row"
                                            : resource.key === "baixas"
                                              ? row.origem === "recebimentos" ? "income-row" : "expense-row"
                                              : resource.key === "formas" && row.ativo === false ? "inactive-payment-form" : ""
                                    }
                                    key={String(row.empresa_id) + String(row.origem || "") + String(row.id || index)}
                                    tabIndex={0}
                                    aria-label={`Editar ${resource.singular}: ${row.numero || row.nome || row.descricao || "registro"}`}
                                    onClick={() => onEdit(row)}
                                    onKeyDown={event => {
                                        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onEdit(row); }
                                    }}
                                >
                                    {columns.map(([key]) => (
                                        <td key={key} className={columnClass(key)}>
                                            {key === "descricao" && showSettlement ? (
                                                <div className="account-description">
                                                    <span className="account-description-text" title={formatValue(key, row[key])}>{formatValue(key, row[key])}</span>
                                                    {Number(row.total_parcelas) > 1 && (
                                                        <small className="installment-tag">
                                                            Parcela {row.numero_parcela}/{row.total_parcelas}
                                                        </small>
                                                    )}
                                                    {row.num_doc && <small className="installment-tag document-tag" title={`Num DOC: ${row.num_doc}`}>Doc {row.num_doc}</small>}
                                                </div>
                                            ) : key === "saldo" && showSettlement ? (
                                                <div className="balance-cell">{row.status === "pago" ? <Status value={row.status} /> : <b>{formatValue(key, row[key])}</b>}
                                                    <small>{row.data_ultima_baixa ? (row.status === "pago" ? "Quitação: " : "Última baixa: ") + formatValue("data_ultima_baixa", row.data_ultima_baixa) : "Sem pagamento"}</small>
                                                </div>
                                            ) : key === "pessoa_id" && row.pessoa_nome ? (<span>{row.pessoa_nome}</span>
                                            ) : key === "plano_conta_id" && row.plano_conta_descricao ? (<span>{row.plano_conta_descricao}</span>
                                            ) : key === "banco_id" && row.banco_descricao ? (<span>{row.banco_descricao}</span>
                                            ) : key === "forma_pagamento_id" && row.forma_pagamento_descricao ? (
                                                <span>{row.forma_pagamento_descricao}</span>
                                            ) : resource.key === "pessoas" && ["documento", "responsavel_cpf"].includes(key) ? (
                                                <span title={formatDocument(row[key])}>{formatDocument(row[key])}</span>
                                            ) : key === "observacoes" ? (
                                                <span className="notes-preview" title={String(row.observacoes || "")}>{formatValue(key, row[key])}</span>
                                            ) : resource.key === "pessoas" && (key === "cliente" || key === "fornecedor") ? (
                                                <span className={row[key] ? "role-indicator role-yes" : "role-indicator role-no"} role="img" aria-label={row[key] ? "Sim" : "Não"} title={row[key] ? "Sim" : "Não"}><Icon name={row[key] ? "check" : "close"} size={17} /></span>
                                            ) : key === "status" ? (
                                                <Status value={row[key]} />
                                            ) : key === "tipo" && resource.key === "planos" ? (
                                                <span>{row.tipo === "receber" ? "Receber" : row.tipo === "pagar" ? "Pagar" : "Receber/Pagar"}</span>
                                            ) : key === "tipo" &&
                                              (row.tipo === "pagar" || row.tipo === "receber") ? (
                                                <span
                                                    className={`type-label ${row.tipo === "receber" ? "type-income" : "type-expense"}`}
                                                    role={showSettlement ? "img" : undefined}
                                                    aria-label={showSettlement ? row.tipo === "receber" ? "A receber" : "A pagar" : undefined}
                                                    title={showSettlement ? row.tipo === "receber" ? "A receber" : "A pagar" : undefined}
                                                >
                                                    {showSettlement ? <Icon name={row.tipo === "receber" ? "arrowDown" : "arrowUp"} size={18} /> : formatValue(key, row[key])}
                                                </span>
                                            ) : (
                                                <span title={resource.key === "pessoas" ? formatValue(key, row[key]) : undefined} className={key === "valor" ? "amount-cell" + (showSettlement ? " account-total" : "") : ""}>
                                                    {formatValue(key, showSettlement && key === "valor" ? netAmount(row) : row[key])}
                                                </span>
                                            )}
                                        </td>
                                    ))}
                                    <td className={`row-actions delete-actions ${showSettlement ? "launch-actions" : ""}`} onClick={event => event.stopPropagation()}>
                                        {showSettlement && !hasSettlements(row) && Number(row.saldo) > 0 &&
                                            row.status !== "pago" &&
                                            row.status !== "cancelado" && (
                                                <button
                                                    className="settle-row-button"
                                                    title={
                                                        row.tipo === "receber"
                                                            ? "Registrar recebimento"
                                                            : "Registrar pagamento"
                                                    }
                                                    onClick={() => onSettle(row)}
                                                >
                                                    <Icon name="check" size={16} />
                                                    <span>Baixa</span>
                                                </button>
                                            )}
                                        {showSettlement && hasSettlements(row) && (
                                            <button className="settle-row-button" title="Detalhes das baixas" onClick={() => onShowSettlements(row)}>
                                                <Icon name="card" size={16} /><span>Detalhes</span>
                                            </button>
                                        )}
                                        {showSettlement && Number(row.saldo) > 0 && row.status !== "pago" && row.status !== "cancelado" && (
                                            quickSettlement && quickSettlement.row.id === row.id && quickSettlement.row.empresa_id === row.empresa_id ?
                                                <div className="quick-settlement" ref={quickRoot} key={String(row.id)}>
                                                    <Combobox label="Forma de pagamento da baixa rápida" required disabled={busy}
                                                        twoColumns optionDetails={Object.fromEntries(paymentForms.map(item => [String(item.id), String(item.banco_descricao || "Sem banco")]))}
                                                        value={quickSettlement.paymentForm} source="formasAtivas"
                                                        loadOptions={quickOptions}
                                                        options={paymentForms.filter(item => item.ativo !== false && item.empresa_id === row.empresa_id)
                                                            .map(item => [String(item.id), String(item.descricao)])}
                                                        onChange={paymentForm => setQuickSettlement(current => current ? { ...current, paymentForm } : null)} />
                                                    <button type="button" className="quick-settlement-confirm" title="Confirmar baixa rápida" aria-label="Confirmar baixa rápida"
                                                        disabled={busy || !quickSettlement.paymentForm} onClick={() => void confirmQuickSettlement()}><Icon name="check" size={18} /></button>
                                                    <button type="button" title="Cancelar baixa rápida" aria-label="Cancelar baixa rápida"
                                                        onClick={() => setQuickSettlement(null)}><Icon name="close" size={18} /></button>
                                                </div> :
                                                <button type="button" className="quick-settlement-button" title="Baixa rápida" aria-label="Baixa rápida" disabled={busy}
                                                    onClick={() => setQuickSettlement({ row, paymentForm: "" })}><Icon name="bolt" size={18} /></button>
                                        )}
                                        {!(showSettlement && quickAccount?.id === row.id && quickAccount?.empresa_id === row.empresa_id) && <button className="row-delete" aria-label="Excluir registro" title="Excluir" onClick={() => onDelete(row)}>
                                            <Icon name="trash" size={16} />
                                        </button>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {loading ? (
                        <div className="table-loading">
                            <span className="spinner" /> Carregando registros...
                        </div>
                    ) : (
                        !visibleRows.length && (
                            <EmptyState
                                title={
                                    hasFilters
                                        ? "Nenhum resultado"
                                        : `Ainda não há ${resource.title.toLowerCase()}`
                                }
                                text={
                                    hasFilters
                                        ? "Tente ajustar os filtros ou buscar por outro termo."
                                        : "Adicione seu primeiro registro para manter tudo organizado."
                                }
                                action={hasFilters ? undefined : `${showSettlement || resource.key === "baixas" || resource.key === "pessoas" ? "Nova" : "Novo"} ${resource.singular}`}
                                onAction={onCreate}
                            />
                        )
                    )}
                </div>
                {paginated && (
                    <Pagination total={meta.total} page={page} pageCount={pageCount} onPageChange={onPageChange} />
                )}
            </section>
            {showSettlement && (
                <section className="launch-summary">
                    <span>Resumo das contas filtradas</span>
                    <div>
                        <small>Saldo a pagar</small>
                        <b>{formatValue("valor", totals.pagar)}</b>
                    </div>
                    <div>
                        <small>Saldo a receber</small>
                        <b>{formatValue("valor", totals.receber)}</b>
                    </div>
                    <details className="launch-summary-details">
                        <summary><span className="summary-expand">Expandir totais</span><span className="summary-collapse">Recolher totais</span></summary>
                        <div className="launch-summary-expanded">
                            <div>
                                <small>Pago + a pagar</small>
                                <b>{formatValue("valor", Number(meta.pago || 0) + totals.pagar)}</b>
                            </div>
                            <div>
                                <small>Recebido + a receber</small>
                                <b>{formatValue("valor", Number(meta.recebido || 0) + totals.receber)}</b>
                            </div>
                        </div>
                    </details>
                </section>
            )}
        </>
    );
}
