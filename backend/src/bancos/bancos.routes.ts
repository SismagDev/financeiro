import { z } from "zod";
import { createResourceRouter, filterText, optionalBoolean, optionalText, strictObject, text } from "../resources/resource";

const bankNumber = z.string().trim().max(100).transform(value => value || null).nullable().optional();

const schema = {
    table: "bancos",
    fields: ["descricao", "agencia", "conta", "ativo"],
    searchFields: ["descricao"],
    create: strictObject({ descricao: text(), agencia: bankNumber, conta: bankNumber, ativo: z.boolean().optional() }),
    patch: strictObject({ descricao: optionalText(), agencia: bankNumber, conta: bankNumber, ativo: optionalBoolean }),
    filter: strictObject({ descricao: filterText(), ativo: optionalBoolean }),
    uniqueConflictMessages: {
        bancos_empresa_nome_unique: "Já existe um banco com esse nome nesta empresa.",
        bancos_empresa_agencia_conta_unique: "Já existe um banco com essa agência e conta nesta empresa.",
    },
};

export default createResourceRouter(schema);
