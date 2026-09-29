import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth } from "../middlewares/auth";
import { formatarErroZod } from "../utils/zod";

const empresaSchema = z.object({ nome: z.string().trim().min(2).max(200), cnpj: z.string().regex(/^\d{14}$/).nullable().optional() }).strict();
const router = Router();
router.use(requireAuth);

async function findCompanyConflict(userId: string | undefined, nome: string, cnpj: string | null | undefined, ignoredId?: string) {
    const result = await pool.query<{ nome: string; cnpj: string | null }>(
        `SELECT e.nome, e.cnpj
         FROM empresas e JOIN users_empresas ue ON ue.empresa_id = e.id
         WHERE ue.user_id = $1
           AND ($2::uuid IS NULL OR e.id <> $2)
           AND (LOWER(e.nome) = LOWER($3) OR ($4::text IS NOT NULL AND e.cnpj = $4))
         LIMIT 1`,
        [userId, ignoredId ?? null, nome, cnpj ?? null],
    );
    return result.rows[0] ?? null;
}

function conflictMessage(conflict: { nome: string }, nome: string) {
    return conflict.nome.toLowerCase() === nome.toLowerCase()
        ? "Você já possui uma empresa com este nome"
        : "Você já possui uma empresa com este CNPJ";
}

router.get("/", async (req: Request, res: Response) => {
    try {
        const result = await pool.query(
            `SELECT e.id, e.nome, e.cnpj, e.ativo, ue.perfil
             FROM empresas e JOIN users_empresas ue ON ue.empresa_id = e.id
             WHERE ue.user_id = $1 AND e.ativo = TRUE ORDER BY e.nome`,
            [req.session.user?.id],
        );
        return res.status(200).json({ data: result.rows });
    } catch {
        return res.status(500).json({ message: "Erro ao listar empresas" });
    }
});

router.post("/", async (req: Request, res: Response) => {
    const parsed = empresaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const conflict = await findCompanyConflict(req.session.user?.id, parsed.data.nome, parsed.data.cnpj);
        if (conflict) {
            await client.query("ROLLBACK");
            return res.status(409).json({ message: conflictMessage(conflict, parsed.data.nome) });
        }
        const created = await client.query<{ id: string }>(
            "INSERT INTO empresas (nome, cnpj) VALUES ($1, $2) RETURNING id",
            [parsed.data.nome, parsed.data.cnpj ?? null],
        );
        await client.query(
            "INSERT INTO users_empresas (user_id, empresa_id, perfil) VALUES ($1, $2, 'admin')",
            [req.session.user?.id, created.rows[0].id],
        );
        await client.query("COMMIT");
        return res.status(201).json({ id: created.rows[0].id });
    } catch (error: unknown) {
        await client.query("ROLLBACK");
        if (typeof error === "object" && error !== null && "code" in error && error.code === "23505")
            return res.status(409).json({ message: "CNPJ já cadastrado" });
        return res.status(500).json({ message: "Erro ao criar empresa" });
    } finally {
        client.release();
    }
});

router.patch("/:empresaId", async (req: Request, res: Response) => {
    const empresaId = z.string().uuid().safeParse(req.params.empresaId);
    const parsed = empresaSchema.safeParse(req.body);
    if (!empresaId.success) return res.status(400).json({ message: "ID de empresa inválido" });
    if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const allowed = await client.query(
            "SELECT 1 FROM users_empresas WHERE user_id = $1 AND empresa_id = $2 AND perfil = 'admin'",
            [req.session.user?.id, empresaId.data],
        );
        if (!allowed.rowCount) {
            await client.query("ROLLBACK");
            return res.status(403).json({ message: "Você não tem permissão para editar esta empresa" });
        }
        const conflict = await findCompanyConflict(req.session.user?.id, parsed.data.nome, parsed.data.cnpj, empresaId.data);
        if (conflict) {
            await client.query("ROLLBACK");
            return res.status(409).json({ message: conflictMessage(conflict, parsed.data.nome) });
        }
        const updated = await client.query<{ id: string }>(
            "UPDATE empresas SET nome = $1, cnpj = $2 WHERE id = $3 RETURNING id",
            [parsed.data.nome, parsed.data.cnpj ?? null, empresaId.data],
        );
        await client.query("COMMIT");
        return res.status(200).json({ id: updated.rows[0].id });
    } catch (error: unknown) {
        await client.query("ROLLBACK");
        if (typeof error === "object" && error !== null && "code" in error && error.code === "23505")
            return res.status(409).json({ message: "CNPJ já cadastrado" });
        return res.status(500).json({ message: "Erro ao atualizar empresa" });
    } finally {
        client.release();
    }
});

router.post("/:empresaId/usuarios", async (req: Request, res: Response) => {
    const empresaId = z.string().uuid().safeParse(req.params.empresaId);
    const body = z.object({ email: z.string().email().max(254), perfil: z.string().trim().min(1).max(50).default("usuario") }).strict().safeParse(req.body);
    if (!empresaId.success) return res.status(400).json({ message: "ID de empresa inválido" });
    if (!body.success) return res.status(400).json(formatarErroZod(body.error));

    try {
        const result = await pool.query(
            `INSERT INTO users_empresas (user_id, empresa_id, perfil)
             SELECT u.id, $2, $3 FROM users u
             JOIN users_empresas actor ON actor.user_id = $4 AND actor.empresa_id = $2 AND actor.perfil = 'admin'
             WHERE lower(u.email) = lower($1) AND u.ativo = TRUE
             ON CONFLICT (user_id, empresa_id) DO NOTHING RETURNING user_id`,
            [body.data.email, empresaId.data, body.data.perfil, req.session.user?.id],
        );
        if (!result.rowCount) return res.status(404).json({ message: "Usuário não encontrado ou sem permissão nesta empresa" });
        return res.status(201).json({ user_id: result.rows[0].user_id });
    } catch {
        return res.status(500).json({ message: "Erro ao associar usuário à empresa" });
    }
});

export default router;