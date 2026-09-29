import z, { ZodError } from "zod";

export function formatarErroZod(error: ZodError) {
    return {
        mensagem: "Dados inválidos",
        erros: error.issues.map((erro) => ({
            campo: erro.path.join("."),
            mensagem: erro.message,
        })),
    };
}

export function toBoolean(optional: boolean) {
    return z.preprocess(
        (valor) => {
            if (valor === "true") return true;
            if (valor === "false") return false;
            return valor;
        },
        optional ? z.boolean().optional() : z.boolean(),
    );
}
