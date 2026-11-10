import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { analyzeCash, cashImportSchema, cashMoney, prepareCash } from "../src/importacao/caixa-diario.plan";
import { cashFixture, cashText, cashHeader } from "./fixtures/daily-cash";

test("histórico: vazios/zeros mistos usam apenas Service + Zaal − Despesas em centavos", () => {
    const arquivo = [cashHeader + ';Receita_Service;Receita_Zaal;Despesas;Venda_Equipamentos;Compra_Equipamentos',
        ['1','1/1/2025','Service/Zaal','','R$ 0,00','','R$ 0,00','R$ 900,00','R$ 700,00','R$ 100,10','R$ 20,20','R$ 10,05','R$ 999,00','R$ 500,00'].join(';'),
        ['1','2/1/2025','Service/Zaal','','','','','','','R$ 10,00','','R$ 10,00','',''].join(';'),
        ['1','3/1/2025','Service/Zaal','R$ 0,00','R$ 0,00','R$ 0,00','R$ 0,00','','','R$ 10,00','','R$ 15,00','',''].join(';'),
        ['1','4/1/2025','Service/Zaal','','R$ 1,00','','','R$ 4,00','R$ 2,00','R$ 999,00','','R$ 10,00','',''].join(';'),
    ].join('\r\n');
    const plan = analyzeCash({ arquivo, data_inicial: '2025-01-01' });
    assert.equal(plan.dias[0].historico?.resultado, 110.25);
    assert.equal(plan.dias[0].total, 110.25);
    assert.equal(plan.dias[0].valores.Rec_Dinheiro, 0);
    assert.equal(plan.dias[1].total, 0);
    assert.equal(plan.dias[2].total, 0);
    assert.equal(plan.dias[2].pendencias[0].valor, -5);
    assert.equal(plan.dias[3].historico, null);
    assert.equal(plan.dias[3].valores.Rec_Dinheiro, 2);
    assert.equal(plan.dias[3].total, 3);
});

test("caixa: centavos, sinal antes do símbolo, datas e dia inteiro pendente", () => {
    assert.equal(cashMoney("-R$ 1.234,56", "teste"), -1234.56);
    assert.throws(() => cashMoney("R$ 12,3", "teste"), /inválido/);
    const plan = prepareCash(cashFixture());
    assert.equal(plan.dias[0].valores.Rec_Dinheiro, 13.3);
    assert.equal(plan.dias[0].total, 63.3);
    assert.equal(plan.dias[1].pendencias[0].campo, "Rec_Outros");
    assert.equal(plan.dias[1].total, 60); // Apenas a prévia manual; o dia não é elegível para carga automática.
    assert.equal(plan.dias.filter(day => !day.pendencias.length && day.total > 0).length, 1);
    assert.equal(plan.dias[2].total, 0);
});

test("caixa: filtro inicial, detecção dinâmica de filiais e dinheiro negativo após ajuste", () => {
    const input = cashFixture();
    input.arquivo = cashText('7;31/12/2024;Service/Zaal;R$ 1,00;;;;;', '9;1/1/2025;Service/Zaal;R$ 90,30;R$ 20,00;;;;R$ 450,00');
    const plan = analyzeCash(input);
    assert.deepEqual(plan.filiais, ["7", "9"]);
    assert.equal(plan.anteriores, 1);
    assert.equal(plan.dias.length, 1);
    assert.equal(plan.dias[0].valores.Rec_Dinheiro, -359.7);
    assert.equal(plan.dias[0].pendencias.length, 1);
    assert.equal(plan.dias[0].total, 20);
});

test("caixa: rejeita duplicação no arquivo, mapeamentos inválidos e exclusões de dias válidos", () => {
    const input = cashFixture();
    const duplicate = input.arquivo.split("\r\n")[1];
    assert.throws(() => prepareCash({ ...input, arquivo: `${input.arquivo}\r\n${duplicate}` }), /repetido/);
    assert.throws(() => prepareCash({ ...input, filiais: {} }), /filial 1/);
    assert.throws(() => prepareCash({ ...input, resolvidos: ["1:2025-01-02"] }), /Resolução/);
    input.filiais["1"].formas.Rec_Outros = input.filiais["1"].formas.Rec_Banco;
    assert.equal(cashImportSchema.safeParse(input).success, false);
    assert.equal(cashImportSchema.safeParse({ acao: "analisar", arquivo: "x", data_inicial: "2025-02-30" }).success, false);
});

test("caixa: TXT real somente em memória, filtro e exclusão integral dos seis dias negativos", { skip: !process.env.DAILY_CASH_TXT }, async () => {
    const bytes = await readFile(process.env.DAILY_CASH_TXT!);
    const arquivo = new TextDecoder("windows-1252").decode(bytes);
    const full = analyzeCash({ arquivo, data_inicial: "2020-01-01" });
    console.log(`TXT completo: ${full.dias.length} dias; ${full.dias.filter(day => day.historico && day.total > 0).length} históricos positivos; ${full.dias.filter(day => day.historico && day.pendencias.length).length} históricos negativos.`);
    const plan = analyzeCash({ arquivo, data_inicial: "2025-01-01" });
    assert.equal(plan.dias.length, 555);
    assert.deepEqual(plan.filiais, ["1"]);
    const pending = plan.dias.filter(day => day.pendencias.length);
    assert.deepEqual(pending.map(day => day.data), ["2025-09-27", "2026-04-08", "2026-04-27", "2026-04-29", "2026-06-11", "2026-06-30"]);
    const ready = plan.dias.filter(day => !day.pendencias.length && day.total > 0);
    assert.equal(ready.length, 549);
    const total = ready.reduce((sum, day) => sum + Math.round(day.total * 100), 0) / 100;
    assert.equal(Math.round(total * 100), 88730259 - pending.reduce((sum, day) => sum + Math.round(day.total * 100), 0));
    assert.equal(total, 882542.29);
    console.log(`TXT real: ${ready.length} dias automáticos, ${pending.length} pendentes, total ${total.toFixed(2)}. Nenhuma conexão com o banco.`);
});
