import type { Row } from "../types";
import { netAmount } from "./accounts";

// Copia somente os dados editáveis de uma conta, sem identidade, parcelas, baixas ou importação.
export function cloneAccountValues(account: Row): Row {
    const values = Object.fromEntries(["empresa_id", "tipo", "pessoa_id", "pessoa_nome", "plano_conta_id", "plano_conta_descricao", "banco_id", "banco_descricao",
        "descricao", "num_doc", "data_vencimento", "competencia", "observacoes"]
        .map(field => [field, account[field]]));
    // O cadastro atual informa o valor líquido; ajustes históricos permanecem na origem.
    return { ...values, valor: netAmount(account) };
}

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
