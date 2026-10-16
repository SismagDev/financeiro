import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { createResourceRouter, filterText, optionalBoolean, strictObject } from "../resources/resource";
import { attachCurrentUser, requireRole } from "../middlewares/auth";
import { requireEmpresa } from "../middlewares/empresa";
import { formatarErroZod } from "../utils/zod";
import { personCreateSchema, personPatchSchema, savePerson } from "./pessoas.service";

const schema = {
    table: "pessoas",
    fields: ["nome", "celular", "documento", "cliente", "fornecedor", "ativo", "observacoes",
        "razao_social", "endereco", "responsavel_nome", "responsavel_cpf"],
    searchFields: ["nome", "celular", "documento"],
    create: personCreateSchema,
    patch: personPatchSchema,
    filter: strictObject({
        nome: filterText(), celular: filterText(50), documento: filterText(50),
        cliente: optionalBoolean, fornecedor: optionalBoolean, ativo: optionalBoolean,
    }),
};
const router = Router();
router.use(attachCurrentUser, requireEmpresa);
const writeAccess = requireRole("admin", "contador", "comum");
async function save(req: Request, res: Response, editing: boolean) {
    const id = editing ? z.string().uuid().safeParse(req.params.id) : null;
    if (id && !id.success) return res.status(400).json({ message: "ID inválido" });
    const body = (editing ? personPatchSchema : personCreateSchema).safeParse(req.body);
    if (!body.success) return res.status(400).json(formatarErroZod(body.error));
    if (editing && !Object.keys(body.data).length) return res.status(400).json({ message: "Nenhum campo para atualização" });
    try {
        const result = await savePerson(req.empresaId!, body.data, id?.success ? id.data : undefined);
        if (!result) return res.status(404).json({ message: "Registro não encontrado" });
        return res.status(editing ? 200 : 201).json(result);
    } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json(formatarErroZod(error));
        return res.status(400).json({ message: "Não foi possível salvar a pessoa" });
    }
}
router.post("/", writeAccess, (req, res) => save(req, res, false));
router.patch("/:id", writeAccess, (req, res) => save(req, res, true));
router.use(createResourceRouter(schema, false));
export default router;
