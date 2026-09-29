import { z } from "zod";
import { createResourceRouter, optionalDate, optionalMoney, strictObject, uuidField } from "../resources/resource";

const valor = z.coerce.number().positive();
const data = z.string().date();
const schema = {
    table: "movimentacoes",
    fields: ["lancamento_id", "forma_pagamento_id", "valor", "data_movimentacao"],
    create: strictObject({ lancamento_id: z.string().uuid(), forma_pagamento_id: z.string().uuid(), valor, data_movimentacao: data.optional() }),
    patch: strictObject({ lancamento_id: uuidField, forma_pagamento_id: uuidField, valor: optionalMoney, data_movimentacao: optionalDate }),
    filter: strictObject({ lancamento_id: uuidField, forma_pagamento_id: uuidField, data_movimentacao: optionalDate }),
    relations: { lancamento_id: "lancamentos", forma_pagamento_id: "formas_pagamento" },
};

export default createResourceRouter(schema);
