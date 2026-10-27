import { importSchema } from "../../src/importacao/importacao.plan";

export function accessFixture() {
    const csv = (headers: string[], records: string[][]) => [headers, ...records].map(row => row.map(value => `"${value.replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const headers = ["Cod", "Filial", "Ident_Cliente", "Cód_Plano", "Conta_Descrição", "Conta_Vecto", "Conta_Valor", "Desconto", "Acréscimo", "Pagto_Valor", "Pagto_Data", "Forma_Pagto", "Competência", "Num_DOC", "Obs"];
    return importSchema.parse({
        filiais: { "1": "11111111-1111-4111-8111-111111111111", "2": "22222222-2222-4222-8222-222222222222", "3": "33333333-3333-4333-8333-333333333333" },
        arquivos: {
            "pessoas.txt": csv(["Ident", "Cliente", "CNPJ_CPF", "Ativo"], [["1", "Cliente com conta", "", "1"], ["2", "Cliente sem conta", "", "1"]]),
            "bancos.txt": csv(["Cod", "Identificacao", "Ativo"], [["0", "Caixa Local", "1"], ["1", "Banco legado", "1"]]),
            "forma_pagamento.txt": csv(["Cod", "Cod_Banco", "Forma", "Ativo"], [["1", "1", "Pix", "0"], ["2", "0", "Dinheiro", "1"]]),
            "plano_contas.txt": csv(["Cód_Plano", "Plano_de_Contas"], [["1", "Serviços"]]),
            "contas_a_pagar.txt": csv(headers, [["1", "1", "", "1", "Compra", "5/10/2026 00:00:00", "R$ 100,00", "R$ 10,00", "R$ 5,00", "R$ 95,00", "5/10/2026 00:00:00", "Pix", "2026-10-out", "A1", "Observação"]]),
            "contas_a_receber.txt": csv(headers, [
                ["1", "1", "1", "1", "Serviço 1", "6/10/2026 00:00:00", "R$ 100,00", "R$ 0,00", "R$ 0,00", "R$ 40,00", "6/10/2026 00:00:00", "Pix", "2026-10-out", "R1", ""],
                ["2", "2", "1", "1", "Serviço 2", "7/10/2026 00:00:00", "R$ 50,00", "R$ 0,00", "R$ 0,00", "R$ 50,00", "7/10/2026 00:00:00", "Pix", "2026-10-out", "R2", ""],
                ["3", "0", "1", "1", "Sem filial", "7/10/2026 00:00:00", "R$ 20,00", "R$ 0,00", "R$ 0,00", "R$ 0,00", "", "", "2026-10-out", "", ""],
            ]),
            "recebimentos.txt": csv(["Cod_Pagto", "Cod_Conta", "Data_Pagto", "Filial", "Cod_Forma_Pagto", "Cod_Banco", "Valor_Pagto", "Tipo"], [
                ["1", "1", "5/10/2026 00:00:00", "1", "1", "1", "R$ 95,00", "0"],
                ["2", "1", "6/10/2026 00:00:00", "1", "1", "1", "R$ 40,00", "1"],
                ["3", "2", "7/10/2026 00:00:00", "2", "1", "1", "R$ 50,00", "1"],
                ["4", "99", "7/10/2026 00:00:00", "2", "1", "1", "R$ 10,00", "1"],
            ]),
        },
    });
}
