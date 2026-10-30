import { useState, type ReactNode } from "react";
import { installmentPreview, matchesAccount, netAmount } from "../utils/accounts";
import { Combobox } from "./Combobox";
import { Icon } from "./Icon";
import { ClientSearch } from "./ClientSearch";
import { competenceLabel, dateInputValue, localDateInputValue } from "../utils/dates";
import type { Field, OptionLoader, Row } from "../types";
import { AccountValueInput } from "./AccountValue";

type Props = { companyId?: string; fields: Field[]; selectedRow: Row | null; lookups: Record<string, Row[]>; editing: boolean; fixedType?: "pagar" | "receber"; children?: ReactNode; onCreatePerson?: (values: Row) => Promise<Row>; loadOptions?: OptionLoader };
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
export function RecordFormFields({ fields, selectedRow, lookups, editing, fixedType, children, onCreatePerson, companyId, loadOptions }: Props) {
    const launch = fields.some((field) => field.name === "parcelas");
    const isLancamento = launch && !editing;
    const documentField = fields.find(field => field.name === "num_doc");
    const [due, setDue] = useState(() => isLancamento ? localDateInputValue() : dateInputValue(selectedRow?.data_vencimento));
    const [competence, setCompetence] = useState(() => competenceLabel(isLancamento ? localDateInputValue() : selectedRow?.competencia || selectedRow?.data_vencimento));
    const [accountType, setAccountType] = useState(String(fixedType || selectedRow?.tipo || ""));
    const [plan, setPlan] = useState({ companyId, id: String(selectedRow?.plano_conta_id || "") });
    const [mode, setMode] = useState("total"); const [detailed, setDetailed] = useState(false);
    const [installments, setInstallments] = useState("1");
    const [amounts, setAmounts] = useState<Row>({ valor: selectedRow?.valor || "" });
    const [intervals, setIntervals] = useState("");
    const preview = isLancamento ? installmentPreview(amounts, Number(installments), mode, due, competence,
        detailed && Number(installments) > 1 ? intervals.split(",").map(value => Number(value.trim())).filter(value => Number.isInteger(value) && value > 0) : undefined) : [];
    const formFields = <div className="form-grid">{fields.filter((field) => !(launch && field.name === "parcelas") && !(field.type === "checkbox" && field.name === "fornecedor") && !(launch && field.name === "banco_id")).map((field) => {
        if (isLancamento && fixedType && field.name === "tipo") return <input key={field.name} type="hidden" name="tipo" value={fixedType} />;
        if (launch && field.name === "num_doc") return null;
        if (field.type === "checkbox") return <PersonRoles key={field.name} selectedRow={selectedRow} />;
            if (launch && field.name === "pessoa_id") return <ClientSearch key={field.name + companyId} selectedRow={selectedRow} rows={lookups.pessoas || []} onCreate={onCreatePerson} loadOptions={loadOptions} />;
        if (isLancamento && field.name === "valor") return <fieldset className="installment-options installment-value full-field" key={field.name}>
            <legend>Valor</legend>
            <div className="value-mode">
                <label><input type="radio" name="modo_valor" value="total" checked={mode === "total"} onChange={() => setMode("total")} /> Informar valor total</label>
                <label><input type="radio" name="modo_valor" value="parcela" checked={mode === "parcela"} onChange={() => setMode("parcela")} /> Informar valor de cada parcela</label>
            </div>
            <AccountValueInput account={selectedRow} label={mode === "total" ? "Valor original da operação" : "Valor original de cada parcela"} onChange={setAmounts} />
        </fieldset>;
        if (launch && field.name === "valor") return <AccountValueInput key={field.name} account={selectedRow} />;
        const formField = <label key={field.name} className={`form-field ${field.wide || (isLancamento && field.name === "tipo") ? "full-field" : ""}`}>{field.name === "valor" && isLancamento ? mode === "total" ? "Valor total da operação" : "Valor de cada parcela" : field.label}
            {isLancamento && field.name === "tipo" ? <Combobox name="tipo" label="Tipo" required options={field.options || []} value={accountType} onChange={type => {
                setAccountType(type);
                const selected = (lookups.planos || []).find(row => row.id === plan.id && row.empresa_id === companyId);
                if (type && selected?.tipo && selected.tipo !== "ambos" && selected.tipo !== type) setPlan({ companyId, id: "" });
            }} />
            : isLancamento && field.name === "plano_conta_id" ? <Combobox key={companyId + accountType} name={field.name} label={field.label}
                source={accountType ? `planos:${accountType}` : "planos"} loadOptions={loadOptions} value={plan.companyId === companyId ? plan.id : ""} onChange={id => setPlan({ companyId, id })}
                options={(lookups.planos || []).filter(row => !accountType || !row.tipo || row.tipo === "ambos" || row.tipo === accountType).map(row => [String(row.id), String(row.descricao)])} />
            : launch && field.name === "data_vencimento" ? <input name={field.name} type="date" required value={due} onChange={event => { setDue(event.target.value); setCompetence(competenceLabel(event.target.value)); }} />
            : field.name === "competencia" ? <><input name={field.name} value={competence} required={field.required} placeholder="out/2026" pattern="(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/[0-9]{4}" title="Informe mês/ano, por exemplo out/2026" onChange={event => setCompetence(event.target.value.toLowerCase())} /><small className="field-hint">Mês/ano. Pode ser diferente do vencimento.</small></>
            : field.type === "textarea" ? <textarea name={field.name} rows={3} maxLength={5000} defaultValue={String(selectedRow?.[field.name] ?? "")} />
            : isLancamento && field.name === "descricao" ? <Combobox key={companyId} name="descricao" label="Descrição" required allowCustom maxLength={200}
                  source="descricoes" loadOptions={loadOptions}
                defaultValue={String(selectedRow?.descricao ?? "")} placeholder="Digite ou selecione uma descrição"
                options={Array.from(new Map((lookups.lancamentos || []).map(row => {
                    const description = String(row.descricao || "").trim();
                    return [description.toLocaleLowerCase("pt-BR"), description] as const;
                })).values()).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR")).map(text => [text, text])} />
            : field.type === "select" ? <SelectField key={field.source ? companyId : field.name} field={field} selectedRow={selectedRow} lookups={lookups} editing={editing} loadOptions={loadOptions} /> : <InputField field={field} selectedRow={selectedRow} />}</label>;
        if (launch && field.name === "descricao" && documentField) return <div className="account-reference-fields full-field" key={field.name}>
            {formField}
            <label className="form-field">{documentField.label}<InputField field={documentField} selectedRow={selectedRow} /></label>
        </div>;
        return formField;
    })}
    </div>;
    if (!isLancamento) return launch ? <div className="account-create-main">{formFields}</div> : formFields;
    return <div className="account-create-layout">
        <div className="account-create-main">{formFields}{children}</div>
        <aside className="account-installment-panel" aria-label="Parcelamento">
            <h3><Icon name="calendar" /> Parcelamento</h3>
            <label className="form-field">Número de parcelas
                <input type="number" name="parcelas" min="1" max="60" step="1" required value={installments} onChange={event => setInstallments(event.target.value)} />
            </label>
            <p className="field-hint">{Number(installments) === 1 ? "Uma única conta, com o vencimento informado." : mode === "total" ? "O total será dividido entre as parcelas, com os centavos distribuídos automaticamente." : "O valor informado será aplicado a cada parcela."}</p>
            {Number(installments) > 1 && <>
                <p className="field-hint">{detailed ? "Os intervalos personalizados são contados a partir do vencimento informado." : "O vencimento informado é o da primeira parcela. O intervalo padrão é de 30 dias."}</p>
                <label className="detail-toggle"><input type="checkbox" name="detalhar_parcelamento" checked={detailed} onChange={event => setDetailed(event.target.checked)} /> Personalizar os intervalos</label>
                {detailed && <div className="detail-installments"><label> Dias até cada parcela
                    <input name="intervalos" placeholder="15, 30, 45" required value={intervals} onChange={event => setIntervals(event.target.value)} />
                </label><small>Contados a partir da data de vencimento informada. Ex.: 15, 30, 45.</small></div>}
                {preview.length ? <div className="installment-preview-wrap"><table className="installment-preview">
                    <caption>Prévia das parcelas · valores líquidos</caption>
                    <thead><tr><th>Competência</th><th>Vencimento</th><th>Parcela</th><th>Valor</th></tr></thead>
                    <tbody>{preview.map(row => <tr key={row.numero}><td>{row.competencia}</td><td>{row.vencimento.split("-").reverse().join("/")}</td><td>{row.numero}/{installments}</td><td>{netAmount(row).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td></tr>)}</tbody>
                </table></div> : <p className="installment-preview-empty">Preencha valor, vencimento, competência e os intervalos, se personalizados, para visualizar as parcelas.</p>}
            </>}
        </aside>
    </div>;
}
