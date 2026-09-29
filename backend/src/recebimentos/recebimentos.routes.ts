import { z } from "zod";
import { createResourceRouter, optionalDate, optionalMoney, strictObject, uuidField } from "../resources/resource";

const valor = z.coerce.number().positive();
const data = z.string().date();
const schema = {
    table: "recebimentos",
    fields: ["lancamento_id", "forma_pagamento_id", "valor", "data_recebimento"],
    create: strictObject({ lancamento_id: z.string().uuid(), forma_pagamento_id: z.string().uuid(), valor, data_recebimento: data.optional() }),
    patch: strictObject({ lancamento_id: uuidField, forma_pagamento_id: uuidField, valor: optionalMoney, data_recebimento: optionalDate }),
    filter: strictObject({ lancamento_id: uuidField, forma_pagamento_id: uuidField, data_recebimento: optionalDate }),
    relations: { lancamento_id: "lancamentos", forma_pagamento_id: "formas_pagamento" },
};

export default createResourceRouter(schema);
