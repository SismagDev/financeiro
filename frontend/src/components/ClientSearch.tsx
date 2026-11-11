import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Combobox } from "./Combobox";
import { RecordFormFields } from "./RecordFormFields";
import { resources } from "../data/resources";
import type { OptionLoader, Row } from "../types";

type Props = { rows: Row[]; selectedRow: Row | null; onCreate?: (values: Row) => Promise<Row>; loadOptions?: OptionLoader; modalCreate?: boolean };
export function ClientSearch({ rows, selectedRow, onCreate, loadOptions, modalCreate = false }: Props) {
    const initial = rows.find(row => row.id === selectedRow?.pessoa_id);
    const [selected, setSelected] = useState(String(selectedRow?.pessoa_id ?? ""));
    const [search, setSearch] = useState(String(initial?.nome ?? ""));
    const [creating, setCreating] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const dialog = useRef<HTMLDialogElement>(null);
    const saving = useRef(false);
    useEffect(() => { if (creating && modalCreate && !dialog.current?.open) dialog.current?.showModal(); }, [creating, modalCreate]);
    const fields = resources.find(resource => resource.key === "pessoas")!.fields;
    function choose(row: Row) { setSelected(String(row.id)); setSearch(String(row.nome)); }
    async function save(fieldset: HTMLFieldSetElement) {
        if (saving.current) return;
        const values: Row = {};
        for (const field of fields) {
            const input = fieldset.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${field.name === "observacoes" ? "pessoa_observacoes" : field.name}"]`)!;
            if (!input.reportValidity()) return;
            values[field.name] = field.type === "checkbox" ? (input as HTMLInputElement).checked : input.value;
        }
        saving.current = true; setBusy(true); setError("");
        try { choose(await onCreate!(values)); dialog.current?.close(); setCreating(false); }
        catch (error) { setError(error instanceof Error ? error.message : "Não foi possível cadastrar o cliente."); }
        finally { saving.current = false; setBusy(false); }
    }
    const editor = <fieldset className="inline-client"><legend>Adicionar cliente</legend>
        <RecordFormFields fields={fields.map(field => field.name === "observacoes" ? { ...field, name: "pessoa_observacoes" } : field)} selectedRow={{ nome: search, cliente: true }} lookups={{}} editing={false} />
        {error && <div className="inline-error" role="alert">{error}</div>}
        <div className="modal-actions">
            <button type="button" className="button button-quiet" disabled={busy} onClick={() => { dialog.current?.close(); setCreating(false); setError(""); }}>Cancelar cadastro</button>
            <button type="button" className="button button-primary" disabled={busy} onClick={event => void save(event.currentTarget.closest("fieldset")!)}>Salvar cliente</button>
        </div>
    </fieldset>;
    return <div className="form-field full-field client-search">
        <label>Cliente
            <Combobox name="pessoa_id" label="Cliente" value={selected} onChange={setSelected}
                source="pessoas" loadOptions={loadOptions}
                options={rows.map(row => [String(row.id), String(row.nome)])}
                placeholder="Buscar por qualquer parte do nome"
                onCreate={onCreate ? query => { setSearch(query); setError(""); setCreating(true); } : undefined} />
        </label>
        {creating && (modalCreate ? createPortal(<dialog ref={dialog} className="modal-card client-create-modal" aria-label="Cadastrar cliente"
            onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); if (!busy) { dialog.current?.close(); setCreating(false); } }}>
            <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); void save(event.currentTarget.querySelector("fieldset")!); }}>{editor}</form>
        </dialog>, document.body) : editor)}
    </div>;
}

