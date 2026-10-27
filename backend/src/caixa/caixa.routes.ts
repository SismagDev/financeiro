import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { attachCurrentUser } from "../middlewares/auth";
import { requireEmpresa } from "../middlewares/empresa";
import { listRecords, listShape } from "../resources/list.service";
import { formatarErroZod } from "../utils/zod";

const router = Router();
router.use(attachCurrentUser, requireEmpresa);
router.get("/", async (req: Request, res: Response) => {
    const parsed = z.object({ ...listShape, de: z.string().date().optional(), ate: z.string().date().optional(),
        saldo_inicial: z.coerce.number().finite().default(0) }).strict().safeParse(req.query);
    if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));
    const query = { ...parsed.data, data_inicial: parsed.data.data_inicial ?? parsed.data.de, data_final: parsed.data.data_final ?? parsed.data.ate };
    if (query.data_inicial && query.data_final && query.data_inicial > query.data_final)
        return res.status(400).json({ message: "O período inicial deve ser anterior ao final" });
    try {
        const result = await listRecords({ table: "caixa", fields: [] }, query, req.empresaIds ?? [req.empresaId!]);
        const initial = query.saldo_inicial;
        return res.json({ ...result, data: result.data.map((row: Record<string, unknown>) => ({ ...row,
            tipo: row.tipo_caixa, valor: Number(row.valor_caixa),
            forma_pagamento: row.forma_pagamento_descricao,
            saldo_antes: Math.round((initial + Number(row.saldo_antes)) * 100) / 100,
            saldo_depois: Math.round((initial + Number(row.saldo_depois)) * 100) / 100 })),
            saldo_atual: Math.round((initial + Number(result.meta.movimento)) * 100) / 100, saldo_inicial: initial });
    } catch (error) {
        return res.status(error instanceof Error && error.message === "Ordenação inválida" ? 400 : 500).json({ message: "Erro ao calcular o caixa" });
    }
});
export default router;
