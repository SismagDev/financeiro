import { useEffect, useRef, useState, type ReactNode } from "react";
import { installmentPreview, matchesAccount } from "../utils/accounts";
import { Combobox } from "./Combobox";
import { Icon } from "./Icon";
import { ClientSearch } from "./ClientSearch";
import { competenceLabel, dateInputValue, localDateInputValue } from "../utils/dates";
import type { Field, OptionLoader, Row } from "../types";
import { AccountValueInput } from "./AccountValue";
import { useMessageBox } from "../hooks/useMessageBox";
import { BankPaymentFields } from "./BankPaymentFields";

type Props = { companyId?: string; initialValueMode?: "total" | "parcela"; fields: Field[]; selectedRow: Row | null; lookups: Record<string, Row[]>; editing: boolean; fixedType?: "pagar" | "receber"; children?: ReactNode; onCreatePerson?: (values: Row) => Promise<Row>; loadOptions?: OptionLoader; onReady?: (form: HTMLFormElement) => void; onValueChange?: (values: Row) => void };
function PersonRoles({ selectedRow }: Pick<Props, "selectedRow">) {
    const [roles, setRoles] = useState({ cliente: Boolean(selectedRow?.cliente), fornecedor: Boolean(selectedRow?.fornecedor) });
    return <fieldset className="role-field full-field"><legend>Esta pessoa é <small>(selecione ao menos uma opção)</small></legend>
        <div className="role-options">{(["cliente", "fornecedor"] as const).map(name => <label className="role-choice" key={name}>
            <input type="checkbox" name={name} checked={roles[name]} required={!roles[name === "cliente" ? "fornecedor" : "cliente"]}
                onChange={event => setRoles({ ...roles, [name]: event.target.checked })} />
            <span className="custom-check"><Icon name="check" size={13} /></span>
            <span><b>{name === "cliente" ? "Cliente" : "Fornecedor"}</b><small>{name === "cliente" ? "Compra produtos ou serviços" : "Fornece produtos ou serviços"}</small></span>
        </label>)}</div>
    </fieldset>;
}
function SelectField({ field, selectedRow, lookups, editing, loadOptions }: Omit<Props, "fields"> & { field: Field }) {
    const options: [string, string][] = field.options || (lookups[field.source || ""] || []).map(item => [String(item.id),
        field.source === "lancamentos"
            ? [item.pessoa_nome || lookups.pessoas?.find(person => person.id === item.pessoa_id)?.nome, item.descricao, item.tipo === "receber" ? "Recebimento" : "Pagamento"].filter(Boolean).join(" · ")
            : String(item.nome || item.descricao || item.id)]);
    return <Combobox name={field.name} label={field.label} required={field.required}
          source={field.source} loadOptions={loadOptions}
        disabled={editing && field.name === "lancamento_id"} defaultValue={String(selectedRow?.[field.name] ?? (field.options?.some(([value]) => value === "ambos") ? "ambos" : ""))} options={options}
        filterOption={field.source === "lancamentos" ? (id, query) => {
            const account = (lookups.lancamentos || []).find(item => item.id === id);
            return Boolean(account && matchesAccount(account, query, lookups.pessoas || []));
        } : undefined} />;
}
function InputField({ field, selectedRow }: Pick<Props, "selectedRow"> & { field: Field }) { const isInstallment = field.name === "parcelas"; const isNumber = field.type === "number"; return <><input name={field.name} type={field.type || "text"} required={field.required} step={isInstallment ? "1" : isNumber ? "0.01" : undefined} min={isInstallment ? "1" : isNumber ? "0.01" : undefined} max={isInstallment ? "60" : undefined} maxLength={isNumber || field.type === "date" ? undefined : field.maxLength || 200} defaultValue={field.type === "date" ? dateInputValue(selectedRow?.[field.name]) : String(selectedRow?.[field.name] ?? (isInstallment ? "1" : ""))} placeholder={isInstallment ? "1" : isNumber ? "0,00" : field.type === "date" ? "" : `Informe ${field.label.toLowerCase()}`} />{isInstallment && <small className="field-hint">1 para à vista. No parcelamento simples, o intervalo padrão é de 30 dias.</small>}</>; }
export function RecordFormFields({ fields, selectedRow, lookups, editing, fixedType, children, onCreatePerson, companyId, initialValueMode = "total", loadOptions, onReady, onValueChange }: Props) {
    const grid = useRef<HTMLDivElement>(null);
    useEffect(() => { const form = grid.current?.closest("form"); if (form) onReady?.(form); }, [onReady]);
    const launch = fields.some((field) => field.name === "parcelas");
    const settlement = fields.some(field => field.name === "lancamento_id");
    const isLancamento = launch && !editing;
    const documentField = fields.find(field => field.name === "num_doc");
    const dependentRow = selectedRow?.empresa_id && selectedRow.empresa_id !== companyId ? null : selectedRow;
    const [due, setDue] = useState(() => dateInputValue(selectedRow?.data_vencimento) || (isLancamento ? localDateInputValue() : ""));
    const [competence, setCompetence] = useState(() => competenceLabel(selectedRow?.competencia || selectedRow?.data_vencimento || (isLancamento ? localDateInputValue() : "")));
    const [accountType, setAccountType] = useState(String(fixedType || selectedRow?.tipo || ""));
    const [plan, setPlan] = useState({ companyId, id: String(selectedRow?.plano_conta_id || "") });
    const planId = plan.companyId === companyId ? plan.id : "";
    const [description, setDescription] = useState({ companyId, text: String(selectedRow?.descricao || "") });
    const [valueMode, setValueMode] = useState({ companyId, value: initialValueMode });
    const mode = valueMode.companyId === companyId ? valueMode.value : initialValueMode;
    const setMode = (value: "total" | "parcela") => setValueMode({ companyId, value });
    const [detailed, setDetailed] = useState(false);
    const [installments, setInstallments] = useState("1");
    const [amounts, setAmounts] = useState<Row>({ valor: selectedRow?.valor || "" });
    const [intervals, setIntervals] = useState("");
    const [installmentEdits, setInstallmentEdits] = useState<Record<number, { valor?: string; vencimento?: string }>>({});
    if (valueMode.companyId !== companyId) {
        setValueMode({ companyId, value: initialValueMode });
        setInstallmentEdits({});
        setPlan({ companyId, id: "" });
        setDescription({ companyId, text: "" });
    }
    const { ask, messageBox } = useMessageBox();
    const hasEdits = Object.keys(installmentEdits).length > 0;
    const generated = isLancamento ? installmentPreview(amounts, Number(installments), mode, due, competence,
        detailed && Number(installments) > 1 ? intervals.split(",").map(value => Number(value.trim())).filter(value => Number.isInteger(value) && value > 0) : undefined) : [];
    const preview = generated.map(row => ({ ...row, valor: installmentEdits[row.numero]?.valor ?? String(row.valor), vencimento: installmentEdits[row.numero]?.vencimento ?? row.vencimento }));
    const total = preview.reduce((sum, row) => sum + Math.round(Number(row.valor) * 100), 0) / 100;
    async function changeGeneration(change: () => void) {
        if (hasEdits && !(await ask({ title: "Regerar parcelas?", message: "Esta alteração substitui os valores e vencimentos editados individualmente. Deseja gerar as parcelas novamente?", confirmLabel: "Regerar parcelas" }))) return;
        setInstallmentEdits({});
        change();
    }
    const orderedFields = launch ? [...fields.filter(field => field.name === "plano_conta_id"), ...fields.filter(field => field.name !== "plano_conta_id")] : fields;
    const formFields = <div ref={grid} className="form-grid">{orderedFields.filter((field) => !(launch && field.name === "parcelas") && !(field.type === "checkbox" && field.name === "fornecedor") && !(launch && field.name === "banco_id" && !(isLancamento && dependentRow?.banco_id))).map((field) => {
        if (settlement && field.name === "forma_pagamento_id") return <BankPaymentFields key={"payment:" + companyId} banks={lookups.bancos || []} paymentForms={lookups.formas || []} loadOptions={loadOptions}
            initial={{ banco_id: String(selectedRow?.banco_id || ""), forma_pagamento_id: String(selectedRow?.forma_pagamento_id || "") }} />;
        if (launch && editing && field.name === "tipo") return <input key={field.name} type="hidden" name="tipo" value={String(selectedRow?.tipo || "")} />;
        if (isLancamento && fixedType && field.name === "tipo") return <input key={field.name} type="hidden" name="tipo" value={fixedType} />;
        if (launch && field.name === "num_doc") return null;
        if (field.type === "checkbox") return <PersonRoles key={field.name} selectedRow={selectedRow} />;
            if (launch && field.name === "pessoa_id") return <ClientSearch key={field.name + companyId} selectedRow={dependentRow} rows={lookups.pessoas || []} onCreate={onCreatePerson} modalCreate={isLancamento} loadOptions={loadOptions} />;
        if (isLancamento && field.name === "valor") return null;
        if (launch && field.name === "valor") return <AccountValueInput key={field.name} account={selectedRow} liquidOnly onChange={onValueChange} />;
        const formField = <label key={field.name} className={`form-field ${field.wide || (isLancamento && field.name === "tipo") ? "full-field" : ""}`}>{field.name === "valor" && isLancamento ? mode === "total" ? "Valor total da operação" : "Valor de cada parcela" : field.label}
            {isLancamento && field.name === "tipo" ? <Combobox name="tipo" label="Tipo" required options={field.options || []} value={accountType} onChange={type => {
                setAccountType(type);
                const selected = (lookups.planos || []).find(row => row.id === plan.id && row.empresa_id === companyId);
                if (type && selected?.tipo && selected.tipo !== "ambos" && selected.tipo !== type) setPlan({ companyId, id: "" });
            }} />
            : isLancamento && field.name === "plano_conta_id" ? <Combobox key={companyId + accountType} name={field.name} label={field.label}
                source={accountType ? `planos:${accountType}` : "planos"} loadOptions={loadOptions} value={planId} onChange={id => setPlan({ companyId, id })}
                options={(lookups.planos || []).filter(row => !accountType || !row.tipo || row.tipo === "ambos" || row.tipo === accountType).map(row => [String(row.id), String(row.descricao)])} />
            : launch && field.name === "data_vencimento" ? <input name={field.name} type="date" required value={due} onChange={event => { const value = event.target.value; if (isLancamento) void changeGeneration(() => { setDue(value); setCompetence(competenceLabel(value)); }); else { setDue(value); setCompetence(competenceLabel(value)); } }} />
            : field.name === "competencia" ? <input name={field.name} value={competence} required={field.required} placeholder="out/2026" pattern="(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/[0-9]{4}" title="Informe mês/ano, por exemplo out/2026" onChange={event => { const value = event.target.value.toLowerCase(); if (isLancamento) void changeGeneration(() => setCompetence(value)); else setCompetence(value); }} />
            : field.type === "textarea" ? <textarea name={field.name} rows={3} maxLength={5000} defaultValue={String(selectedRow?.[field.name] ?? "")} />
            : isLancamento && field.name === "descricao" ? <Combobox key={companyId + ":" + planId} name="descricao" label="Descrição" required allowCustom maxLength={200}
                  source={planId ? `descricoes:${planId}` : "descricoes"} loadOptions={loadOptions}
                value={description.companyId === companyId ? description.text : ""} onChange={text => setDescription({ companyId, text })} placeholder="Digite ou selecione uma descrição"
                options={Array.from(new Map((lookups.lancamentos || []).filter(row => !planId || row.plano_conta_id === planId).map(row => {
                    const description = String(row.descricao || "").trim();
                    return [description.toLocaleLowerCase("pt-BR"), description] as const;
                })).values()).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR")).map(text => [text, text])} />
            : field.type === "select" ? <SelectField key={field.source ? companyId : field.name} field={field} selectedRow={field.source ? dependentRow : selectedRow} lookups={lookups} editing={editing} loadOptions={loadOptions} /> : <InputField field={field} selectedRow={selectedRow} />}</label>;
        if (launch && field.name === "descricao" && documentField) return <div className="account-reference-fields full-field" key={field.name}>
            {formField}
            <label className="form-field">{documentField.label}<InputField field={documentField} selectedRow={selectedRow} /></label>
        </div>;
        return formField;
    })}
    </div>;
    if (!isLancamento) return launch ? <div className="account-create-main">{formFields}</div> : <>{formFields}
        {editing && fields.some(field => field.name === "lancamento_id") && (Number(selectedRow?.desconto) > 0 || Number(selectedRow?.acrescimo) > 0) &&
            <p className="field-hint">Ajustes preservados nesta baixa: desconto de {Number(selectedRow?.desconto || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} e acréscimo de {Number(selectedRow?.acrescimo || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. O valor acima é o efetivamente pago ou recebido.</p>}
    </>;
    return <>{messageBox}<div className="account-create-layout">
        {hasEdits && <input type="hidden" name="parcelas_personalizadas" value={JSON.stringify(preview.map(row => ({ valor: Number(row.valor), data_vencimento: row.vencimento })))} />}
        <div className="account-create-main">{formFields}{children}</div>
        <aside className="account-installment-panel" aria-label="Valores">
            <h3><Icon name="wallet" /> Valores</h3>
            <div className="value-mode">
                <label><input type="radio" name="modo_valor" aria-label="Informar valor total" value="total" checked={mode === "total"} onChange={() => void changeGeneration(() => setMode("total"))} /> Valor total</label>
                <label><input type="radio" name="modo_valor" aria-label="Informar valor de cada parcela" value="parcela" checked={mode === "parcela"} onChange={() => void changeGeneration(() => setMode("parcela"))} /> Valor por parcela</label>
            </div>
            <div className="installment-amount-fields">
            <label className={`form-field ${mode === "total" ? "operation-value-field" : ""}`}>{mode === "total" ? "Valor total" : "Valor por parcela"}
                <input name="valor" type="number" min="0.01" step="0.01" required value={mode === "total" && hasEdits ? total.toFixed(2) : String(amounts.valor)} placeholder="0,00" onChange={event => { const value = event.target.value; void changeGeneration(() => setAmounts({ valor: value })); }} />
            </label>
            <label className="form-field">Número de parcelas
                <input type="number" name="parcelas" min="1" max="60" step="1" required value={installments} onChange={event => { const value = event.target.value; void changeGeneration(() => setInstallments(value)); }} />
            </label>
            </div>
            {Number(installments) > 1 && <div className="installment-schedule-controls">
                <label className="detail-toggle"><input type="checkbox" name="detalhar_parcelamento" checked={detailed} onChange={event => { const value = event.target.checked; void changeGeneration(() => setDetailed(value)); }} /> Personalizar os intervalos</label>
                {detailed && <input className="installment-interval-input" name="intervalos" aria-label="Dias até cada parcela" title="Dias contados a partir do vencimento informado. Ex.: 15, 30, 45." placeholder="15, 30, 45" required value={intervals} onChange={event => { const value = event.target.value; void changeGeneration(() => setIntervals(value)); }} />}
            </div>}
                {preview.length ? <div className="installment-preview-wrap"><table className="installment-preview" aria-label="Parcelas">
                    <thead><tr><th>Competência</th><th>Vencimento</th><th>Parcela</th><th>Valor</th></tr></thead>
                    <tbody>{preview.map(row => <tr key={row.numero}><td>{row.competencia}</td><td><input aria-label={`Vencimento da parcela ${row.numero}`} type="date" required value={row.vencimento} onChange={event => setInstallmentEdits(current => ({ ...current, [row.numero]: { ...current[row.numero], vencimento: event.target.value } }))} /></td><td>{row.numero}/{installments}</td><td><input aria-label={`Valor da parcela ${row.numero}`} type="number" min="0.01" step="0.01" required value={row.valor} onChange={event => setInstallmentEdits(current => ({ ...current, [row.numero]: { ...current[row.numero], valor: event.target.value } }))} /></td></tr>)}</tbody>
                </table></div> : <p className="installment-preview-empty">Preencha valor, vencimento, competência e os intervalos, se personalizados, para visualizar as parcelas.</p>}
            <div className="installment-total" role="status">Total da operação <b>{total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</b></div>
            <label className="detail-toggle keep-account-data"><input type="checkbox" name="manter_dados_conta" /> Manter dados para cadastrar outra conta</label>
        </aside>
    </div></>;
}
