import { z } from "zod";
import { createResourceRouter, filterText, optionalBoolean, optionalText, strictObject, text } from "../resources/resource";

const schema = {
    table: "pessoas",
    fields: ["nome", "celular", "documento", "cliente", "fornecedor", "ativo"],
    searchFields: ["nome", "celular", "documento"],
    create: strictObject({
        nome: text(), celular: z.string().trim().max(50).nullable().optional(),
        documento: z.string().trim().max(50).nullable().optional(),
        cliente: z.boolean().optional(), fornecedor: z.boolean().optional(), ativo: z.boolean().optional(),
    }),
    patch: strictObject({
        nome: optionalText(), celular: z.string().trim().max(50).nullable().optional(),
        documento: z.string().trim().max(50).nullable().optional(),
        cliente: optionalBoolean, fornecedor: optionalBoolean, ativo: optionalBoolean,
    }),
    filter: strictObject({
        nome: filterText(), celular: filterText(50), documento: filterText(50),
        cliente: optionalBoolean, fornecedor: optionalBoolean, ativo: optionalBoolean,
    }),
};

export default createResourceRouter(schema);
