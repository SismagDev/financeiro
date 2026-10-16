import type { FormEvent } from "react";
import { Combobox } from "./Combobox";
import type { Row } from "../types";

type Props = {
    account: Row; paymentForms: Row[]; remaining: number; busy: boolean;
    formatValue: (key: string, value: Row[string]) => string;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void;
};
export function SettlementForm({ account, paymentForms, remaining, busy, formatValue, onSubmit, onCancel }: Props) {
    return <form onSubmit={onSubmit} className="record-form">
        <div className={"settle-summary " + (account.tipo === "receber" ? "income-settle" : "expense-settle")}>
            <span>{account.tipo === "receber" ? "Recebimento" : "Pagamento"} · {String(account.descricao)}</span>
            <b>Saldo em aberto: {formatValue("valor", remaining)}</b>
        </div>
        <div className="form-grid">
            <label className="form-field full-field">Forma de pagamento
                <Combobox name="forma_pagamento_id" label="Forma de pagamento" required
                    options={paymentForms.filter(item => item.ativo !== false).map(item => [String(item.id), String(item.descricao)])} />
            </label>
            <label className="form-field">Valor da baixa
                <input name="valor" type="number" min="0.01" max={remaining} step="0.01" required defaultValue={remaining.toFixed(2)} />
            </label>
            <label className="form-field">Data
                <input name="data" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            </label>
        </div>
        <p className="settle-hint">Você pode informar o valor total ou fazer uma baixa parcial.</p>
        <div className="modal-actions">
            <button type="button" className="button button-quiet" disabled={busy} onClick={onCancel}>Cancelar</button>
            <button className="button button-primary" disabled={busy || remaining <= 0}>
                {busy && <span className="spinner" />} Confirmar baixa <span>→</span>
            </button>
        </div>
    </form>;
}
