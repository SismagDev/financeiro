import { useId, type ReactNode } from "react";
import { Combobox } from "./Combobox";
import { SearchInput } from "./SearchInput";
import type { OptionLoader, Row } from "../types";

export type SettlementFilterValues = { formaPagamento: string; dataInicial: string; dataFinal: string };
type Props = {
    search?: string; onSearch?: (value: string) => void;
    filters: SettlementFilterValues; onChange: (filters: SettlementFilterValues) => void;
    paymentForms: Row[]; children?: ReactNode;
    loadOptions?: OptionLoader;
};
export function SettlementFilters({ search, onSearch, filters, onChange, paymentForms, children, loadOptions }: Props) {
    const id = useId();
    const invalid = Boolean(filters.dataInicial && filters.dataFinal && filters.dataInicial > filters.dataFinal);
    return <div className="settlement-filter-group" onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
        <div className="inline-filters settlement-filter-row">
            {onSearch && <label className="filter-search">Cliente ou descrição
                <SearchInput aria-label="Buscar cliente ou descrição" placeholder="Cliente ou descrição" value={search ?? ""} onChange={onSearch} />
            </label>}
            <label>Forma de pagamento
                <Combobox label="Filtrar por forma de pagamento" placeholder="Todas as formas" emptyLabel="Todas as formas"
                    source="formas" loadOptions={loadOptions}
                    value={filters.formaPagamento} options={paymentForms.map(item => [String(item.id), String(item.descricao)])}
                    onChange={formaPagamento => onChange({ ...filters, formaPagamento })} />
            </label>
            <label>Data inicial<input type="date" value={filters.dataInicial} max={filters.dataFinal || undefined}
                aria-invalid={invalid} aria-describedby={invalid ? id : undefined}
                onChange={event => onChange({ ...filters, dataInicial: event.target.value })} /></label>
            <label>Data final<input type="date" value={filters.dataFinal} min={filters.dataInicial || undefined}
                aria-invalid={invalid} aria-describedby={invalid ? id : undefined}
                onChange={event => onChange({ ...filters, dataFinal: event.target.value })} /></label>
            {children}
        </div>
        {invalid && <p id={id} role="alert" className="filter-error">A data inicial não pode ser posterior à data final. Corrija o período para aplicar o filtro.</p>}
    </div>;
}
