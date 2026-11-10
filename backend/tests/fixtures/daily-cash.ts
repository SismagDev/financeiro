import { randomUUID } from "node:crypto";
import { cashColumns, type MappedCashInput } from "../../src/importacao/caixa-diario.plan";

export const cashHeader = 'Filial;Data_Caixa;Sistema;Rec_Dinheiro;Rec_Cartão;Rec_Banco;Rec_Outros;Valor_Sangria;Valor_Suprimento';
export const cashText = (...lines: string[]) => [cashHeader, ...lines].join("\r\n");
export function cashFixture(): MappedCashInput {
    return { acao: "prever", data_inicial: "2025-01-01", resolvidos: [],
        arquivo: cashText('1;2/1/2025;Service/Zaal;R$ 10,30;R$ 20,00;R$ 30,00;;R$ 5,00;R$ 2,00',
            '1;3/1/2025;Service/Zaal;R$ 10,00;R$ 20,00;R$ 30,00;-R$ 5,00;;',
            '1;4/1/2025;Service/Zaal;;;;;;'),
        filiais: { "1": { empresa_id: randomUUID(), tipo_caixa_diario_id: randomUUID(), formas: Object.fromEntries(cashColumns.map(column => [column, randomUUID()])) as Record<typeof cashColumns[number], string> } },
    };
}
