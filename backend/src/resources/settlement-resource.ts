import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import { attachCurrentUser, requireRole } from "../middlewares/auth";
import { requireEmpresa } from "../middlewares/empresa";
import { formatarErroZod } from "../utils/zod";
import { createSettlement, deleteSettlement, SettlementError, type SettlementKind, updateSettlement } from "../lancamentos/settlement.service";

const uuid = z.string().uuid();
const amount = z.coerce.number().positive();

type CreateBody = { lancamento_id: string; forma_pagamento_id: string; valor: number; data_movimentacao?: string; data_recebimento?: string };
type PatchBody = { forma_pagamento_id?: string; valor?: number; data_movimentacao?: string; data_recebimento?: string };

export function createSettlementResourceRouter(table: SettlementKind): Router {
    const router = Router();
    const dateColumn = table === "movimentacoes" ? "data_movimentacao" : "data_recebimento";
    const createSchema = z.object({ lancamento_id: uuid, forma_pagamento_id: uuid, valor: amount, [dateColumn]: z.string().date().optional() }).strict();
    const patchSchema = z.object({ forma_pagamento_id: uuid.optional(), valor: amount.optional(), [dateColumn]: z.string().date().optional() }).strict();
    const filterSchema = z.object({ lancamento_id: uuid.optional(), forma_pagamento_id: uuid.optional(), [dateColumn]: z.string().date().optional() }).strict();
    const writeAccess = requireRole("admin", "contador", "comum");

    router.use(attachCurrentUser, requireEmpresa);
    router.get("/", async (req: Request, res: Response) => {
        const parsed = filterSchema.safeParse(req.query);
        if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));
        const entries = Object.entries(parsed.data);
        const values: unknown[] = [req.empresaId];
        const clauses = ["empresa_id = $1"];
        for (const [key, value] of entries) { values.push(value); clauses.push(`${key} = $${values.length}`); }
        try { const result = await pool.query(`SELECT id, empresa_id, lancamento_id, forma_pagamento_id, valor, ${dateColumn}, created_at FROM ${table} WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`, values); return res.json({ data: result.rows }); }
        catch { return res.status(500).json({ message: "Erro ao listar registros" }); }
    });
    router.get("/:id", async (req: Request, res: Response) => {
        const id = uuid.safeParse(req.params.id);
        if (!id.success) return res.status(400).json({ message: "ID inválido" });
        try { const result = await pool.query(`SELECT id, empresa_id, lancamento_id, forma_pagamento_id, valor, ${dateColumn}, created_at FROM ${table} WHERE empresa_id = $1 AND id = $2`, [req.empresaId, id.data]); if (!result.rowCount) return res.status(404).json({ message: "Registro não encontrado" }); return res.json({ data: result.rows[0] }); }
        catch { return res.status(500).json({ message: "Erro ao buscar registro" }); }
    });
    router.post("/", writeAccess, async (req: Request, res: Response) => {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));
        const data = parsed.data as CreateBody;
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const settlement = await createSettlement(client, req.empresaId!, table, { lancamentoId: data.lancamento_id, formaPagamentoId: data.forma_pagamento_id, valor: data.valor, data: data[dateColumn] });
            await client.query("COMMIT");
            return res.status(201).json({ id: settlement.id });
        } catch (error) { await client.query("ROLLBACK"); if (error instanceof SettlementError) return res.status(error.status).json({ message: error.message }); return res.status(400).json({ message: "Não foi possível registrar a baixa" }); }
        finally { client.release(); }
    });
    router.patch("/:id", writeAccess, async (req: Request, res: Response) => {
        const recordId = uuid.safeParse(req.params.id);
        if (!recordId.success) return res.status(400).json({ message: "ID inválido" });
        const parsed = patchSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));
        if (!Object.keys(parsed.data).length) return res.status(400).json({ message: "Nenhum campo para atualização" });
        const data = parsed.data as PatchBody;
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const id = await updateSettlement(client, req.empresaId!, table, recordId.data, { formaPagamentoId: data.forma_pagamento_id, valor: data.valor, data: data[dateColumn] });
            await client.query("COMMIT");
            return res.json({ id });
        } catch (error) { await client.query("ROLLBACK"); if (error instanceof SettlementError) return res.status(error.status).json({ message: error.message }); return res.status(400).json({ message: "Não foi possível atualizar a baixa" }); }
        finally { client.release(); }
    });
    router.delete("/:id", writeAccess, async (req: Request, res: Response) => {
        const recordId = uuid.safeParse(req.params.id);
        if (!recordId.success) return res.status(400).json({ message: "ID inválido" });
        const client = await pool.connect();
        try { await client.query("BEGIN"); await deleteSettlement(client, req.empresaId!, table, recordId.data); await client.query("COMMIT"); return res.status(204).send(); }
        catch (error) { await client.query("ROLLBACK"); if (error instanceof SettlementError) return res.status(error.status).json({ message: error.message }); return res.status(409).json({ message: "Não foi possível excluir a baixa" }); }
        finally { client.release(); }
    });
    return router;
}
