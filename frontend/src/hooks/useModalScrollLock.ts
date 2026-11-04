import { useEffect } from "react";

export function useModalScrollLock() {
    useEffect(() => {
        let restore: (() => void) | undefined;
        const dialogs = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"], dialog[open]')];
        const activeDialog = () => [...document.querySelectorAll<HTMLElement>("dialog[open]")].at(-1) || dialogs().at(-1);
        const sync = () => {
            if (dialogs().length && !restore) {
                const x = window.scrollX, y = window.scrollY;
                const body = document.body, root = document.documentElement;
                const previous = { position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width,
                    overflow: root.style.overflow, paddingRight: body.style.paddingRight };
                const gap = window.innerWidth - root.clientWidth;
                body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + gap}px`;
                Object.assign(body.style, { position: "fixed", top: `${-y}px`, left: `${-x}px`, width: "100%" });
                root.style.overflow = "hidden";
                restore = () => {
                    Object.assign(body.style, { position: previous.position, top: previous.top, left: previous.left, width: previous.width, paddingRight: previous.paddingRight });
                    root.style.overflow = previous.overflow;
                    window.scrollTo(x, y);
                    restore = undefined;
                };
            } else if (!dialogs().length) restore?.();
        };
        const contain = (event: Event) => {
            const active = activeDialog();
            if (active && event.target instanceof Node && !active.contains(event.target)) event.preventDefault();
        };
        const observer = new MutationObserver(sync);
        const keyboard = (event: KeyboardEvent) => {
            if (event.key === "Tab") {
                const active = activeDialog();
                if (!active) return;
                const controls = [...active.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')].filter(element => element.getClientRects().length > 0);
                const first = controls[0], last = controls.at(-1);
                if (!active.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
                    event.preventDefault(); (event.shiftKey ? last : first)?.focus({ preventScroll: true });
                }
            }
            if ([" ", "PageDown", "PageUp", "Home", "End", "ArrowDown", "ArrowUp"].includes(event.key)) contain(event);
        };
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
        document.addEventListener("wheel", contain, { passive: false });
        document.addEventListener("touchmove", contain, { passive: false });
        document.addEventListener("keydown", keyboard);
        sync();
        return () => { observer.disconnect(); document.removeEventListener("wheel", contain); document.removeEventListener("touchmove", contain); document.removeEventListener("keydown", keyboard); restore?.(); };
    }, []);
}
