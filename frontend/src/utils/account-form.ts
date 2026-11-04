// Compara valores enviados e parcelas editáveis; rótulos carregados pelos comboboxes não são alterações.
export function accountFormSnapshot(form: HTMLFormElement, companyId: string) {
    const values = [...new FormData(form).entries()].filter(([name]) => name !== "parcelas_personalizadas").map(([name, value]) => {
        const numeric = ["valor", "desconto", "acrescimo", "parcelas"].includes(name);
        return [name, numeric && value !== "" ? String(Number(value)) : String(value)];
    });
    for (const input of form.querySelectorAll<HTMLInputElement>('[data-dirty-field], input[aria-label^="Valor da parcela"], input[aria-label^="Vencimento da parcela"]')) {
        values.push([input.dataset.dirtyField || input.getAttribute("aria-label") || "", input.type === "number" && input.value !== "" ? String(Number(input.value)) : input.value]);
    }
    return JSON.stringify([companyId, values]);
}
