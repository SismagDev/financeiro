import { z } from "zod";
import { createResourceRouter, filterText, optionalBoolean, optionalText, strictObject, text, uuidField } from "../resources/resource";

const tipo = z.enum(["dinheiro", "pix", "debito", "credito", "boleto", "transferencia", "outro"]);
const schema = {
    table: "formas_pagamento",
    fields: ["descricao", "tipo", "banco_id", "ativo"],
    searchFields: ["descricao"],
    create: strictObject({ descricao: text(), tipo, banco_id: uuidField, ativo: z.boolean().optional() }),
    patch: strictObject({ descricao: optionalText(), tipo: tipo.optional(), banco_id: uuidField, ativo: optionalBoolean }),
    filter: strictObject({ descricao: filterText(), tipo: tipo.optional(), banco_id: uuidField, ativo: optionalBoolean }),
    relations: { banco_id: "bancos" },
};

export default createResourceRouter(schema);
