import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAccessText, accessMoney, accessDate } from "../src/importacao/access-text";
import { importId, importReport, importSchema, prepareImport } from "../src/importacao/importacao.plan";
import { accessFixture } from "./fixtures/access";
import { historicalRecordId } from "../src/utils/access-import";

test("parser Access preserva acentos, separadores, aspas e quebras de linha", () => {
    assert.deepEqual(parseAccessText('\uFEFF"Cod";"Nome"\r\n1;"José; \"\"Teste\"\"\r\nLinha"\r\n', "teste"), [{ Cod: "1", Nome: 'José; "Teste"\r\nLinha' }]);
    assert.throws(() => parseAccessText('"Cod";"Nome"\n1;"aberto', "teste"), /aspas/);
    assert.throws(() => parseAccessText('Cod;Nome\n1;A;extra', "teste"), /quantidade/);
    assert.throws(() => parseAccessText('Cod;Cod\n1;2', "teste"), /duplicado/);
    assert.throws(() => parseAccessText('Outro\n', "teste", ["Cod"]), /coluna obrigatória/);
});
test("conversão monetária e datas rejeitam formatos inválidos sem mudar o dia", () => {
    assert.equal(accessMoney("R$ 1.234,56", "valor"), 1234.56);
    assert.equal(accessMoney("", "valor"), 0);
    assert.equal(accessMoney("R$ -10,50", "valor"), -10.5);
    assert.throws(() => accessMoney("R$ 12,3", "valor"), /inválido/);
    assert.equal(accessDate("9/3/2026 00:00:00", "data"), "2026-03-09");
    assert.throws(() => accessDate("31/2/2026 00:00:00", "data"), /inválida/);
});
test("mapeamento separa pagar/receber com código igual e preserva filiais e ajustes", () => {
    const input = accessFixture(), plan = prepareImport(input);
    assert.equal(plan.contas.length, 3);
    assert.equal(plan.contas[0].input.tipo, "pagar");
    assert.equal(plan.contas[1].input.tipo, "receber");
    assert.notEqual(plan.contas[0].id, plan.contas[1].id);
    assert.equal(plan.contas[0].input.desconto, 10);
    assert.equal(plan.contas[0].input.acrescimo, 5);
    assert.equal(plan.contas[0].payments[0].valor, 95);
    assert.equal(plan.pessoas.filter(person => person.values.nome === "Cliente com conta").length, 2);
    const noAccount = plan.pessoas.find(person => person.values.nome === "Cliente sem conta")!;
    assert.equal(noAccount.empresaId, input.filiais["1"]);
    assert.equal(plan.bancos.length, 2);
    assert.notEqual(plan.bancos[0].id, plan.bancos[1].id);
    assert.equal(plan.formas[0].values.ativo, false);
    assert.equal(plan.ignorados.length, 2);
    assert.equal(importReport(plan).totais.baixas, 3);
    assert.equal(plan.pendencias.length, 0);
});
test("conta histórica sem baixa detalhada recebe somente o resumo com data original", () => {
    const input = accessFixture();
    input.arquivos["recebimentos.txt"] = input.arquivos["recebimentos.txt"].split("\r\n").filter(line => !line.startsWith('"1";')).join("\r\n");
    const plan = prepareImport(input);
    const account = plan.contas.find(account => account.input.tipo === "pagar")!;
    assert.deepEqual(account.payments, [{ codigo: "historica:0:1", formaId: historicalRecordId(input.filiais["1"], "formas_pagamento"), valor: 95, data: "2026-10-05", historica: true }]);
    assert.equal(plan.formas.find(form => form.id === account.payments[0].formaId)?.values.ativo, false);
    assert.equal(plan.bancos.find(bank => bank.id === historicalRecordId(input.filiais["1"], "bancos"))?.values.descricao, "Baixa histórica");
    assert.equal(importReport(plan).totais.baixas_historicas, 1);
    assert.equal(importReport(plan).totais.valor_baixas_historicas, 95);
    assert.equal(plan.pendencias.length, 0);
});

test("histórico complementa baixas detalhadas sem duplicação e cria cadastros por filial", () => {
    const input = accessFixture();
    input.arquivos["recebimentos.txt"] = input.arquivos["recebimentos.txt"].replace('"R$ 95,00"', '"R$ 35,00"').replace('"R$ 50,00"', '"R$ 20,00"');
    const plan = prepareImport(input);
    const paying = plan.contas.find(account => account.input.tipo === "pagar")!;
    assert.deepEqual(paying.payments.map(payment => payment.valor), [35, 60]);
    const receiving = plan.contas.find(account => account.empresaId === input.filiais["2"])!;
    assert.deepEqual(receiving.payments.map(payment => payment.valor), [20, 30]);
    assert.notEqual(paying.payments[1].formaId, receiving.payments[1].formaId);
    assert.equal(importReport(plan).totais.baixas_historicas, 2);
    assert.equal(importReport(plan).totais.valor_baixas_historicas, 90);
    assert.equal(importReport(prepareImport(accessFixture())).totais.baixas_historicas, 0);
});

test("data histórica ausente ou inválida deixa conta inteira e baixas detalhadas como pendências", () => {
    for (const date of ["", "31/2/2026 00:00:00"]) {
        const input = accessFixture();
        input.arquivos["contas_a_pagar.txt"] = input.arquivos["contas_a_pagar.txt"].replace('"R$ 95,00";"5/10/2026 00:00:00"', `"R$ 95,00";"${date}"`);
        input.arquivos["recebimentos.txt"] = input.arquivos["recebimentos.txt"].replace('"R$ 95,00"', '"R$ 35,00"');
        const plan = prepareImport(input);
        assert.equal(plan.contas.some(account => account.input.tipo === "pagar"), false);
        assert.ok(plan.pendencias.some(issue => issue.arquivo === "contas_a_pagar.txt" && issue.motivo.includes("Pagto_Data")));
        assert.ok(plan.pendencias.some(issue => issue.arquivo === "recebimentos.txt" && issue.codigo === "1"));
        assert.equal(importReport(plan).totais.baixas_historicas, 0);
        assert.equal(plan.formas.some(form => form.values.descricao === "Baixa histórica"), false);
    }
});

test("cliente sem nome não é cadastrado e suas contas válidas ficam sem pessoa", () => {
    const input = accessFixture();
    input.arquivos["pessoas.txt"] = input.arquivos["pessoas.txt"].replace('"Cliente com conta"', '""');
    const plan = prepareImport(input);
    assert.equal(plan.contas.length, 3);
    assert.equal(plan.contas.filter(account => account.input.tipo === "receber").every(account => account.input.pessoa_id === null), true);
    assert.equal(plan.pessoas.length, 1);
    assert.equal(importReport(plan).totais.contas_sem_cliente, 2);
    assert.ok(plan.pendencias.some(issue => issue.arquivo === "pessoas.txt" && issue.codigo === "1"));
    assert.equal(plan.avisos.filter(issue => issue.motivo.includes("sem vínculo de pessoa")).length, 2);
});
test("filial divergente, conta inválida e pagamento acima do líquido ficam como pendências", () => {
    for (const transform of [
        (text: string) => text.replace('"1";"1";"5/10/2026 00:00:00";"1";', '"1";"1";"5/10/2026 00:00:00";"2";'),
        (text: string) => text.replace('"R$ 95,00";"0"', '"R$ 96,00";"0"'),
    ]) {
        const input = accessFixture(); input.arquivos["recebimentos.txt"] = transform(input.arquivos["recebimentos.txt"]);
        const plan = prepareImport(input);
        assert.equal(plan.contas.filter(account => account.input.tipo === "pagar").length, 0);
        assert.ok(plan.pendencias.length > 0);
    }
    const input = accessFixture(); input.arquivos["contas_a_pagar.txt"] = input.arquivos["contas_a_pagar.txt"].replace('"R$ 100,00"', '"R$ 0,00"');
    assert.ok(prepareImport(input).pendencias.some(issue => issue.arquivo === "contas_a_pagar.txt"));
});
test("filial 3 exige UUID e não aceita destinos repetidos nem tipo desconhecido", () => {
    const input = accessFixture();
    input.arquivos["contas_a_pagar.txt"] = input.arquivos["contas_a_pagar.txt"].replace('"1";"1";', '"1";"3";');
    delete input.filiais["3"];
    assert.throws(() => prepareImport(input), /UUID da filial 3/);
    input.filiais["2"] = input.filiais["1"];
    assert.equal(importSchema.safeParse(input).success, false);
    const other = accessFixture(); other.arquivos["recebimentos.txt"] = other.arquivos["recebimentos.txt"].replace('"R$ 95,00";"0"', '"R$ 95,00";"2"');
    assert.throws(() => prepareImport(other), /Tipo deve ser/);
    assert.equal(importId(input.filiais["1"], "lancamentos", "0:1"), importId(input.filiais["1"], "lancamentos", "0:1"));
});
