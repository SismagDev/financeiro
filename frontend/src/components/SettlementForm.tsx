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
    const [modifier, setModifier] = useState("none");
    const [modifierValue, setModifierValue] = useState("0");
    const discount = modifier === "desconto" ? modifierValue : "0";
    const surcharge = modifier === "acrescimo" ? modifierValue : "0";
    const finalValue = liquidSettlementValue(Number(base), Number(discount), Number(surcharge));
    const invalid = Number(base) <= 0 || Number(base) > remaining || Number(discount) > Number(base) || finalValue <= 0;
    return <form onSubmit={onSubmit} className="record-form settlement-form">
        <div className={"settle-summary " + (account.tipo === "receber" ? "income-settle" : "expense-settle")}>
            <span title={String(account.descricao)}>{account.tipo === "receber" ? "Recebimento" : "Pagamento"} · {String(account.descricao)}</span>
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
            <label className="form-field">Modificador
                <select aria-label="Modificador" value={modifier} onChange={event => { setModifier(event.target.value); setModifierValue("0"); }}>
                    <option value="acrescimo">Acréscimo</option><option value="desconto">Desconto</option><option value="none">Sem ajuste</option>
                </select>
            </label>
            <label className="form-field">Valor do modificador
                <input type="number" min="0" max={modifier === "desconto" ? Number(base) : undefined} step="0.01" required disabled={modifier === "none"} value={modifierValue} onChange={event => setModifierValue(event.target.value)} />
            </label>
        </div>
        <input name="valor" type="hidden" value={finalValue.toFixed(2)} />
        <input name="desconto" type="hidden" value={discount} />
        <input name="acrescimo" type="hidden" value={surcharge} />
        {invalid && <p className="field-hint" role="alert">Informe uma parte válida do saldo, desconto até esse valor e valor efetivo maior que zero.</p>}
        <div className="modal-actions">
            <button type="button" className="button button-quiet" disabled={busy} onClick={onCancel}>Cancelar</button>
            <button className="button button-primary" disabled={busy || remaining <= 0 || invalid}>
                {busy && <span className="spinner" />} Confirmar baixa <span>→</span>
            </button>
        </div>
    </form>;
}
