import { z } from "zod";
import { accessDate, accessMoney, parseAccessText } from "./access-text";
import { SettlementError } from "../lancamentos/settlement.service";
import { dailyCashSchema } from "../caixa/caixa-diario.service";

export const cashColumns = ["Rec_Dinheiro", "Rec_Cartão", "Rec_Banco", "Rec_Outros"] as const;
export type CashColumn = typeof cashColumns[number];
const sourceShape = { arquivo: z.string().min(1).max(8_000_000), data_inicial: z.string().date(), sistema: z.string().trim().min(1).max(200).optional() };
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const mappingSchema = z.object({ empresa_id: uuid, tipo_caixa_diario_id: uuid,
    formas: z.object({ Rec_Dinheiro: uuid.optional(), "Rec_Cartão": uuid.optional(), Rec_Banco: uuid.optional(), Rec_Outros: uuid.optional() }).strict()
        .refine(value => new Set(Object.values(value).filter(Boolean)).size === Object.values(value).filter(Boolean).length, "Escolha formas diferentes para cada coluna"),
}).strict();
const mappedShape = { ...sourceShape, filiais: z.record(z.string().regex(/^\d+$/), mappingSchema),
    resolvidos: z.array(z.string().max(100)).max(10000).default([]) };
export const cashImportSchema = z.discriminatedUnion("acao", [
    z.object({ ...sourceShape, acao: z.literal("analisar") }).strict(),
    z.object({ ...mappedShape, acao: z.literal("prever") }).strict(),
    z.object({ ...mappedShape, acao: z.literal("importar") }).strict(),
    z.object({ ...mappedShape, acao: z.literal("manual"), chave: z.string().max(100), valores: dailyCashSchema }).strict(),
]);
export type CashImportInput = z.infer<typeof cashImportSchema>;
export type MappedCashInput = Exclude<CashImportInput, { acao: "analisar" }>;
export type CashMapping = z.infer<typeof mappingSchema>;
export type CashDay = {
    chave: string; filial: string; data: string; sistemas: string[];
    originais: Record<CashColumn, number>; sangria: number; suprimento: number;
    valores: Record<CashColumn, number>; total: number;
    historico: { service: number; zaal: number; despesas: number; resultado: number } | null;
    pendencias: { campo: string; valor: number; motivo: string }[];
};

// Apenas este importador aceita o sinal antes do símbolo; o contrato do importador antigo é preservado.
export function cashMoney(value: string, context: string): number {
    return accessMoney(value.replace(/^-\s*R\$\s*/, "R$ -"), context);
}

export function analyzeCash(input: Pick<CashImportInput, "arquivo" | "data_inicial" | "sistema">) {
    const rows = parseAccessText(input.arquivo, "Caixa Diário", ["Filial", "Data_Caixa", "Sistema", ...cashColumns, "Valor_Sangria", "Valor_Suprimento"]);
    const days = new Map<string, CashDay>();
    const sistemas = [...new Set(rows.map(row => row.Sistema.trim()))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (sistemas.some(system => !system || system.length > 200)) throw new SettlementError("Informe um Sistema válido em cada linha");
    if (input.sistema && !sistemas.includes(input.sistema)) throw new SettlementError("Sistema não encontrado no arquivo");
    const filiais = new Set<string>();
    let anteriores = 0;
    const safe = (cents: number) => { if (!Number.isSafeInteger(cents)) throw new SettlementError("Valor fora do limite"); return cents / 100; };
    for (const [index, row] of rows.entries()) {
        if (input.sistema && row.Sistema !== input.sistema) continue;
        if (!/^\d+$/.test(row.Filial)) throw new SettlementError(`Linha ${index + 2}: filial inválida`);
        const date = accessDate(row.Data_Caixa, `Linha ${index + 2}`);
        filiais.add(row.Filial);
        if (date < input.data_inicial) { anteriores++; continue; }
        const key = `${row.Filial}:${date}${!input.sistema && sistemas.length > 1 ? ':' + row.Sistema : ''}`;
        // O arquivo é um resumo diário. Repetições não devem multiplicar silenciosamente os valores.
        if (days.has(key)) throw new SettlementError(`Dia repetido no arquivo: filial ${row.Filial}, ${date}`);
        const originais = Object.fromEntries(cashColumns.map(column => [column, cashMoney(row[column], `${date} ${column}`)])) as Record<CashColumn, number>;
        const sangria = cashMoney(row.Valor_Sangria, `${date} sangria`), suprimento = cashMoney(row.Valor_Suprimento, `${date} suprimento`);
        const semRecebimentos = cashColumns.every(column => originais[column] === 0);
        const historico = semRecebimentos ? { service: cashMoney(row.Receita_Service || "", date), zaal: cashMoney(row.Receita_Zaal || "", date), despesas: cashMoney(row.Despesas || "", date), resultado: 0 } : null;
        if (historico) historico.resultado = safe(Math.round(historico.service * 100) + Math.round(historico.zaal * 100) - Math.round(historico.despesas * 100));
        const valores = { ...originais, Rec_Dinheiro: semRecebimentos ? 0 : safe(Math.round(originais.Rec_Dinheiro * 100) + Math.round(sangria * 100) - Math.round(suprimento * 100)) };
        const pendencias: CashDay["pendencias"] = cashColumns.filter(column => valores[column] < 0).map(campo => ({ campo, valor: valores[campo], motivo: campo === "Rec_Dinheiro" ? "Dinheiro negativo após somar sangria e descontar suprimento" : "Recebimento negativo" }));
        if (historico && historico.resultado < 0) pendencias.push({ campo: "Baixa histórica", valor: historico.resultado, motivo: "Receita Service + Receita Zaal − Despesas resultou em valor negativo" });
        const total = historico ? Math.max(0, historico.resultado) : safe(cashColumns.reduce((sum, column) => sum + Math.max(0, Math.round(valores[column] * 100)), 0));
        days.set(key, { chave: key, filial: row.Filial, data: date, sistemas: [row.Sistema], originais, sangria, suprimento, valores, total, pendencias, historico });
    }
    return { sistemas, filiais: [...filiais].sort(), anteriores, dias: [...days.values()].sort((a, b) => a.data.localeCompare(b.data) || a.filial.localeCompare(b.filial)) };
}

export function prepareCash(input: MappedCashInput) {
    const analysis = analyzeCash(input);
    if (!input.sistema && analysis.sistemas.length > 1) throw new SettlementError("Escolha o Sistema da etapa antes de continuar");
    for (const filial of analysis.filiais) if (!input.filiais[filial]) throw new SettlementError(`Selecione a empresa, tipo e formas da filial ${filial}`);
    if (Object.keys(input.filiais).some(filial => !analysis.filiais.includes(filial))) throw new SettlementError("Mapeamento contém filial ausente do arquivo");
    const targets = new Set<string>();
    for (const day of analysis.dias) {
        const target = `${input.filiais[day.filial]!.empresa_id}:${day.data}`;
        if (targets.has(target)) throw new SettlementError(`Mais de uma filial aponta para a mesma empresa em ${day.data}`);
        targets.add(target);
    }
    for (const key of input.resolvidos) if (!analysis.dias.some(day => day.chave === key && day.pendencias.length)) throw new SettlementError("Resolução manual inválida");
    return analysis;
}
