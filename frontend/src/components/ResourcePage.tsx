import { useMemo, useState, type ReactNode } from "react";
import { usePagination } from "../hooks/usePagination";
import { Pagination } from "./Pagination";
import { SearchInput } from "./SearchInput";
import { SettlementFilters } from "./SettlementFilters";
import { Combobox } from "./Combobox";
import { Icon } from "./Icon";
import { EmptyState } from "./EmptyState";
import { Status } from "./Status";
import type { Company, Resource, Row } from "../types";

type Filters = {
    formaPagamento: string;
    mostrarEmAberto: boolean;
    dataInicial: string;
    dataFinal: string;
    mostrarPagos: boolean;
    tipo: "todos" | "pagar" | "receber";
};
type DateFilters = Pick<Filters, "dataInicial" | "dataFinal" | "formaPagamento"> & { mostrarRecebimentos: boolean; mostrarPagamentos: boolean };
type Props = {
    resource: Resource;
    companyFilter?: ReactNode;
    companyScope?: string;
    company: Company;
    rows: Row[];
    visibleRows: Row[];
    loading: boolean;
    search: string;
    formatValue: (key: string, value: Row[string]) => string;
    onSearch: (value: string) => void;
    onCreate: () => void;
    onEdit: (row: Row) => void;
    onDelete: (row: Row) => void;
    onSettle: (row: Row) => void;
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
    companyFilter,
    companyScope,
    company,
    rows,
    visibleRows,
    loading,
    search,
    formatValue,
    onSearch,
    onCreate,
    onEdit,
    onDelete,
    onSettle,
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
    const columns: [string, string][] = ["lancamentos", "baixas", "pessoas", "formas", "bancos"].includes(resource.key)
        ? [["empresa_identificador", "Empresa"], ...resource.columns] : resource.columns;
    const showSettlement = resource.key === "lancamentos";
    const hasFilters = Boolean((personFilters && (!personFilters.mostrarClientes || !personFilters.mostrarFornecedores)) || search || dateFilters?.dataInicial || dateFilters?.dataFinal || dateFilters?.formaPagamento ||
        (dateFilters && (!dateFilters.mostrarRecebimentos || !dateFilters.mostrarPagamentos)) ||
        (lancamentoFilters && (lancamentoFilters.dataInicial || lancamentoFilters.dataFinal || lancamentoFilters.formaPagamento ||
            lancamentoFilters.tipo !== "todos" || !lancamentoFilters.mostrarPagos || !lancamentoFilters.mostrarEmAberto)));
    const defaultSort =
        resource.key === "lancamentos"
            ? "data_vencimento"
            : resource.key === "baixas"
              ? "data_baixa"
              : resource.key === "movimentacoes"
              ? "data_movimentacao"
              : "data_recebimento";
    const [sort, setSort] = useState({
        key: defaultSort,
        direction: resource.key === "lancamentos" ? "asc" : "desc",
    });
    const sortedRows = useMemo(
        () =>
            [...visibleRows].sort((a, b) => {
                const left = a[sort.key] ?? "";
                const right = b[sort.key] ?? "";
                const comparison =
                    typeof left === "number" && typeof right === "number"
                        ? left - right
                        : String(left).localeCompare(String(right), "pt-BR", { numeric: true });
                return sort.direction === "asc" ? comparison : -comparison;
            }),
        [visibleRows, sort],
    );
    const paginated = ["baixas", "lancamentos", "pessoas"].includes(resource.key);
    const { page, pageCount, pageRows, onPageChange } = usePagination(sortedRows, JSON.stringify({
        resource: resource.key, company: companyScope || company.id, search, lancamentoFilters, dateFilters, personFilters, sort,
    }));
    const totals = visibleRows.reduce<{ pagar: number; receber: number }>(
        (acc, row) => ({
            pagar:
                acc.pagar +
                (row.tipo === "pagar" && row.status !== "pago" && row.status !== "cancelado"
                    ? Number(row.saldo || 0)
                    : 0),
            receber:
                acc.receber +
                (row.tipo === "receber" && row.status !== "pago" && row.status !== "cancelado"
                    ? Number(row.saldo || 0)
                    : 0),
        }),
        { pagar: 0, receber: 0 },
    );
    const sortable = ["lancamentos", "baixas"].includes(resource.key);
    const columnClass = (key: string) => [
        key === "numero" ? "account-number" : "",
        resource.key === "pessoas" && ["cliente", "fornecedor"].includes(key) ? "person-role-cell" : "",
        (showSettlement && ["competencia", "plano_conta_id"].includes(key)) ||
        (resource.key === "pessoas" && ["razao_social", "endereco", "responsavel_nome", "responsavel_cpf", "observacoes"].includes(key)) ? "mobile-secondary" : "",
    ].filter(Boolean).join(" ");
    const changeSort = (key: string) =>
        setSort((current) => ({
            key,
            direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
        }));
    return (
        <>
            <div className="page-heading list-heading">
                <div>
                    <h1>{resource.title}</h1>
                    <p>Consulte e organize os registros da sua empresa.</p>
                    {companyFilter}
                </div>
                <button className="button button-primary" onClick={onCreate}>
                    <Icon name="plus" size={18} /> {showSettlement || resource.key === "baixas" ? "Nova" : "Novo"} {resource.singular}
                </button>
            </div>
            <section className="panel list-panel">
                <div className={`list-toolbar ${personFilters ? "people-toolbar" : ""}`}>
                    <div className="list-count">
                        <b>{rows.length}</b> {rows.length === 1 ? "registro" : "registros"}
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
                {personFilters && rows.some(row => !row.cliente && !row.fornecedor) && <p className="legacy-people-note" role="status">
                    Há {rows.filter(row => !row.cliente && !row.fornecedor).length} pessoa(s) antiga(s) sem vínculo. Com os dois filtros marcados, edite esses cadastros para indicar cliente ou fornecedor.
                </p>}
                {dateFilters && onDateFiltersChange && <SettlementFilters search={search} onSearch={onSearch}
                    filters={dateFilters} onChange={filters => onDateFiltersChange({ ...dateFilters, ...filters })} paymentForms={paymentForms}>
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
                                <Combobox label="Filtrar por forma de pagamento" placeholder="Todas as formas" emptyLabel="Todas as formas" value={lancamentoFilters.formaPagamento}
                                    options={paymentForms.map(item => [String(item.id), String(item.descricao)])}
                                    onChange={formaPagamento => onLancamentoFiltersChange({ ...lancamentoFilters, formaPagamento })} />
                            </label>
                            <label>Tipo
                                <Combobox label="Tipo de conta" required value={lancamentoFilters.tipo}
                                    options={[["todos", "Todos"], ["pagar", "A pagar"], ["receber", "A receber"]]}
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
                <div className="table-wrap">
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
                            {(paginated ? pageRows : sortedRows).map((row, index) => (
                                <tr
                                    className={
                                        showSettlement
                                            ? row.tipo === "receber"
                                                ? "income-row"
                                                : "expense-row"
                                            : resource.key === "baixas"
                                              ? row.origem === "recebimentos" ? "income-row" : "expense-row"
                                              : ""
                                    }
                                    key={String(row.origem || "") + String(row.id || index)}
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
                                                <>
                                                    <b>{formatValue(key, row[key])}</b>
                                                    {Number(row.total_parcelas) > 1 && (
                                                        <small className="installment-tag">
                                                            Parcela {row.numero_parcela}/{row.total_parcelas}
                                                        </small>
                                                    )}
                                                </>
                                            ) : key === "saldo" && showSettlement ? (
                                                <div className="balance-cell"><b>{formatValue(key, row[key])}</b>
                                                    <small>{row.data_ultima_baixa ? (row.status === "pago" ? "Quitação: " : "Última baixa: ") + formatValue("data_ultima_baixa", row.data_ultima_baixa) : "Sem pagamento"}</small>
                                                </div>
                                            ) : key === "observacoes" ? (
                                                <span className="notes-preview" title={String(row.observacoes || "")}>{formatValue(key, row[key])}</span>
                                            ) : resource.key === "pessoas" && (key === "cliente" || key === "fornecedor") ? (
                                                <span className={row[key] ? "role-indicator role-yes" : "role-indicator role-no"} role="img" aria-label={row[key] ? "Sim" : "Não"} title={row[key] ? "Sim" : "Não"}><Icon name={row[key] ? "check" : "close"} size={17} /></span>
                                            ) : key === "status" ? (
                                                <Status value={row[key]} />
                                            ) : key === "tipo" &&
                                              (row.tipo === "pagar" || row.tipo === "receber") ? (
                                                <span
                                                    className={`type-label ${row.tipo === "receber" ? "type-income" : "type-expense"}`}
                                                >
                                                    {formatValue(key, row[key])}
                                                </span>
                                            ) : (
                                                <span className={key === "valor" ? "amount-cell" + (showSettlement ? " account-total" : "") : ""}>
                                                    {formatValue(key, row[key])}
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
                                                    <span>Dar baixa</span>
                                                </button>
                                            )}
                                        {showSettlement && hasSettlements(row) && (
                                            <button className="settle-row-button" title="Detalhes das baixas" onClick={() => onShowSettlements(row)}>
                                                <Icon name="card" size={16} /><span>Detalhes</span>
                                            </button>
                                        )}
                                        <button className="row-delete" aria-label="Excluir registro" title="Excluir" onClick={() => onDelete(row)}>
                                            <Icon name="trash" size={16} />
                                        </button>
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
                                action={hasFilters ? undefined : `${showSettlement || resource.key === "baixas" ? "Nova" : "Novo"} ${resource.singular}`}
                                onAction={onCreate}
                            />
                        )
                    )}
                </div>
                {paginated && (
                    <Pagination total={visibleRows.length} page={page} pageCount={pageCount} onPageChange={onPageChange} />
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
                </section>
            )}
        </>
    );
}
