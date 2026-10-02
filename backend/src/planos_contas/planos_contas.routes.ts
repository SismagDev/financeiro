import { createResourceRouter, filterText, optionalText, strictObject, text } from "../resources/resource";

export default createResourceRouter({
    table: "planos_contas",
    fields: ["descricao"],
    searchFields: ["descricao"],
    create: strictObject({ descricao: text() }),
    patch: strictObject({ descricao: optionalText() }),
    filter: strictObject({ descricao: filterText() }),
});

