import type { Company } from "../types";
import { Icon } from "./Icon";

type Props = { companies: Company[]; visible: boolean; value: string; onChange: (id: string) => void; form?: boolean; disabled?: boolean };

export function CompanySelect({ companies, visible, value, onChange, form = false, disabled = false }: Props) {
    if (!visible) return null;
    return <label className={form ? "form-field full-field company-form-field" : "company-filter"}>
        Empresa
        <span className="company-select-control"><select aria-label={form ? "Empresa do cadastro" : "Filtrar por empresa"} value={!form && companies.length === 1 ? companies[0].id : value}
            disabled={disabled || companies.length <= 1} onChange={event => onChange(event.target.value)}>
            {!form && companies.length !== 1 && <option value="">Todas marcadas</option>}
            {companies.map(company => <option key={company.id} value={company.id}>{company.nome}</option>)}
        </select><Icon name="chevron" size={18} /></span>
    </label>;
}
