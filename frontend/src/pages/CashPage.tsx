import type { Row } from "../types";

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
    rows,
    initial,
    onInitialChange,
    onRefresh,
}: {
    rows: CashRow[];
    initial: number;
    onInitialChange: (value: number) => void;
    onRefresh: () => void;
}) {
    const balance = rows.length ? rows[rows.length - 1].saldo_depois : initial;
    return (
        <>
            <div className="page-heading list-heading">
                <div>
                    <span className="eyebrow muted">FINANCEIRO</span>
                    <h1>Gestão de caixa</h1>
                    <p>Veja, em ordem, como cada entrada e saída alterou o saldo.</p>
                </div>
                <button className="button button-primary" onClick={onRefresh}>
                    Atualizar
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
                            {rows.length} lançamento{rows.length === 1 ? "" : "s"} no período
                        </span>
                    </div>
                </article>
                <article className="summary-card">
                    <div className="summary-top">
                        <span>Saldo inicial</span>
                    </div>
                    <strong>{currency(initial)}</strong>
                    <div className="summary-foot">
                        <label>
                            Editar{" "}
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
            <section className="panel list-panel">
                <div className="table-wrap">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Data</th>
                                <th>Descrição</th>
                                <th>Tipo</th>
                                <th>Forma</th>
                                <th>Instituição</th>
                                <th className="align-right">Valor</th>
                                <th className="align-right">Saldo antes</th>
                                <th className="align-right">Saldo depois</th>
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
                                        <small>{String(row.categoria || "")}</small>
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
                            <p>Registre uma baixa em um lançamento para acompanhar o caixa.</p>
                        </div>
                    )}
                </div>
            </section>
        </>
    );
}
