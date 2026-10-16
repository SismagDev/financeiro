import { useRef, type InputHTMLAttributes } from "react";
import { Icon } from "./Icon";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> & {
    value: string;
    onChange: (value: string) => void;
};
export function SearchInput({ value, onChange, ...props }: Props) {
    const input = useRef<HTMLInputElement>(null);
    return <div className="search-input">
        <input {...props} ref={input} type="search" value={value} onChange={event => onChange(event.target.value)} />
        {value && <button type="button" className="search-clear" aria-label="Limpar este campo de busca" disabled={props.disabled}
            onClick={() => { onChange(""); input.current?.focus(); }}><Icon name="close" size={15} /></button>}
    </div>;
}
