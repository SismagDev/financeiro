import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { Status } from "../components/Status";
import type { Row, User } from "../types";

type Props = {
    user: User;
    rows: Row[];
    flowRows: Row[];
    cashIn: number;
    cashOut: number;
    totalPaid: number;
    overdue: number;
    formatValue: (key: string, value: Row[string]) => string;
    onNavigate: (page: string) => void;
    onCreate: (page: string) => void;
};

function currency(value: number) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
        Number.isFinite(value) ? value : 0,
    );
}

export function DashboardPage({
    user,
    rows,
    flowRows,
    cashIn,
    cashOut,
    totalPaid,
    overdue,
    formatValue,
    onNavigate,
    onCreate,
}: Props) {
    const monthlyFlow = Object.values(
        flowRows.reduce<Record<string, { key: string; income: number; outcome: number }>>((result, item) => {
            const key = String(item.data_fluxo || "").slice(0, 7);
            if (!/^\d{4}-\d{2}$/.test(key)) return result;
            const bucket = result[key] || { key, income: 0, outcome: 0 };
            if (item.tipo === "receber") bucket.income += Number(item.valor || 0);
            else bucket.outcome += Number(item.valor || 0);
            result[key] = bucket;
            return result;
        }, {}),
    )
        .sort((first, second) => first.key.localeCompare(second.key))
        .map((item) => ({
            ...item,
            label: new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" })
                .format(new Date(`${item.key}-01T12:00:00`))
                .replace(".", ""),
        }));
    const chartMaximum = Math.max(...monthlyFlow.flatMap((item) => [item.income, item.outcome]), 1);

    return (
        <>
            <div className="page-heading">
                <div>
                    <span className="eyebrow muted">
                        {new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" })
                            .format(new Date())
                            .toUpperCase()}
                    </span>
                    <h1>
                        Olá, {user.nome?.split(" ")[0] || "tudo bem"} <span className="wave">✳</span>
                    </h1>
                    <p>Aqui está o resumo financeiro da sua empresa.</p>
                </div>
                <button className="button button-primary" onClick={() => onCreate("lancamentos")}>
                    <Icon name="plus" size={18} /> Novo lançamento
                </button>
            </div>

            <section className="summary-grid">
                <article className="summary-card summary-main">
                    <div className="summary-top">
                        <span>Saldo previsto</span>
                        <span className="summary-icon">
                            <Icon name="wallet" />
                        </span>
                    </div>
                    <strong>{currency(cashIn - cashOut)}</strong>
                    <div className="summary-foot">
                        <span className="summary-trend">
                            <Icon name="trend" size={14} /> Atualizado agora
                        </span>
                        <span>Em aberto</span>
                    </div>
                </article>
                <article className="summary-card">
                    <div className="summary-top">
                        <span>A receber</span>
                        <span className="summary-icon icon-green">
                            <Icon name="arrowDown" />
                        </span>
                    </div>
                    <strong>{currency(cashIn)}</strong>
                    <div className="summary-foot">
                        <span className="summary-note">Valores em aberto</span>
                    </div>
                    <div className="mini-progress">
                        <i
                            className="progress-green"
                            style={{
                                width: `${cashIn + cashOut ? Math.min(100, (cashIn / (cashIn + cashOut)) * 100) : 0}%`,
                            }}
                        />
                    </div>
                </article>
                <article className="summary-card">
                    <div className="summary-top">
                        <span>A pagar</span>
                        <span className="summary-icon icon-peach">
                            <Icon name="arrowUp" />
                        </span>
                    </div>
                    <strong>{currency(cashOut)}</strong>
                    <div className="summary-foot">
                        <span className={overdue ? "summary-warning" : "summary-note"}>
                            {overdue ? `${overdue} vencido${overdue > 1 ? "s" : ""}` : "Nenhum vencido"}
                        </span>
                    </div>
                    <div className="mini-progress">
                        <i
                            className="progress-peach"
                            style={{
                                width: `${cashIn + cashOut ? Math.min(100, (cashOut / (cashIn + cashOut)) * 100) : 0}%`,
                            }}
                        />
                    </div>
                </article>
                <article className="summary-card">
                    <div className="summary-top">
                        <span>Movimentado</span>
                        <span className="summary-icon icon-blue">
                            <Icon name="arrows" />
                        </span>
                    </div>
                    <strong>{currency(totalPaid)}</strong>
                    <div className="summary-foot">
                        <span className="summary-note">Total registrado</span>
                    </div>
                </article>
            </section>

            <section className="dashboard-panels">
                <article className="panel chart-panel">
                    <div className="panel-heading">
                        <div>
                            <h2>Fluxo financeiro</h2>
                            <p>Entradas e saídas efetivamente registradas</p>
                        </div>
                        <span className="select-chip">
                            Dados registrados <Icon name="chevron" size={15} />
                        </span>
                    </div>
                    {monthlyFlow.length ? (
                        <>
                            <div className="chart-legend">
                                <span>
                                    <i className="legend-in" /> Entradas
                                </span>
                                <span>
                                    <i className="legend-out" /> Saídas
                                </span>
                            </div>
                            <div className="chart-area">
                                <div className="chart-y">
                                    {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
                                        <span key={ratio}>{currency(chartMaximum * ratio)}</span>
                                    ))}
                                </div>
                                <div className="chart-content">
                                    <div className="chart-grid">
                                        {Array.from({ length: 5 }, (_, index) => (
                                            <i key={index} />
                                        ))}
                                    </div>
                                    <div className="bars">
                                        {monthlyFlow.map((month) => (
                                            <div className="bar-group" key={month.key}>
                                                <div className="bar-pair">
                                                    <i
                                                        className="bar-in"
                                                        data-tooltip={currency(month.income)}
                                                        style={{
                                                            height: `${(month.income / chartMaximum) * 100}%`,
                                                        }}
                                                    />
                                                    <i
                                                        className="bar-out"
                                                        data-tooltip={currency(month.outcome)}
                                                        style={{
                                                            height: `${(month.outcome / chartMaximum) * 100}%`,
                                                        }}
                                                    />
                                                </div>
                                                <span>{month.label}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : (
                        <EmptyState
                            title="Sem fluxo financeiro registrado"
                            text="O gráfico será exibido quando houver movimentações ou recebimentos."
                        />
                    )}
                </article>
                <article className="panel quick-panel">
                    <div className="panel-heading">
                        <div>
                            <h2>Acesso rápido</h2>
                            <p>O que você quer fazer?</p>
                        </div>
                    </div>
                    <div className="quick-list">
                        {[
                            ["lancamentos", "Novo lançamento", "Registre uma entrada ou saída", "arrows"],
                            ["pessoas", "Cadastrar pessoa", "Cliente ou fornecedor", "users"],
                            ["caixa", "Ver gestão de caixa", "Acompanhe seu saldo em ordem", "wallet"],
                            ["recebimentos", "Registrar recebimento", "Dê baixa em um valor", "arrowDown"],
                        ].map(([key, title, detail, icon]) => (
                            <button
                                key={key}
                                className="quick-link"
                                onClick={() => (key === "caixa" ? onNavigate(key) : onCreate(key))}
                            >
                                <span className="quick-icon">
                                    <Icon name={icon} />
                                </span>
                                <span>
                                    <b>{title}</b>
                                    <small>{detail}</small>
                                </span>
                                <span className="quick-arrow">↗</span>
                            </button>
                        ))}
                    </div>
                </article>
            </section>

            <section className="panel recent-panel">
                <div className="panel-heading">
                    <div>
                        <h2>Últimos lançamentos</h2>
                        <p>Movimentações recentes da empresa</p>
                    </div>
                    <button className="link-button" onClick={() => onNavigate("lancamentos")}>
                        Ver todos <span>→</span>
                    </button>
                </div>
                <div className="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Descrição</th>
                                <th>Pessoa</th>
                                <th>Vencimento</th>
                                <th>Tipo</th>
                                <th>Status</th>
                                <th className="align-right">Valor</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.slice(0, 5).map((row, index) => (
                                <tr
                                    className={row.tipo === "receber" ? "income-row" : "expense-row"}
                                    key={String(row.id || index)}
                                >
                                    <td>
                                        <span className="row-symbol">
                                            <Icon
                                                name={row.tipo === "receber" ? "arrowDown" : "arrowUp"}
                                                size={15}
                                            />
                                        </span>
                                        <b>{String(row.descricao || "Lançamento")}</b>
                                        {Number(row.total_parcelas) > 1 && (
                                            <small className="installment-tag">
                                                Parcela {row.numero_parcela}/{row.total_parcelas}
                                            </small>
                                        )}
                                    </td>
                                    <td>{formatValue("pessoa_id", row.pessoa_id)}</td>
                                    <td>{formatValue("data_vencimento", row.data_vencimento)}</td>
                                    <td>
                                        <span
                                            className={`type-label ${row.tipo === "receber" ? "type-income" : "type-expense"}`}
                                        >
                                            {formatValue("tipo", row.tipo)}
                                        </span>
                                    </td>
                                    <td>
                                        <Status value={row.status} />
                                    </td>
                                    <td className="align-right amount-cell">
                                        {currency(Number(row.valor || 0))}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!rows.length && (
                        <EmptyState
                            title="Seu fluxo começa aqui"
                            text="Cadastre o primeiro lançamento para acompanhar o movimento financeiro."
                            action="Criar lançamento"
                            onAction={() => onCreate("lancamentos")}
                        />
                    )}
                </div>
            </section>
        </>
    );
}
