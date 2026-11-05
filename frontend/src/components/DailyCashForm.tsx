import { useState, type FormEvent } from "react";
import { BankPaymentFields, type BankPayment } from "./BankPaymentFields";
import { Combobox } from "./Combobox";
import { Icon } from "./Icon";
import { localDateInputValue } from "../utils/dates";
import type { OptionLoader, Row } from "../types";

export type DailyCashValues = {
    data: string; tipo_caixa_diario_id: string; valor: number; observacoes: string | null;
    baixas: (BankPayment & { valor: number })[];
};
type Props = { lookups: Record<string, Row[]>; loadOptions: OptionLoader; busy: boolean; onSave: (values: DailyCashValues) => Promise<void>; onCancel: () => void };

export function DailyCashForm({ lookups, loadOptions, busy, onSave, onCancel }: Props) {
    const [date, setDate] = useState(localDateInputValue);
    const [type, setType] = useState("");
    const [total, setTotal] = useState("");
    const [notes, setNotes] = useState("");
    const [payment, setPayment] = useState<BankPayment>({ banco_id: "", forma_pagamento_id: "" });
    const [amount, setAmount] = useState("");
    const [settlements, setSettlements] = useState<(BankPayment & { id: string; valor: number })[]>([]);
    const [error, setError] = useState("");
    const settled = settlements.reduce((sum, row) => sum + Math.round(row.valor * 100), 0);
    const remaining = Math.round(Number(total) * 100) - settled;
    const money = (value: number) => (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    function addSettlement() {
        const value = Math.round(Number(amount) * 100);
        if (!payment.banco_id || !payment.forma_pagamento_id || !Number.isFinite(value) || value <= 0 || value > remaining) {
            setError("Selecione banco e forma de pagamento e informe um valor positivo até o saldo disponível."); return;
        }
        setSettlements(rows => [...rows, { ...payment, id: crypto.randomUUID(), valor: value / 100 }]);
        setPayment({ banco_id: "", forma_pagamento_id: "" }); setAmount(""); setError("");
    }
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        if (!type || Number(total) <= 0 || remaining < 0) { setError("Confira o tipo, o valor total e a soma das baixas."); return; }
        if (payment.banco_id || payment.forma_pagamento_id || amount) { setError("Adicione a baixa preenchida ou limpe seus campos antes de gravar."); return; }
        void onSave({ data: date, tipo_caixa_diario_id: type, valor: Number(total), observacoes: notes.trim() || null,
            baixas: settlements.map(({ banco_id, forma_pagamento_id, valor }) => ({ banco_id, forma_pagamento_id, valor })) });
    }
    return <form className="record-form daily-cash-form" onSubmit={submit}>
        <div className="account-create-layout">
            <div className="account-create-main"><div className="form-grid">
                <label className="form-field full-field">Data<input type="date" required value={date} disabled={busy} onChange={event => setDate(event.target.value)} /></label>
                <label className="form-field full-field">Tipo de Caixa<Combobox label="Tipo de Caixa" required source="tiposCaixa" loadOptions={loadOptions} value={type} disabled={busy} onChange={setType}
                    options={(lookups.tiposCaixa || []).map(row => [String(row.id), String(row.descricao)])} /></label>
                <label className="form-field full-field">Valor Total<input type="number" min="0.01" step="0.01" required value={total} disabled={busy} onChange={event => setTotal(event.target.value)} /></label>
                <label className="form-field full-field"><span>Observações <small className="optional-label">Opcional</small></span><textarea rows={4} maxLength={5000} value={notes} disabled={busy} onChange={event => setNotes(event.target.value)} /></label>
            </div></div>
            <aside className="account-installment-panel daily-cash-settlements" aria-label="Baixas">
                <h3><Icon name="wallet" /> Baixas</h3>
                <div className="form-grid">
                    <BankPaymentFields banks={lookups.bancos || []} paymentForms={lookups.formas || []} loadOptions={loadOptions} value={payment} onChange={setPayment} required={false} disabled={busy} />
                    <label className="form-field full-field">Valor da baixa<input type="number" min="0.01" step="0.01" value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} /></label>
                </div>
                <button type="button" className="button button-secondary" disabled={busy || remaining <= 0} onClick={addSettlement}><Icon name="plus" size={16} /> Adicionar baixa</button>
                <ul className="daily-cash-entries">{settlements.map(row => <li key={row.id}>
                    <span>{String(lookups.formas?.find(form => form.id === row.forma_pagamento_id)?.descricao || "Forma de pagamento")}<small>{String(lookups.bancos?.find(bank => bank.id === row.banco_id)?.descricao || "Banco")}</small></span>
                    <b>{money(Math.round(row.valor * 100))}</b><button type="button" className="icon-button" aria-label="Remover baixa" disabled={busy} onClick={() => setSettlements(rows => rows.filter(item => item.id !== row.id))}><Icon name="close" size={16} /></button>
                </li>)}</ul>
                <div className="installment-total">Total baixado <b>{money(settled)}</b></div>
                <div className="installment-total">Saldo <b>{money(remaining)}</b></div>
            </aside>
        </div>
        {error && <p className="field-hint" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="button button-quiet" disabled={busy} onClick={onCancel}>Cancelar</button>
            <button className="button button-primary" disabled={busy || remaining < 0}>{busy && <span className="spinner" />} Gravar Caixa Diário</button></div>
    </form>;
}
