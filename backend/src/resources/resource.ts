import { Router, type Request, type Response } from "express";
import { z, type ZodObject, type ZodRawShape } from "zod";
import { pool } from "../db";
import { attachCurrentUser, requireRole } from "../middlewares/auth";
import { requireEmpresa } from "../middlewares/empresa";
import { formatarErroZod } from "../utils/zod";

type ResourceConfig = {
    table: string;
    fields: string[];
    searchFields?: string[];
    create: ZodObject<ZodRawShape>;
    patch: ZodObject<ZodRawShape>;
    filter: ZodObject<ZodRawShape>;
    relations?: Record<string, string>;
};

function columns(config: ResourceConfig) {
    return ["id", "empresa_id", ...config.fields, "created_at"].join(", ");
}

export function createResourceRouter(config: ResourceConfig, secured = true): Router {
    const router = Router();
    if (secured) router.use(attachCurrentUser, requireEmpresa);
    const writeAccess = requireRole("admin", "contador", "comum");

    async function relationsBelongToCompany(values: Record<string, unknown>, empresaId?: string) {
        for (const [field, table] of Object.entries(config.relations || {})) {
            const value = values[field];
            if (value === undefined || value === null) continue;
            const result = await pool.query(
                `SELECT 1 FROM ${table} WHERE empresa_id = $1 AND id = $2 LIMIT 1`,
                [empresaId, value],
            );
            if (!result.rowCount) return false;
        }
        return true;
    }

    router.get("/", async (req: Request, res: Response) => {
        const parsed = config.filter.safeParse(req.query);
        if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));

        const entries = Object.entries(parsed.data);
        const values: unknown[] = [req.empresaId];
        const clauses = ["empresa_id = $1"];
        for (const [key, value] of entries) {
            const partial = config.searchFields?.includes(key) ?? false;
            values.push(partial ? `%${value}%` : value);
            clauses.push(`${key} ${partial ? "ILIKE" : "="} $${values.length}`);
        }

        try {
            const result = await pool.query(
                `SELECT ${columns(config)} FROM ${config.table} WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`,
                values,
            );
            return res.status(200).json({ data: result.rows });
        } catch (e) {
            console.log(e);
            return res.status(500).json({ message: "Erro ao listar registros" });
        }
    });

    router.get("/:id", async (req: Request, res: Response) => {
        if (!z.string().uuid().safeParse(req.params.id).success)
            return res.status(400).json({ message: "ID inválido" });
        try {
            const result = await pool.query(
                `SELECT ${columns(config)} FROM ${config.table} WHERE empresa_id = $1 AND id = $2`,
                [req.empresaId, req.params.id],
            );
            if (!result.rows[0]) return res.status(404).json({ message: "Registro não encontrado" });
            return res.status(200).json({ data: result.rows[0] });
        } catch {
            return res.status(500).json({ message: "Erro ao buscar registro" });
        }
    });

    router.post("/", writeAccess, async (req: Request, res: Response) => {
        const parsed = config.create.safeParse(req.body);
        if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));
        if (!(await relationsBelongToCompany(parsed.data, req.empresaId)))
            return res.status(400).json({ message: "Uma referência pertence a outra empresa" });

        const entries = Object.entries(parsed.data);
        const fields = ["empresa_id", ...entries.map(([key]) => key)];
        const values = [req.empresaId, ...entries.map(([, value]) => value)];
        const placeholders = values.map((_, index) => `$${index + 1}`);
        try {
            const result = await pool.query(
                `INSERT INTO ${config.table} (${fields.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
                values,
            );
            return res.status(201).json({ id: result.rows[0].id });
        } catch {
            return res.status(400).json({ message: "Não foi possível cadastrar o registro" });
        }
    });

    router.patch("/:id", writeAccess, async (req: Request, res: Response) => {
        if (!z.string().uuid().safeParse(req.params.id).success)
            return res.status(400).json({ message: "ID inválido" });
        const parsed = config.patch.safeParse(req.body);
        if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));
        const entries = Object.entries(parsed.data);
        if (!entries.length) return res.status(400).json({ message: "Nenhum campo para atualização" });
        if (!(await relationsBelongToCompany(parsed.data, req.empresaId)))
            return res.status(400).json({ message: "Uma referência pertence a outra empresa" });

        const values = entries.map(([, value]) => value);
        const set = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
        values.push(req.empresaId, req.params.id);
        try {
            const result = await pool.query(
                `UPDATE ${config.table} SET ${set} WHERE empresa_id = $${values.length - 1} AND id = $${values.length} RETURNING id`,
                values,
            );
            if (!result.rows[0]) return res.status(404).json({ message: "Registro não encontrado" });
            return res.status(200).json({ id: result.rows[0].id });
        } catch {
            return res.status(400).json({ message: "Não foi possível atualizar o registro" });
        }
    });

    router.delete("/:id", writeAccess, async (req: Request, res: Response) => {
        if (!z.string().uuid().safeParse(req.params.id).success)
            return res.status(400).json({ message: "ID inválido" });
        try {
            const result = await pool.query(
                `DELETE FROM ${config.table} WHERE empresa_id = $1 AND id = $2 RETURNING id`,
                [req.empresaId, req.params.id],
            );
            if (!result.rows[0]) return res.status(404).json({ message: "Registro não encontrado" });
            return res.status(204).send();
        } catch {
            return res.status(409).json({ message: "Registro possui vínculos e não pode ser excluído" });
        }
    });

    return router;
}

export const uuidField = z.string().uuid().optional();
export const booleanField = z.preprocess(
    (value) => (value === "true" ? true : value === "false" ? false : value),
    z.boolean().optional(),
);
export const text = (max = 200) => z.string().trim().min(1).max(max);
export const optionalText = (max = 200) => text(max).optional();
export const optionalBoolean = booleanField;
export const optionalDate = z.string().date().optional();
export const optionalMoney = z.coerce.number().positive().optional();
export const filterText = (max = 200) => z.string().trim().min(1).max(max).optional();
export const filterBoolean = booleanField;
export const strictObject = (shape: ZodRawShape) => z.object(shape).strict();
