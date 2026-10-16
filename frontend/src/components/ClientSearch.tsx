import { useState } from "react";
import { Combobox } from "./Combobox";
import { RecordFormFields } from "./RecordFormFields";
import { resources } from "../data/resources";
import type { Row } from "../types";

type Props = { rows: Row[]; selectedRow: Row | null; onCreate?: (values: Row) => Promise<Row> };
export function ClientSearch({ rows, selectedRow, onCreate }: Props) {
    const initial = rows.find(row => row.id === selectedRow?.pessoa_id);
    const [selected, setSelected] = useState(String(selectedRow?.pessoa_id ?? ""));
    const [search, setSearch] = useState(String(initial?.nome ?? ""));
    const [creating, setCreating] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const fields = resources.find(resource => resource.key === "pessoas")!.fields;
    function choose(row: Row) { setSelected(String(row.id)); setSearch(String(row.nome)); }
    return <div className="form-field full-field client-search">
        <label>Cliente
            <Combobox name="pessoa_id" label="Cliente" value={selected} onChange={setSelected}
                options={rows.map(row => [String(row.id), String(row.nome)])}
                placeholder="Buscar por qualquer parte do nome"
                onCreate={onCreate ? query => { setSearch(query); setCreating(true); } : undefined} />
        </label>
        {creating && <fieldset className="inline-client"><legend>Adicionar cliente</legend>
            <RecordFormFields fields={fields.map(field => field.name === "observacoes" ? { ...field, name: "pessoa_observacoes" } : field)} selectedRow={{ nome: search, cliente: true }} lookups={{}} editing={false} />
            {error && <div className="inline-error" role="alert">{error}</div>}
            <div className="modal-actions">
                <button type="button" className="button button-quiet" disabled={busy} onClick={() => { setCreating(false); setError(""); }}>Cancelar cadastro</button>
                <button type="button" className="button button-primary" disabled={busy} onClick={async event => {
                    const fieldset = event.currentTarget.closest("fieldset")!;
                    const values: Row = {};
                    for (const field of fields) {
                        const input = fieldset.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${field.name === "observacoes" ? "pessoa_observacoes" : field.name}"]`)!;
                        if (!input.reportValidity()) return;
                        values[field.name] = field.type === "checkbox" ? (input as HTMLInputElement).checked : input.value;
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

