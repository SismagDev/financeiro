import { createResourceRouter, filterText, optionalText, strictObject, text } from "../resources/resource";

export default createResourceRouter({
    table: "tipos_caixa_diario",
    fields: ["descricao"],
    searchFields: ["descricao"],
    create: strictObject({ descricao: text() }),
    patch: strictObject({ descricao: optionalText() }),
    filter: strictObject({ descricao: filterText() }),
});
