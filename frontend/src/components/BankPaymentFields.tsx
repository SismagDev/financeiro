import { useState } from "react";
import type { OptionLoader, Row } from "../types";
import { Combobox } from "./Combobox";

export type BankPayment = { banco_id: string; forma_pagamento_id: string };
type Props = {
    banks: Row[]; paymentForms: Row[]; loadOptions?: OptionLoader; initial?: Partial<BankPayment>;
    value?: BankPayment; onChange?: (value: BankPayment) => void; required?: boolean; disabled?: boolean;
};

export function BankPaymentFields({ banks, paymentForms, loadOptions, initial, value, onChange, required = true, disabled = false }: Props) {
    const [selection, setSelection] = useState<BankPayment>({ banco_id: initial?.banco_id || "", forma_pagamento_id: initial?.forma_pagamento_id || "" });
    const current = value ?? selection;
    function change(next: BankPayment) { setSelection(next); onChange?.(next); }
    return <>
        <label className="form-field full-field">Banco
            <Combobox name="banco_id" label="Banco" required={required} disabled={disabled} source="bancos" loadOptions={loadOptions}
                value={current.banco_id} onChange={banco_id => change({ banco_id, forma_pagamento_id: "" })}
                options={banks.map(row => [String(row.id), String(row.descricao)])} />
        </label>
        <label className="form-field full-field">Forma de pagamento
            <Combobox key={current.banco_id} name="forma_pagamento_id" label="Forma de pagamento" required={required} disabled={disabled || !current.banco_id}
                placeholder={current.banco_id ? "Selecione uma opção" : "Selecione o banco primeiro"}
                source={current.banco_id ? `formasBanco:${current.banco_id}` : undefined} loadOptions={loadOptions}
                value={current.forma_pagamento_id} onChange={forma_pagamento_id => change({ ...current, forma_pagamento_id })}
                options={paymentForms.filter(row => row.banco_id === current.banco_id && row.ativo !== false).map(row => [String(row.id), String(row.descricao)])} />
        </label>
    </>;
}
