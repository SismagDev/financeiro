import { useState, type FormEvent } from "react";
import { Combobox } from "./Combobox";
import type { OptionLoader, Row } from "../types";
import { liquidSettlementValue } from "../utils/accounts";

type Props = {
    account: Row; paymentForms: Row[]; remaining: number; busy: boolean;
    formatValue: (key: string, value: Row[string]) => string;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void;
    loadOptions?: OptionLoader;
};
export function SettlementForm({ account, paymentForms, remaining, busy, formatValue, onSubmit, onCancel, loadOptions }: Props) {
    const [base, setBase] = useState(remaining.toFixed(2));
    const [discount, setDiscount] = useState("0");
    const [surcharge, setSurcharge] = useState("0");
    const finalValue = liquidSettlementValue(Number(base), Number(discount), Number(surcharge));
    const invalid = Number(base) <= 0 || Number(base) > remaining || Number(discount) > Number(base) || finalValue <= 0;
    return <form onSubmit={onSubmit} className="record-form">
        <div className={"settle-summary " + (account.tipo === "receber" ? "income-settle" : "expense-settle")}>
            <span>{account.tipo === "receber" ? "Recebimento" : "Pagamento"} · {String(account.descricao)}</span>
            <b>Saldo em aberto: {formatValue("valor", remaining)}</b>
        </div>
        <div className="form-grid">
            <label className="form-field full-field">Forma de pagamento
                <Combobox name="forma_pagamento_id" label="Forma de pagamento" required
                    defaultValue={String(account.forma_pagamento_id || "")}
                    source="formasAtivas" loadOptions={loadOptions}
                    options={paymentForms.filter(item => item.ativo !== false).map(item => [String(item.id), String(item.descricao)])} />
            </label>
            <label className="form-field">Valor do saldo a baixar
                <input type="number" min="0.01" max={remaining} step="0.01" required value={base} onChange={event => setBase(event.target.value)} />
            </label>
            <label className="form-field">Data
                <input name="data" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            </label>
            <label className="form-field">Desconto
                <input name="desconto" type="number" min="0" max={Number(base)} step="0.01" required value={discount} onChange={event => setDiscount(event.target.value)} />
            </label>
            <label className="form-field">Acréscimo
                <input name="acrescimo" type="number" min="0" step="0.01" required value={surcharge} onChange={event => setSurcharge(event.target.value)} />
            </label>
        </div>
        <input name="valor" type="hidden" value={finalValue.toFixed(2)} />
        <div className="settlement-final-value" role="status">
            <span>Valor efetivo a {account.tipo === "receber" ? "receber" : "pagar"}</span><b>{formatValue("valor", finalValue)}</b>
            <small>{formatValue("valor", Number(base))} − {formatValue("valor", Number(discount))} + {formatValue("valor", Number(surcharge))}</small>
            <small>Saldo após a baixa: {formatValue("valor", Math.max(0, remaining - Number(base)))}</small>
        </div>
        <p className="settle-hint">Para uma baixa parcial, informe apenas a parte do saldo que deseja quitar. Os ajustes se aplicam somente a esta baixa.</p>
        {invalid && <p className="field-hint" role="alert">Informe uma parte válida do saldo, desconto até esse valor e valor efetivo maior que zero.</p>}
        <div className="modal-actions">
            <button type="button" className="button button-quiet" disabled={busy} onClick={onCancel}>Cancelar</button>
            <button className="button button-primary" disabled={busy || remaining <= 0 || invalid}>
                {busy && <span className="spinner" />} Confirmar baixa <span>→</span>
            </button>
        </div>
    </form>;
}
