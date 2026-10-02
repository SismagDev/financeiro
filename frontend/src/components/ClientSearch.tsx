import { useId, useState, type KeyboardEvent } from "react";
import { RecordFormFields } from "./RecordFormFields";
import { resources } from "../data/resources";
import type { Row } from "../types";

type Props = { rows: Row[]; selectedRow: Row | null; onCreate?: (values: Row) => Promise<Row> };
export function ClientSearch({ rows, selectedRow, onCreate }: Props) {
    const initial = rows.find(row => row.id === selectedRow?.pessoa_id);
    const [selected, setSelected] = useState(String(selectedRow?.pessoa_id ?? ""));
    const [search, setSearch] = useState(String(initial?.nome ?? ""));
    const [open, setOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [active, setActive] = useState(-1);
    const id = useId();
    const matches = rows.filter(row => String(row.nome ?? "").toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR")));
    const fields = resources.find(resource => resource.key === "pessoas")!.fields;
    function choose(row: Row) { setSelected(String(row.id)); setSearch(String(row.nome)); setOpen(false); setActive(-1); }
    function keyboard(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Escape") { setOpen(false); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            setActive(current => Math.max(0, Math.min(matches.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
        }
        if (event.key === "Enter" && open && matches[active]) { event.preventDefault(); choose(matches[active]); }
    }
    return <div className="form-field full-field client-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
        <label htmlFor={id}>Cliente</label>
        <input type="hidden" name="pessoa_id" value={selected} />
        <input id={id} role="combobox" aria-expanded={open} aria-controls={id + "-results"} aria-autocomplete="list"
            aria-activedescendant={open && matches[active] ? id + "-option-" + active : undefined}
            autoComplete="off" placeholder="Buscar por qualquer parte do nome"
            value={search} onFocus={() => setOpen(true)} onKeyDown={keyboard}
            onChange={event => { setSearch(event.target.value); setSelected(""); setOpen(true); setActive(-1); }} />
        {selected && <button type="button" className="text-button" onClick={() => { setSelected(""); setSearch(""); setOpen(false); }}>Remover cliente</button>}
        {open && !creating && <div id={id + "-results"} role="listbox" aria-label="Clientes" className="client-results">
            {matches.map((row, index) => <button type="button" role="option" aria-selected={index === active} id={id + "-option-" + index}
                key={String(row.id)} onClick={() => choose(row)}>{String(row.nome)}</button>)}
            {!matches.length && <><span>Nenhum cliente encontrado.</span>{onCreate && <button type="button" onClick={() => { setCreating(true); setOpen(false); }}>Adicionar cliente</button>}</>}
        </div>}
        {creating && <fieldset className="inline-client"><legend>Adicionar cliente</legend>
            <RecordFormFields fields={fields} selectedRow={{ nome: search, cliente: true }} lookups={{}} editing={false} />
            {error && <div className="inline-error" role="alert">{error}</div>}
            <div className="modal-actions">
                <button type="button" className="button button-quiet" disabled={busy} onClick={() => { setCreating(false); setError(""); }}>Cancelar cadastro</button>
                <button type="button" className="button button-primary" disabled={busy} onClick={async event => {
                    const fieldset = event.currentTarget.closest("fieldset")!;
                    const values: Row = {};
                    for (const field of fields) {
                        const input = fieldset.querySelector<HTMLInputElement>(`[name="${field.name}"]`)!;
                        if (!input.reportValidity()) return;
                        values[field.name] = field.type === "checkbox" ? input.checked : input.value;
                    }
                    setBusy(true); setError("");
                    try { choose(await onCreate!(values)); setCreating(false); }
                    catch (error) { setError(error instanceof Error ? error.message : "Não foi possível cadastrar o cliente."); }
                    finally { setBusy(false); }
                }}>Salvar cliente</button>
            </div>
        </fieldset>}
    </div>;
}

