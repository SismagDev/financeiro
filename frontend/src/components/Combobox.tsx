import { Icon } from "./Icon";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

type Props = {
    options: [string, string][];
    name?: string;
    value?: string;
    defaultValue?: string;
    onChange?: (value: string) => void;
    required?: boolean;
    disabled?: boolean;
    allowCustom?: boolean;
    placeholder?: string;
    label?: string;
    maxLength?: number;
    onCreate?: (query: string) => void;
    filterOption?: (value: string, query: string) => boolean;
    emptyLabel?: string;
};

export function Combobox({ options, name, value, defaultValue = "", onChange, required, disabled,
    allowCustom, placeholder = "Selecione uma opção", label, maxLength, onCreate, filterOption, emptyLabel = "Não selecionado" }: Props) {
    const id = useId();
    const input = useRef<HTMLInputElement>(null);
    const root = useRef<HTMLDivElement>(null);
    const [selected, setSelected] = useState(defaultValue);
    const [query, setQuery] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    useEffect(() => {
        if (!open) return;
        const close = () => { setOpen(false); setQuery(null); setActive(-1); };
        const outside = (event: Event) => {
            if (event.target instanceof Node && !root.current?.contains(event.target)) close();
        };
        // No toque, um botão pode não receber foco. O blur sem destino não significa saída da lista.
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("focusin", outside, true);
        window.addEventListener("blur", close);
        return () => {
            document.removeEventListener("pointerdown", outside, true);
            document.removeEventListener("focusin", outside, true);
            window.removeEventListener("blur", close);
        };
    }, [open]);
    const current = value ?? selected;
    const selectedLabel = options.find(([key]) => key === current)?.[1] ?? current;
    const matches = options.filter(([key, text]) => filterOption ? filterOption(key, query ?? "") :
        text.toLocaleLowerCase("pt-BR").includes((query ?? "").trim().toLocaleLowerCase("pt-BR")));
    function change(next: string) { setSelected(next); onChange?.(next); }
    function choose(next: string) {
        input.current?.setCustomValidity(""); input.current?.focus();
        change(next); setQuery(null); setOpen(false); setActive(-1);
    }
    function keyboard(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Escape") { event.preventDefault(); input.current?.setCustomValidity(""); setOpen(false); setQuery(null); }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            setActive(index => Math.max(0, Math.min(matches.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
        }
        if (event.key === "Enter" && open) {
            event.preventDefault();
            if (matches[active]) choose(matches[active][0]);
            else if (!allowCustom && matches.length) choose(matches[0][0]);
            else { setOpen(false); setQuery(null); }
        }
    }
    return <div ref={root} className="combobox">
        {name && <input type="hidden" name={name} value={current} disabled={disabled} />}
        <div className="combobox-control">
            <input ref={input} type="search" id={id} role="combobox" aria-label={label} aria-expanded={open}
                aria-controls={id + "-results"} aria-autocomplete="list"
                aria-activedescendant={open && matches[active] ? id + "-option-" + active : undefined}
                autoComplete="off" placeholder={placeholder} disabled={disabled} required={required}
                maxLength={maxLength} value={query ?? selectedLabel}
                onFocus={() => { setOpen(true); setActive(-1); }} onKeyDown={keyboard}
                onChange={event => {
                    setQuery(event.target.value); setOpen(true); setActive(-1);
                    // Apenas valores livres podem ser enviados sem escolher uma sugestão.
                    change(allowCustom ? event.target.value : "");
                    event.currentTarget.setCustomValidity(!allowCustom && event.target.value ? "Selecione uma opção da lista." : "");
                }} onBlur={event => event.currentTarget.setCustomValidity("")} />
            {(query ?? selectedLabel) && !disabled && <button type="button" className="search-clear combobox-clear" aria-label={"Limpar " + (label || "seleção")}
                onClick={() => choose("")}><Icon name="close" size={15} /></button>}
            <button type="button" className="combobox-toggle" aria-label={"Abrir opções: " + (label || placeholder)} disabled={disabled}
                onClick={() => { input.current?.focus(); setQuery(null); setOpen(!open); }}><Icon name="chevron" size={23} /></button>
        </div>
        {open && !disabled && <div className="combobox-results">
            <div id={id + "-results"} role="listbox" aria-label={label || placeholder}>
                {!required && <button type="button" role="option" aria-selected={!current} onClick={() => choose("")}>{emptyLabel}</button>}
                {matches.map(([key, text], index) => <button type="button" role="option" aria-selected={current === key}
                    className={index === active ? "active" : ""} id={id + "-option-" + index} key={key}
                    onClick={() => choose(key)}>{text}</button>)}
            </div>
            {!matches.length && <span>{allowCustom ? "Nova descrição: continue digitando para cadastrar." : "Nenhuma opção encontrada."}</span>}
            {!matches.length && onCreate && <button type="button" onClick={() => { onCreate(query ?? ""); input.current?.setCustomValidity(""); setQuery(null); setOpen(false); }}>Adicionar cliente</button>}
        </div>}
    </div>;
}
