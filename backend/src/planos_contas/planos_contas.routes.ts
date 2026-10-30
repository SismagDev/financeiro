import { createResourceRouter, filterText, optionalText, strictObject, text } from "../resources/resource";
import { z } from "zod";

const tipo = z.enum(["receber", "pagar", "ambos"]);

export default createResourceRouter({
    table: "planos_contas",
    fields: ["descricao", "tipo"],
    searchFields: ["descricao"],
    create: strictObject({ descricao: text(), tipo: tipo.default("ambos") }),
    patch: strictObject({ descricao: optionalText(), tipo: tipo.optional() }),
    filter: strictObject({ descricao: filterText(), tipo: tipo.optional() }),
});

