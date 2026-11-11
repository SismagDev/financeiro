import assert from "node:assert/strict";
import { test } from "node:test";
import { accountDueUrgency, installmentPreview } from "../../frontend/src/utils/accounts";
import { cloneAccountValues } from "../../frontend/src/utils/account-form";
import type { Company } from "../../frontend/src/types";

test("urgência respeita dias civis, limites inclusivos e preferências da empresa", () => {
    const row = { tipo: "receber", status: "parcial", saldo: 50, data_vencimento: "2026-11-11T00:00:00.000Z" };
    const company: Company = { id: "a", nome: "A", perfil: "comum", vencimento_dias_urgente: 1, vencimento_dias_atencao: 7 };
    for (const [date, level] of [["2026-11-10", "urgent"], ["2026-11-11", "urgent"], ["2026-11-12", "urgent"], ["2026-11-13", "attention"], ["2026-11-18", "attention"], ["2026-11-19", undefined]] as const) {
        assert.equal(accountDueUrgency({ ...row, data_vencimento: date }, company, "2026-11-11")?.level, level);
    }
    assert.equal(accountDueUrgency({ ...row, data_vencimento: "2026-11-13" }, { ...company, vencimento_dias_urgente: 3 }, "2026-11-11")?.level, "urgent");
    assert.equal(accountDueUrgency(row, company, "2026-11-11")?.label, "Vence hoje");
    assert.equal(accountDueUrgency({ ...row, data_vencimento: "2026-11-10" }, company, "2026-11-11")?.label, "Vencida há 1 dia");
    assert.equal(accountDueUrgency({ ...row, data_vencimento: "2024-03-01" }, company, "2024-02-29")?.label, "Vence em 1 dia");
    for (const values of [{ status: "pago" }, { status: "cancelado" }, { saldo: 0 }]) assert.equal(accountDueUrgency({ ...row, ...values }, company, "2026-11-11"), null);
});

test("clone preserva dados editáveis e líquido sem identidade, histórico ou grupo de parcelas", () => {
    const source = { id: "origem", empresa_id: "empresa", tipo: "pagar", descricao: "Conta original", pessoa_id: "pessoa", pessoa_nome: "Cliente",
        plano_conta_id: "plano", valor: 100, desconto: 10, acrescimo: 5, status: "pago", saldo: 0, observacoes: "Detalhes", num_doc: "DOC",
        data_vencimento: "2026-12-01", competencia: "2026-12-01", grupo_parcelamento_id: "grupo", numero_parcela: 2, total_parcelas: 3,
        importacao_id: "importada", quantidade_baixas: 2, data_ultima_baixa: "2026-11-11" };
    const original = structuredClone(source);
    const clone = cloneAccountValues(source);
    assert.deepEqual(source, original);
    assert.equal(clone.valor, 95);
    for (const field of ["id", "status", "saldo", "grupo_parcelamento_id", "numero_parcela", "total_parcelas", "importacao_id", "quantidade_baixas", "data_ultima_baixa", "desconto", "acrescimo"]) assert.equal(field in clone, false, field);
    for (const field of ["empresa_id", "tipo", "descricao", "pessoa_id", "plano_conta_id", "observacoes", "num_doc", "data_vencimento", "competencia"] as const) assert.equal(clone[field], source[field]);
    assert.equal(installmentPreview(clone, 1, "parcela", "2026-12-01", "dez/2026")[0].valor, 95);
});
