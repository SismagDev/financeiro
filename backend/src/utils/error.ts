import "dotenv/config";

export function gerarMensagemErroController(e: unknown, mensagemHumanizada: string) {
    const msg = e instanceof Error ? e.message : typeof e === "string" ? e : mensagemHumanizada;
    if (process.env.NODE_ENV === "development") console.log(msg);

    return msg;
}
