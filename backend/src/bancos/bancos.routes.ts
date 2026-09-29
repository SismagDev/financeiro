import { z } from "zod";
import { createResourceRouter, filterText, optionalBoolean, optionalText, strictObject, text } from "../resources/resource";

const schema = {
    table: "bancos",
    fields: ["descricao", "ativo"],
    searchFields: ["descricao"],
    create: strictObject({ descricao: text(), ativo: z.boolean().optional() }),
    patch: strictObject({ descricao: optionalText(), ativo: optionalBoolean }),
    filter: strictObject({ descricao: filterText(), ativo: optionalBoolean }),
};

export default createResourceRouter(schema);
