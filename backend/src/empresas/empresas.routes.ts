import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import { attachCurrentUser, requireRole } from "../middlewares/auth";
import { requireEmpresa } from "../middlewares/empresa";
import { formatarErroZod } from "../utils/zod";

const identificacao = z.string().regex(/^\d{11}(\d{3})?$/);
const empresaSchema = z.object({ nome: z.string().trim().min(2).max(200), cnpj: identificacao.nullable().optional() }).strict();
const router = Router();
router.use(attachCurrentUser);

async function findCompanyConflict(userId: string | undefined, nome: string, cnpj: string | null | undefined, ignoredId?: string) {
    const result = await pool.query<{ nome: string; cnpj: string | null }>(
        `SELECT e.nome, e.cnpj FROM empresas e JOIN users_empresas ue ON ue.empresa_id = e.id
         WHERE ue.user_id = $1 AND ($2::uuid IS NULL OR e.id <> $2)
         AND (LOWER(e.nome) = LOWER($3) OR ($4::text IS NOT NULL AND e.cnpj = $4)) LIMIT 1`,
        [userId, ignoredId ?? null, nome, cnpj ?? null],
    );
    return result.rows[0] ?? null;
}
function conflictMessage(conflict: { nome: string }, nome: string) {
    return conflict.nome.toLowerCase() === nome.toLowerCase() ? "Você já possui uma empresa com este nome" : "Você já possui uma empresa com este CPF/CNPJ";
}

router.get("/", async (req: Request, res: Response) => {
    try {
        const result = await pool.query(
            `SELECT e.id, e.nome, e.cnpj, e.ativo, ue.perfil, e.licenca_expira_em, CASE WHEN e.licenca_expira_em > CURRENT_TIMESTAMP THEN 'ativa' ELSE 'vencida' END AS licenca_status FROM empresas e
             JOIN users_empresas ue ON ue.empresa_id = e.id WHERE ue.user_id = $1 AND e.ativo = TRUE ORDER BY e.nome`,
            [req.currentUser?.id],
        );
        return res.status(200).json({ data: result.rows });
    } catch { return res.status(500).json({ message: "Erro ao listar empresas" }); }
});

router.post("/", requireRole("admin"), async (req: Request, res: Response) => {
    const parsed = empresaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const conflict = await findCompanyConflict(req.currentUser?.id, parsed.data.nome, parsed.data.cnpj);
        if (conflict) { await client.query("ROLLBACK"); return res.status(409).json({ message: conflictMessage(conflict, parsed.data.nome) }); }
        const created = await client.query<{ id: string }>("INSERT INTO empresas (nome, cnpj) VALUES ($1, $2) RETURNING id", [parsed.data.nome, parsed.data.cnpj ?? null]);
        await client.query("INSERT INTO users_empresas (user_id, empresa_id, perfil) VALUES ($1, $2, 'admin')", [req.currentUser?.id, created.rows[0].id]);
        await client.query("COMMIT");
        return res.status(201).json({ id: created.rows[0].id });
    } catch (error: unknown) {
        await client.query("ROLLBACK");
        if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return res.status(409).json({ message: "CPF/CNPJ já cadastrado" });
        return res.status(500).json({ message: "Erro ao criar empresa" });
    } finally { client.release(); }
});

router.patch("/:empresaId", requireEmpresa, async (req: Request, res: Response) => {
    const empresaId = z.string().uuid().safeParse(req.params.empresaId);
    const parsed = empresaSchema.safeParse(req.body);
    if (!empresaId.success) return res.status(400).json({ message: "ID de empresa inválido" });
    if (req.empresaId !== empresaId.data) return res.status(403).json({ message: "A empresa da requisição não corresponde à empresa selecionada" });
    if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));
    const cnpjRequested = Object.prototype.hasOwnProperty.call(req.body, "cnpj");
    const globalAdmin = req.currentUser?.role === "admin";
    if (!globalAdmin && cnpjRequested) return res.status(403).json({ message: "Somente administradores podem alterar CPF/CNPJ" });
    try {
        const access = await pool.query("SELECT 1 FROM users_empresas WHERE user_id = $1 AND empresa_id = $2", [req.currentUser?.id, empresaId.data]);
        if (!access.rowCount) return res.status(403).json({ message: "Você não tem acesso a esta empresa" });
        if (globalAdmin && cnpjRequested) {
            const conflict = await findCompanyConflict(req.currentUser?.id, parsed.data.nome, parsed.data.cnpj, empresaId.data);
            if (conflict) return res.status(409).json({ message: conflictMessage(conflict, parsed.data.nome) });
        }
        const result = globalAdmin && cnpjRequested
            ? await pool.query("UPDATE empresas SET nome = $1, cnpj = $2 WHERE id = $3 RETURNING id", [parsed.data.nome, parsed.data.cnpj ?? null, empresaId.data])
            : await pool.query("UPDATE empresas SET nome = $1 WHERE id = $2 RETURNING id", [parsed.data.nome, empresaId.data]);
        if (!result.rowCount) return res.status(404).json({ message: "Empresa não encontrada" });
        return res.status(200).json({ id: result.rows[0].id });
    } catch (error: unknown) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return res.status(409).json({ message: "CPF/CNPJ já cadastrado" });
        return res.status(500).json({ message: "Erro ao atualizar empresa" });
    }
});

export default router;
