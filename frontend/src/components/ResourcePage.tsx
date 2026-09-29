import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import { EmptyState } from "./EmptyState";
import { Status } from "./Status";
import type { Company, Resource, Row } from "../types";

type Filters = {
    cliente: string;
    dataInicial: string;
    dataFinal: string;
    mostrarPagos: boolean;
    tipo: "todos" | "pagar" | "receber";
};
type Props = {
    resource: Resource;
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
    lancamentoFilters?: Filters;
    onLancamentoFiltersChange?: (filters: Filters) => void;
};

export function ResourcePage({
    resource,
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
    lancamentoFilters,
    onLancamentoFiltersChange,
}: Props) {
    const showSettlement = resource.key === "lancamentos";
    const defaultSort =
        resource.key === "lancamentos"
            ? "data_vencimento"
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
    const totals = visibleRows.reduce<{ pagar: number; receber: number }>(
        (acc, row) => ({
            pagar:
                acc.pagar +
                (row.tipo === "pagar" && row.status !== "pago" && row.status !== "cancelado"
                    ? Number(row.valor || 0)
                    : 0),
            receber:
                acc.receber +
                (row.tipo === "receber" && row.status !== "pago" && row.status !== "cancelado"
                    ? Number(row.valor || 0)
                    : 0),
        }),
        { pagar: 0, receber: 0 },
    );
    const sortable = ["lancamentos", "movimentacoes", "recebimentos"].includes(resource.key);
    const changeSort = (key: string) =>
        setSort((current) => ({
            key,
            direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
        }));
    return (
        <>
            <div className="page-heading list-heading">
                <div>
                    <span className="eyebrow muted">EMPRESA · {company.nome.toUpperCase()}</span>
                    <h1>{resource.title}</h1>
                    <p>Consulte e organize os registros da sua empresa.</p>
                </div>
                <button className="button button-primary" onClick={onCreate}>
                    <Icon name="plus" size={18} /> Novo {resource.singular}
                </button>
            </div>
            <section className="panel list-panel">
                <div className="list-toolbar">
                    <div className="list-count">
                        <b>{rows.length}</b> {rows.length === 1 ? "registro" : "registros"}
                    </div>
                    <label className="search-box">
                        <Icon name="search" size={17} />
                        <input
                            value={search}
                            onChange={(event) => onSearch(event.target.value)}
                            placeholder={`Buscar ${resource.title.toLowerCase()}...`}
                        />
                    </label>
                    <button className="filter-button" onClick={() => onSearch("")}>
                        <Icon name="close" size={16} /> Limpar busca
                    </button>
                </div>
                {showSettlement && lancamentoFilters && onLancamentoFiltersChange && (
                    <div className="launch-filters">
                        <div className="launch-filters-fields">
                            <label>
                                Cliente
                                <input
                                    value={lancamentoFilters.cliente}
                                    onChange={(event) =>
                                        onLancamentoFiltersChange({
                                            ...lancamentoFilters,
                                            cliente: event.target.value,
                                        })
                                    }
                                    placeholder="Nome do cliente"
                                />
                            </label>
                            <label>
                                Tipo
                                <select
                                    value={lancamentoFilters.tipo}
                                    onChange={(event) =>
                                        onLancamentoFiltersChange({
                                            ...lancamentoFilters,
                                            tipo: event.target.value as "todos" | "pagar" | "receber",
                                        })
                                    }
                                >
                                    <option value="todos">Todos</option>
                                    <option value="pagar">A pagar</option>
                                    <option value="receber">A receber</option>
                                </select>
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
                        <div>
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
                    <table className="data-table">
                        <thead>
                            <tr>
                                {resource.columns.map(([key, label]) => (
                                    <th key={key}>
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
                            {sortedRows.map((row, index) => (
                                <tr
                                    className={
                                        showSettlement
                                            ? row.tipo === "receber"
                                                ? "income-row"
                                                : "expense-row"
                                            : ""
                                    }
                                    key={String(row.id || index)}
                                >
                                    {resource.columns.map(([key]) => (
                                        <td key={key}>
                                            {key === "descricao" && showSettlement ? (
                                                <>
                                                    <b>{formatValue(key, row[key])}</b>
                                                    {Number(row.total_parcelas) > 1 && (
                                                        <small className="installment-tag">
                                                            Parcela {row.numero_parcela}/{row.total_parcelas}
                                                        </small>
                                                    )}
                                                </>
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
                                                <span className={key === "valor" ? "amount-cell" : ""}>
                                                    {formatValue(key, row[key])}
                                                </span>
                                            )}
                                        </td>
                                    ))}
                                    <td className="row-actions">
                                        {showSettlement &&
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
                                        <button title="Editar" onClick={() => onEdit(row)}>
                                            <Icon name="edit" size={16} />
                                        </button>
                                        <button title="Excluir" onClick={() => onDelete(row)}>
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
                                    search
                                        ? "Nenhum resultado"
                                        : `Ainda não há ${resource.title.toLowerCase()}`
                                }
                                text={
                                    search
                                        ? "Tente buscar por outro termo."
                                        : "Adicione seu primeiro registro para manter tudo organizado."
                                }
                                action={search ? undefined : `Novo ${resource.singular}`}
                                onAction={onCreate}
                            />
                        )
                    )}
                </div>
            </section>
            {showSettlement && (
                <section className="launch-summary">
                    <span>Resumo dos lançamentos filtrados</span>
                    <div>
                        <small>Total a pagar</small>
                        <b>{formatValue("valor", totals.pagar)}</b>
                    </div>
                    <div>
                        <small>Total a receber</small>
                        <b>{formatValue("valor", totals.receber)}</b>
                    </div>
                </section>
            )}
        </>
    );
}
