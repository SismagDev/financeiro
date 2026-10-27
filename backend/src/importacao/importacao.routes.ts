import { Router } from "express";
import { z } from "zod";
import { attachCurrentUser, requireRole } from "../middlewares/auth";
import { requireEmpresa } from "../middlewares/empresa";
import { SettlementError } from "../lancamentos/settlement.service";
import { formatarErroZod } from "../utils/zod";
import { importSchema } from "./importacao.plan";
import { importAccess } from "./importacao.service";

const router = Router();
router.use(attachCurrentUser, requireRole("admin"), requireEmpresa);
router.post("/access", async (req, res) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(formatarErroZod(parsed.error));
    if (parsed.data.filiais["1"] !== req.empresaId)
        return res.status(400).json({ message: "x-empresa-id deve corresponder ao UUID da filial 1" });
    try { return res.status(parsed.data.simular ? 200 : 201).json(await importAccess(req.currentUser!.id, parsed.data)); }
    catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json(formatarErroZod(error));
        if (error instanceof SettlementError) return res.status(error.status).json({ message: error.message });
        console.error("Erro ao importar Access:", error instanceof Error ? error.message : error);
        return res.status(500).json({ message: "Não foi possível importar os dados. Nenhum registro desta carga foi gravado" });
    }
});
export default router;
