import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "../components/Icon";

type Message = { title: string; message: string; confirmLabel: string; danger?: boolean };
export function useMessageBox() {
    const [message, setMessage] = useState<Message | null>(null);
    const dialog = useRef<HTMLDialogElement>(null);
    const resolve = useRef<((confirmed: boolean) => void) | null>(null);
    const id = useId();
    const finish = useCallback((confirmed: boolean) => {
        const pending = resolve.current;
        resolve.current = null;
        dialog.current?.close();
        setMessage(null);
        pending?.(confirmed);
    }, []);
    const ask = useCallback((next: Message) => new Promise<boolean>(done => {
        // Uma segunda solicitação cancela a anterior, nunca a confirma implicitamente.
        resolve.current?.(false);
        resolve.current = done;
        setMessage(next);
    }), []);
    useEffect(() => {
        if (message && !dialog.current?.open) dialog.current?.showModal();
    }, [message]);
    useEffect(() => () => { resolve.current?.(false); resolve.current = null; }, []);
    const messageBox = <dialog ref={dialog} className="modal-card message-box" aria-labelledby={id + "-title"} aria-describedby={id + "-text"}
        onCancel={event => { event.preventDefault(); finish(false); }}
        onClose={() => { if (resolve.current) finish(false); }}
        onClick={event => { if (event.target === event.currentTarget) finish(false); }}>
        <div className="modal-head"><h2 id={id + "-title"}>{message?.title}</h2>
            <button type="button" className="icon-button" aria-label="Cancelar e fechar" onClick={() => finish(false)}><Icon name="close" /></button>
        </div>
        <p id={id + "-text"}>{message?.message}</p>
        <div className="modal-actions">
            <button type="button" autoFocus className="button button-secondary" onClick={() => finish(false)}>Cancelar</button>
            <button type="button" className={"button " + (message?.danger ? "button-danger" : "button-primary")} onClick={() => finish(true)}>{message?.confirmLabel}</button>
        </div>
    </dialog>;
    return { ask, messageBox };
}
