import { useState } from "react";
import type { Row } from "../types";
import { netAmount } from "../utils/accounts";

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function AccountValueSummary({ account }: { account: Row }) {
    return <dl className="account-value-summary">
        <div><dt>Valor original</dt><dd>{money(Number(account.valor || 0))}</dd></div>
        {Number(account.desconto) > 0 && <div><dt>Desconto</dt><dd>− {money(Number(account.desconto))}</dd></div>}
        {Number(account.acrescimo) > 0 && <div><dt>Acréscimo</dt><dd>+ {money(Number(account.acrescimo))}</dd></div>}
        <div className="net-value"><dt>Valor líquido</dt><dd>{money(netAmount(account))}</dd></div>
    </dl>;
}

export function AccountValueInput({ account, label = "Valor original", onChange, liquidOnly = false }: { account: Row | null; label?: string; onChange?: (values: Row) => void; liquidOnly?: boolean }) {
    const [value, setValue] = useState(String(account?.valor ?? ""));
    const [adjustments, setAdjustments] = useState({ desconto: Number(account?.desconto || 0), acrescimo: Number(account?.acrescimo || 0) });
    const [kind, setKind] = useState<"desconto" | "acrescimo">("desconto");
    const net = netAmount({ valor: value, ...adjustments });
    if (liquidOnly) return <div className="account-value-editor liquid-value-editor">
        <label className="form-field">Valor líquido
            <input type="number" min={Math.max(0, (Math.round((adjustments.acrescimo - adjustments.desconto) * 100) + 1) / 100)} step="0.01" required
                data-dirty-field="valor_liquido" defaultValue={net.toFixed(2)} onChange={event => {
                    const next = event.target.value === "" ? "" : String(netAmount({ valor: event.target.value, desconto: adjustments.acrescimo, acrescimo: adjustments.desconto }));
                    setValue(next); onChange?.({ valor: next, ...adjustments });
                }} />
        </label>
        <input type="hidden" name="valor" value={value} />
        <input type="hidden" name="desconto" value={adjustments.desconto} />
        <input type="hidden" name="acrescimo" value={adjustments.acrescimo} />
    </div>;
    return <div className="account-value-editor full-field">
        <label className="form-field">{label}
            <input name="valor" type="number" step="0.01" min="0.01" required value={value} placeholder="0,00" onChange={event => { setValue(event.target.value); onChange?.({ valor: event.target.value, ...adjustments }); }} />
        </label>
        <input type="hidden" name="desconto" value={adjustments.desconto} />
        <input type="hidden" name="acrescimo" value={adjustments.acrescimo} />
        <details className="value-adjustments">
            <summary>Desconto ou acréscimo{adjustments.desconto > 0 || adjustments.acrescimo > 0 ? " · aplicado" : " · opcional"}</summary>
            <div className="adjustment-controls">
                <label className="form-field">Ajuste
                    <select value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
                        <option value="acrescimo">Acréscimo</option><option value="desconto">Desconto</option>
                    </select>
                </label>
                <label className="form-field">{kind === "desconto" ? "Descontar" : "Acrescentar"}
                    <input type="number" min="0" step="0.01" value={adjustments[kind]} onChange={event => { const next = { ...adjustments, [kind]: Number(event.target.value) }; setAdjustments(next); onChange?.({ valor: value, ...next }); }} />
                </label>
            </div>
            <small className="field-hint">{adjustments.desconto > 0 ? `Desconto: ${money(adjustments.desconto)}. ` : ""}{adjustments.acrescimo > 0 ? `Acréscimo: ${money(adjustments.acrescimo)}. ` : ""}Informe zero para remover o ajuste selecionado.</small>
        </details>
        <p className="net-preview" role="status">Valor líquido: <b>{money(net)}</b></p>
        {net < 0 && <p className="field-hint" role="alert">O desconto não pode superar o valor com acréscimo.</p>}
    </div>;
}
