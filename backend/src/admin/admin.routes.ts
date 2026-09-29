import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { attachCurrentUser, requireRole } from "../middlewares/auth";
import { formatarErroZod } from "../utils/zod";
import { userRoles } from "../auth/auth.types";
import { createAdminUser, createCompanyForAdmin, deleteAdminUser, linkUserToCompany, listCompaniesForAdmin, listCompanyUsersForAdmin, listUsers, renewCompanyLicense, setCompanyActive, unlinkUserFromCompany, updateAdminUser, updateCompanyForAdmin } from "./admin.service";

const router = Router();
router.use(attachCurrentUser, requireRole("admin"));

const createSchema = z.object({ nome: z.string().trim().min(2).max(200), email: z.string().trim().email().max(254), password: z.string().min(6).max(128), role: z.enum(userRoles).default("comum") }).strict();
const updateSchema = z.object({ nome: z.string().trim().min(2).max(200).optional(), email: z.string().trim().email().max(254).optional(), password: z.string().min(6).max(128).optional(), role: z.enum(userRoles).optional(), ativo: z.boolean().optional() }).strict();

router.get("/users", async (_req: Request, res: Response) => {
    try { return res.json({ data: await listUsers() }); } catch { return res.status(500).json({ message: "Erro ao listar usuários" }); }
});
router.post("/users", async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));
    try { return res.status(201).json({ data: await createAdminUser(parsed.data) }); }
    catch (error: unknown) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return res.status(409).json({ message: "E-mail já cadastrado" });
        return res.status(500).json({ message: "Erro ao criar usuário" });
    }
});
router.patch("/users/:id", async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const parsed = updateSchema.safeParse(req.body);
    if (!id.success) return res.status(400).json({ message: "ID de usuário inválido" });
    if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));
    if (!Object.keys(parsed.data).length) return res.status(400).json({ message: "Nenhum campo para atualizar" });
    if (id.data === req.currentUser?.id && parsed.data.ativo === false) return res.status(409).json({ message: "Não é possível inativar o próprio usuário" });
    try {
        const user = await updateAdminUser(id.data, parsed.data);
        if (!user) return res.status(404).json({ message: "Usuário não encontrado" });
        return res.json({ data: user });
    } catch (error: unknown) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return res.status(409).json({ message: "E-mail já cadastrado" });
        return res.status(500).json({ message: "Erro ao atualizar usuário" });
    }
});
router.delete("/users/:id", async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "ID de usuário inválido" });
    if (id.data === req.currentUser?.id) return res.status(409).json({ message: "Não é possível excluir o próprio usuário" });
    try {
        const deleted = await deleteAdminUser(id.data);
        if (!deleted) return res.status(404).json({ message: "Usuário não encontrado" });
        return res.status(204).send();
    } catch { return res.status(409).json({ message: "Não foi possível excluir o usuário porque ele possui vínculos" }); }
});
const companySchema = z.object({ nome: z.string().trim().min(2).max(200), cnpj: z.string().regex(/^\d{11}(\d{3})?$/).nullable().optional() }).strict();
router.post("/companies", async (req: Request, res: Response) => {
    const parsed = companySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));
    try { return res.status(201).json({ data: await createCompanyForAdmin(parsed.data, req.currentUser!.id) }); }
    catch (error: unknown) { if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return res.status(409).json({ message: "CPF/CNPJ já cadastrado" }); return res.status(500).json({ message: "Erro ao criar empresa" }); }
});
router.patch("/companies/:id", async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id); const parsed = companySchema.safeParse(req.body);
    if (!id.success) return res.status(400).json({ message: "ID de empresa inválido" });
    if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));
    try { const updated = await updateCompanyForAdmin(id.data, parsed.data); if (!updated) return res.status(404).json({ message: "Empresa não encontrada" }); return res.json({ id: updated }); }
    catch (error: unknown) { if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return res.status(409).json({ message: "CPF/CNPJ já cadastrado" }); return res.status(500).json({ message: "Erro ao atualizar empresa" }); }
});
const companyStatusSchema = z.object({ ativo: z.boolean() }).strict();
router.patch("/companies/:id/status", async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id); const parsed = companyStatusSchema.safeParse(req.body);
    if (!id.success) return res.status(400).json({ message: "ID de empresa inválido" });
    if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));
    try { const updated = await setCompanyActive(id.data, parsed.data.ativo); if (!updated) return res.status(404).json({ message: "Empresa não encontrada" }); return res.json({ data: updated }); }
    catch { return res.status(500).json({ message: "Erro ao atualizar empresa" }); }
});
const licenseSchema = z.object({ licenca_expira_em: z.string().date() }).strict();
router.patch("/companies/:id/license", async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const parsed = licenseSchema.safeParse(req.body);
    if (!id.success) return res.status(400).json({ message: "ID de empresa inválido" });
    if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));
    const expiration = new Date(`${parsed.data.licenca_expira_em}T23:59:59.999Z`);
    try {
        const updated = await renewCompanyLicense(id.data, expiration);
        if (!updated) return res.status(404).json({ message: "Empresa não encontrada" });
        return res.json({ data: updated });
    } catch { return res.status(500).json({ message: "Erro ao renovar licença" }); }
});
router.post("/companies/:id/users", async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id); const body = z.object({ userId: z.string().uuid(), perfil: z.enum(["admin", "contador", "comum"]).default("comum") }).strict().safeParse(req.body);
    if (!id.success) return res.status(400).json({ message: "ID de empresa inválido" }); if (!body.success) return res.status(400).json(formatarErroZod(body.error));
    try { await linkUserToCompany(id.data, body.data.userId, body.data.perfil); return res.status(201).send(); } catch { return res.status(500).json({ message: "Erro ao vincular usuário" }); }
});
router.delete("/companies/:id/users/:userId", async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id); const userId = z.string().uuid().safeParse(req.params.userId);
    if (!id.success || !userId.success) return res.status(400).json({ message: "ID inválido" });
    try { const removed = await unlinkUserFromCompany(id.data, userId.data); if (!removed) return res.status(404).json({ message: "Vínculo não encontrado" }); return res.status(204).send(); } catch { return res.status(500).json({ message: "Erro ao remover vínculo" }); }
});
router.get("/companies", async (_req: Request, res: Response) => {
    try { return res.json({ data: await listCompaniesForAdmin() }); } catch { return res.status(500).json({ message: "Erro ao listar empresas" }); }
});
router.get("/companies/:id/users", async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "ID de empresa inválido" });
    try { return res.json({ data: await listCompanyUsersForAdmin(id.data) }); } catch { return res.status(500).json({ message: "Erro ao listar usuários da empresa" }); }
});
export default router;

