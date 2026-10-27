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

export function AccountValueInput({ account, label = "Valor original" }: { account: Row | null; label?: string }) {
    const [value, setValue] = useState(String(account?.valor ?? ""));
    const [adjustments, setAdjustments] = useState({ desconto: Number(account?.desconto || 0), acrescimo: Number(account?.acrescimo || 0) });
    const [kind, setKind] = useState<"desconto" | "acrescimo">("desconto");
    const net = netAmount({ valor: value, ...adjustments });
    return <div className="account-value-editor full-field">
        <label className="form-field">{label}
            <input name="valor" type="number" step="0.01" min="0.01" required value={value} placeholder="0,00" onChange={event => setValue(event.target.value)} />
        </label>
        <input type="hidden" name="desconto" value={adjustments.desconto} />
        <input type="hidden" name="acrescimo" value={adjustments.acrescimo} />
        <details className="value-adjustments">
            <summary>Desconto ou acréscimo{adjustments.desconto > 0 || adjustments.acrescimo > 0 ? " · aplicado" : " · opcional"}</summary>
            <div className="adjustment-controls">
                <label className="form-field">Ajuste
                    <select value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
                        <option value="desconto">Desconto</option><option value="acrescimo">Acréscimo</option>
                    </select>
                </label>
                <label className="form-field">{kind === "desconto" ? "Descontar" : "Acrescentar"}
                    <input type="number" min="0" step="0.01" value={adjustments[kind]} onChange={event => setAdjustments({ ...adjustments, [kind]: Number(event.target.value) })} />
                </label>
            </div>
            <small className="field-hint">{adjustments.desconto > 0 ? `Desconto: ${money(adjustments.desconto)}. ` : ""}{adjustments.acrescimo > 0 ? `Acréscimo: ${money(adjustments.acrescimo)}. ` : ""}Informe zero para remover o ajuste selecionado.</small>
        </details>
        <p className="net-preview" role="status">Valor líquido: <b>{money(net)}</b></p>
        {net < 0 && <p className="field-hint" role="alert">O desconto não pode superar o valor com acréscimo.</p>}
    </div>;
}
