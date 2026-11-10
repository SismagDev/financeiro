import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { Combobox } from "./Combobox";
import { DailyCashForm, type DailyCashValues } from "./DailyCashForm";
import type { Company, OptionLoader, Row } from "../types";
import "./DailyCashImport.css";

const columns = [["Rec_Dinheiro", "Dinheiro"], ["Rec_Cartão", "Cartão"], ["Rec_Banco", "Banco/Pix"], ["Rec_Outros", "Outros"]] as const;
type Column = typeof columns[number][0];
type Mapping = { empresa_id: string; tipo_caixa_diario_id: string; formas: Record<Column, string> };
type Lookup = { bancos: Row[]; formas: Row[]; tiposCaixa: Row[] };
type Day = { chave: string; filial: string; empresa_id: string; data: string; total: number; status: string;
    historico?: { service: number; zaal: number; despesas: number; resultado: number } | null;
    originais: Record<Column, number>; valores: Record<Column, number>; sangria: number; suprimento: number;
    pendencias: { campo: string; valor: number; motivo: string }[]; valores_formulario: DailyCashValues };
type Analysis = { filiais: string[]; anteriores: number; dias: Day[] };
type Preview = Analysis & { conflitos: { filial: string; data: string }[]; quantidade: number; total: number; importados: number; ignorados: number; total_ignorado: number; dias_importados: { filial: string; data: string }[] };
type Request = <T>(path: string, options: RequestInit, company?: string) => Promise<T>;
export type DailyCashImportHandle = { closeManual: () => boolean };
type Props = { companies: Company[]; companyId: string; request: Request; busy: boolean; onBusy: (value: boolean) => void; onChanged: () => Promise<void>; ref?: Ref<DailyCashImportHandle> };
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateLabel = (date: string) => date.split("-").reverse().join("/");
const emptyMapping = (company = ""): Mapping => ({ empresa_id: company, tipo_caixa_diario_id: "", formas: { Rec_Dinheiro: "", "Rec_Cartão": "", Rec_Banco: "", Rec_Outros: "" } });

export function DailyCashImport({ companies, companyId, request, busy, onBusy, onChanged, ref }: Props) {
    const [file, setFile] = useState("");
    const [filename, setFilename] = useState("");
    const [start, setStart] = useState("");
    const [analysis, setAnalysis] = useState<Analysis | null>(null);
    const [mappings, setMappings] = useState<Record<string, Mapping>>({});
    const [lookups, setLookups] = useState<Record<string, Lookup>>({});
    const [preview, setPreview] = useState<Preview | null>(null);
    const [resolved, setResolved] = useState<string[]>([]);
    const [ignored, setIgnored] = useState<string[]>([]);
    const [manual, setManual] = useState<Day | null>(null);
    const [done, setDone] = useState(false);
    const [error, setError] = useState("");
    const working = useRef(false);
    useImperativeHandle(ref, () => ({ closeManual: () => {
        if (!manual) return false;
        setManual(null); setError(""); return true;
    } }), [manual]);
    const locked = busy || done || resolved.length > 0;
    const post = <T,>(body: object) => request<T>("/importacao/caixa-diario", { method: "POST", body: JSON.stringify(body) }, companyId);
    const payload = () => ({ arquivo: file, data_inicial: start, filiais: Object.fromEntries(Object.entries(mappings).map(([filial, mapping]) => [filial, { ...mapping, formas: Object.fromEntries(Object.entries(mapping.formas).filter(([, id]) => id)) }])), resolvidos: resolved });
    async function run(action: () => Promise<void>) {
        if (working.current) return;
        working.current = true; onBusy(true); setError("");
        try { await action(); }
        catch (e) { setError(e instanceof Error ? e.message : "Não foi possível concluir a operação."); }
        finally { working.current = false; onBusy(false); }
    }
    async function loadCompany(id: string): Promise<Lookup> {
        if (lookups[id]) return lookups[id];
        async function all(endpoint: string) {
            const rows: Row[] = [];
            for (let page = 1; ; page++) {
                const result = await request<{ data: Row[]; meta: { paginas: number } }>(`${endpoint}${endpoint.includes("?") ? "&" : "?"}pagina=${page}&tamanho=100`, {}, id);
                rows.push(...result.data);
                if (page >= result.meta.paginas) return rows;
            }
        }
        const [bancos, formas, tiposCaixa] = await Promise.all([all("/bancos"), all("/formas-pagamento?ativo=true"), all("/tipos-caixa-diario")]);
        const data = { bancos, formas: formas.filter(form => form.empresa_id === id && bancos.some(bank => bank.id === form.banco_id && bank.empresa_id === id)), tiposCaixa };
        setLookups(current => ({ ...current, [id]: data }));
        return data;
    }
    const loader = (data: Lookup): OptionLoader => async (source, query) => {
        const key = source.startsWith("formasBanco:") ? "formas" : source as keyof Lookup;
        const rows = (data[key] || []).filter(row => (!source.startsWith("formasBanco:") || row.banco_id === source.slice(12)) && String(row.descricao).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
        return { options: rows.map(row => [String(row.id), String(row.descricao)]), hasMore: false };
    };
    function updateMapping(filial: string, mapping: Mapping) {
        setMappings(current => ({ ...current, [filial]: mapping })); setPreview(null);
    }
    async function analyze() {
        const result = await post<Analysis>({ acao: "analisar", arquivo: file, data_inicial: start });
        setAnalysis(result); setPreview(null); setIgnored([]); setResolved([]);
        setMappings(Object.fromEntries(result.filiais.map(filial => [filial, emptyMapping()])));
    }
    async function saveManual(values: DailyCashValues) {
        if (!manual) return;
        await run(async () => {
            await post({ ...payload(), acao: "manual", chave: manual.chave, valores: values });
            setResolved(current => [...current, manual.chave]);
            setPreview(current => current ? { ...current, conflitos: current.conflitos.filter(item => item.filial !== manual.filial || item.data !== manual.data),
                dias: current.dias.map(day => day.chave === manual.chave ? { ...day, status: "resolvido" } : day) } : current);
            setManual(null);
            await onChanged();
        });
    }
    if (manual) return <div className="daily-cash-import">
        <p><b>Resolver Caixa Diário · {dateLabel(manual.data)} · {companies.find(company => company.id === manual.empresa_id)?.nome}</b></p>
        <p>Os recebimentos negativos foram excluídos. Revise o total e as baixas antes de gravar.</p>
        {error && <div className="inline-error" role="alert">{error}</div>}
        <DailyCashForm key={manual.chave} initial={manual.valores_formulario} lockedIdentity lookups={lookups[manual.empresa_id]} loadOptions={loader(lookups[manual.empresa_id])}
            busy={busy} onSave={saveManual} onCancel={() => { setManual(null); setError(""); }} />
    </div>;
    const pending = preview?.dias.filter(day => day.status === "pendente" && !ignored.includes(day.chave)) ?? [];
    return <div className="record-form daily-cash-import">
        <div className="form-grid">
            <label className="form-field">Arquivo TXT<input type="file" accept=".txt,text/plain" disabled={locked} onChange={event => {
                const selected = event.target.files?.[0];
                if (!selected) return;
                void run(async () => {
                    if (selected.size > 8_000_000) throw new Error("O TXT deve ter até 8 MB.");
                    const bytes = await selected.arrayBuffer();
                    let text: string;
                    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
                    catch { text = new TextDecoder("windows-1252").decode(bytes); }
                    setFile(text); setFilename(selected.name); setAnalysis(null); setPreview(null); setMappings({});
                });
            }} /></label>
            <label className="form-field">Data inicial<input type="date" required value={start} disabled={locked} onChange={event => { setStart(event.target.value); setAnalysis(null); setPreview(null); }} /></label>
        </div>
        <p>Dinheiro = valor informado + sangria − suprimento. Sem recebimentos originais, a baixa histórica usa Receita Service + Receita Zaal − Despesas. Nos demais dias, essas receitas e despesas não entram no cálculo. A configuração de início do caixa da empresa será preservada.</p>
        <button type="button" className="button button-secondary" disabled={locked || !file || !start} onClick={() => void run(analyze)}>Analisar arquivo</button>
        {analysis && <>
            <p>{filename} · {analysis.dias.length} dias no período · {analysis.anteriores} registros anteriores ignorados.</p>
            {analysis.filiais.map(filial => {
                const mapping = mappings[filial] || emptyMapping(), data = lookups[mapping.empresa_id];
                const forms = data?.formas.map(form => [String(form.id), `${String(data.bancos.find(bank => bank.id === form.banco_id)?.descricao)} — ${String(form.descricao)}`] as [string, string]) || [];
                return <fieldset key={filial} disabled={locked}><legend>Filial {filial}</legend><div className="form-grid cash-import-mapping">
                    <label className="form-field">Empresa<Combobox label={`Empresa da filial ${filial}`} disabled={locked} value={mapping.empresa_id} options={companies.map(company => [company.id, company.nome])} onChange={id => {
                        updateMapping(filial, emptyMapping(id));
                        if (id) void run(async () => {
                            const data = await loadCompany(id);
                            const type = data.tiposCaixa.find(row => String(row.descricao).toLocaleLowerCase() === "service/zaal");
                            setMappings(current => current[filial]?.empresa_id === id ? { ...current, [filial]: { ...current[filial], tipo_caixa_diario_id: String(type?.id || "") } } : current);
                        });
                    }} /></label>
                    <label className="form-field">Tipo de caixa<Combobox label={`Tipo da filial ${filial}`} disabled={locked || !data} value={mapping.tipo_caixa_diario_id} options={data?.tiposCaixa.map(row => [String(row.id), String(row.descricao)]) || []} onChange={id => updateMapping(filial, { ...mapping, tipo_caixa_diario_id: id })} /></label>
                    {analysis.dias.some(day => day.filial === filial && !day.historico) && columns.map(([column, label]) => <label key={column} className="form-field">{label}<Combobox label={`${label} da filial ${filial}`} disabled={locked || !data} value={mapping.formas[column]} options={forms.filter(([id]) => id === mapping.formas[column] || !Object.values(mapping.formas).includes(id))}
                        onChange={id => updateMapping(filial, { ...mapping, formas: { ...mapping.formas, [column]: id } })} /></label>)}
                </div></fieldset>;
            })}
            <button type="button" className="button button-secondary" disabled={busy || done || !analysis.dias.length || analysis.filiais.some(filial => !mappings[filial]?.tipo_caixa_diario_id || (analysis.dias.some(day => day.filial === filial && !day.historico) && Object.values(mappings[filial].formas).some(id => !id)))}
                onClick={() => void run(async () => { setPreview(await post<Preview>({ ...payload(), acao: "prever" })); })}>Conferir prévia</button>
        </>}
        {error && <div className="inline-error" role="alert">{error}</div>}
        {preview && <>
            {done ? <div className="inline-success" role="status">{preview.importados} caixas importados. As pendências continuam disponíveis abaixo para resolução manual.</div> : <p><b>{preview.quantidade} caixas para importar · {money(preview.total)}</b> · {preview.dias.filter(day => day.status === "zero").length} dias zerados.</p>}
            {preview.conflitos.length > 0 && <details className="cash-import-existing"><summary>Caixas já existentes ({preview.ignorados}) · {money(preview.total_ignorado)} — serão ignorados</summary><ul className="cash-import-existing-list">{preview.conflitos.map(item => <li key={`${item.filial}:${item.data}`}>Filial {item.filial} · {dateLabel(item.data)}</li>)}</ul></details>}
            {done && preview.dias_importados.length > 0 && <details><summary>Dias importados ({preview.importados}) · {money(preview.total)}</summary><ul className="cash-import-existing-list">{preview.dias_importados.map(item => <li key={`${item.filial}:${item.data}`}>Filial {item.filial} · {dateLabel(item.data)}</li>)}</ul></details>}
            <h3>Pendências ({pending.length})</h3>
            {pending.length === 0 && <p>Nenhuma pendência aguardando decisão.</p>}
            {pending.map(day => <div className="cash-import-pending" key={day.chave}>
                <b>Filial {day.filial} · {dateLabel(day.data)}</b>
                <ul>{day.pendencias.map(issue => <li key={issue.campo}>{issue.campo}: {money(issue.valor)} — {issue.motivo}</li>)}</ul>
                <p>O dia inteiro fica fora da importação automática.</p>
                <div className="account-create-buttons"><button type="button" className="button button-secondary" disabled={busy || preview.conflitos.some(item => item.filial === day.filial && item.data === day.data)} onClick={() => { setError(""); setManual(day); }}>Fazer manualmente</button>
                    <button type="button" className="button button-quiet" disabled={busy} onClick={() => setIgnored(current => [...current, day.chave])}>Não importar este dia</button></div>
            </div>)}
            {ignored.length > 0 && <p>{ignored.length} dias marcados para não importar. <button type="button" className="text-button" disabled={busy} onClick={() => setIgnored([])}>Reexibir pendências</button></p>}
            {resolved.length > 0 && <p>{resolved.length} dias resolvidos manualmente.</p>}
            <details><summary>Ver todos os dias e cálculos</summary><div className="cash-import-table"><table><thead><tr><th>Filial / Data</th><th>Dinheiro original</th><th>Sangria</th><th>Suprimento</th><th>Dinheiro ajustado</th><th>Cartão</th><th>Pix</th><th>Outros</th><th>Baixa histórica: Service + Zaal − Despesas</th><th>Total positivo</th><th>Situação</th></tr></thead>
                <tbody>{preview.dias.map(day => <tr key={day.chave}><td>{day.filial} · {dateLabel(day.data)}</td><td>{money(day.originais.Rec_Dinheiro)}</td><td>{money(day.sangria)}</td><td>{money(day.suprimento)}</td><td>{money(day.valores.Rec_Dinheiro)}</td><td>{money(day.valores['Rec_Cartão'])}</td><td>{money(day.valores.Rec_Banco)}</td><td>{money(day.valores.Rec_Outros)}</td><td>{day.historico ? `${money(day.historico.service)} + ${money(day.historico.zaal)} − ${money(day.historico.despesas)} = ${money(day.historico.resultado)}` : "—"}</td><td>{money(day.total)}</td><td>{ignored.includes(day.chave) ? "Ignorado" : day.status === "pronto" ? done ? "Importado" : "Pronto" : day.status === "pendente" ? "Pendente" : day.status === "resolvido" ? "Resolvido manualmente" : day.status === "existente" ? "Já existente — ignorado" : "Zero"}</td></tr>)}</tbody></table></div></details>
            {!done && <div className="modal-actions"><button type="button" className="button button-primary" disabled={busy || !preview.quantidade} onClick={() => void run(async () => {
                const result = await post<Preview>({ ...payload(), acao: "importar" });
                setPreview(result); setDone(true); await onChanged();
            })}>{busy ? "Aguarde..." : `Confirmar importação de ${preview.quantidade} caixas`}</button></div>}
        </>}
    </div>;
}
