import assert from "node:assert/strict";
import { test } from "node:test";
import { liquidValue } from "../src/lancamentos/launch-values";
import { netAmount, remainingAmount } from "../../frontend/src/utils/accounts";

test("frontend e backend calculam o mesmo líquido em centavos e preservam contas sem ajustes", () => {
    for (const input of [{ valor: 100 }, { valor: 100, desconto: 10, acrescimo: 5 }, { valor: 0.3, desconto: 0.2, acrescimo: 0.1 }])
        assert.equal(netAmount(input), liquidValue(input));
    assert.equal(netAmount({ valor: 0.3, desconto: 0.2, acrescimo: 0.1 }), 0.2);
    assert.equal(remainingAmount({ id: "conta", tipo: "receber", valor: 100, desconto: 10, acrescimo: 5 }, {
        recebimentos: [{ lancamento_id: "conta", valor: 40 }, { lancamento_id: "outra", valor: 100 }], movimentacoes: [],
    }), 55);
});
