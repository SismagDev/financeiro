import { z } from "zod";

export const adjustmentSchema = z.coerce.number().finite().nonnegative().max(9999999999999.99).multipleOf(0.01);
export const settlementConfirmationShape = {
    acrescimo_confirmado: adjustmentSchema.optional(),
    saldo_confirmado: adjustmentSchema.optional(),
};
export type SettlementConfirmation = { acrescimo_confirmado?: number; saldo_confirmado?: number };
type Amounts = { valor: number | string; desconto?: number | string; acrescimo?: number | string };

export function liquidValue(input: Amounts): number {
    return (Math.round(Number(input.valor) * 100) - Math.round(Number(input.desconto ?? 0) * 100)
        + Math.round(Number(input.acrescimo ?? 0) * 100)) / 100;
}

export function validateLaunchAmounts(input: Amounts) {
    return z.object({ valor: z.coerce.number().finite().positive(), desconto: adjustmentSchema.default(0), acrescimo: adjustmentSchema.default(0) })
        .refine(value => liquidValue(value) >= 0, { path: ["desconto"], message: "O desconto não pode superar o valor com acréscimo" })
        .parse(input);
}
