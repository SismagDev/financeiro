import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import { attachCurrentUser, requireRole } from "../middlewares/auth";
import { requireEmpresa } from "../middlewares/empresa";
import {
    createResourceRouter,
    filterText,
    optionalDate,
    optionalMoney,
    optionalText,
    strictObject,
    text,
    uuidField,
} from "../resources/resource";
import { formatarErroZod } from "../utils/zod";
import { createSettlement, SettlementError } from "./settlement.service";

import { createLaunches } from "./lancamentos.service";

const competencia = z.string().date()
    .refine(value => value.endsWith("-01"), "A competência deve ser o primeiro dia do mês")
    .transform(value => value + "T00:00:00Z");

const tipo = z.enum(["pagar", "receber"]);
const status = z.enum(["pendente", "parcial", "pago", "cancelado"]);
const data = z.string().date();
const valor = z.coerce.number().positive();
const schema = {
    table: "lancamentos",
    fields: [
        "descricao",
        "valor",
        "tipo",
        "status",
        "data_vencimento",
        "competencia",
        "plano_conta_id",
        "pessoa_id",
        "banco_id",
        "grupo_parcelamento_id",
        "numero_parcela",
        "total_parcelas",
    ],
    searchFields: ["descricao"],
    create: z.object({
        descricao: text(),
        valor,
        tipo,
        status: status.optional(),
        data_vencimento: data,
        competencia: competencia.optional(),
        plano_conta_id: z.string().uuid().nullable().optional(),
        pessoa_id: uuidField,
        banco_id: uuidField,
    }).strict(),
    patch: strictObject({
        descricao: optionalText(),
        valor: optionalMoney,
        tipo: tipo.optional(),
        data_vencimento: optionalDate,
        competencia: competencia.optional(),
        plano_conta_id: z.string().uuid().nullable().optional(),
        pessoa_id: z.string().uuid().nullable().optional(),
        banco_id: uuidField,
    }),
    filter: strictObject({
        descricao: filterText(),
        tipo: tipo.optional(),
        status: status.optional(),
        data_vencimento: optionalDate,
        pessoa_id: uuidField,
        banco_id: uuidField,
        grupo_parcelamento_id: uuidField,
    }),
    relations: { pessoa_id: "pessoas", banco_id: "bancos", plano_conta_id: "planos_contas" },
};

const router = Router();
router.use(attachCurrentUser, requireEmpresa);
const writeAccess = requireRole("admin", "contador", "comum");


const createSchema = schema.create.extend({ forma_pagamento_id: z.string().uuid().optional() });
const installmentSchema = createSchema.extend({
    pessoa_id: z.string().uuid().nullable().optional(),
    banco_id: z.string().uuid().nullable().optional(),
    parcelas: z.coerce.number().int().min(2).max(60),
    modo_valor: z.enum(["total", "parcela"]).default("total"),
    intervalos: z.array(z.coerce.number().int().positive()).max(60).optional(),
});
for (const [path, validator] of [["/", createSchema], ["/parcelado", installmentSchema]] as const) {
    router.post(path, writeAccess, async (req: Request, res: Response) => {
        const body = validator.safeParse(req.body);
        if (!body.success) return res.status(400).json(formatarErroZod(body.error));
        try {
            return res.status(201).json(await createLaunches(req.empresaId!, body.data));
        } catch (error) {
            if (error instanceof SettlementError) return res.status(error.status).json({ message: error.message });
            return res.status(400).json({ message: "Não foi possível cadastrar o lançamento" });
        }
    });
}

router.post("/:id/baixar", writeAccess, async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const body = z.object({ forma_pagamento_id: z.string().uuid(), valor: z.coerce.number().positive(), data: data.optional() }).strict().safeParse(req.body);
    if (!id.success) return res.status(400).json({ message: "ID inválido" });
    if (!body.success) return res.status(400).json(formatarErroZod(body.error));

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const table = "movimentacoes" as const;
        const receiving = await client.query<{ tipo: "pagar" | "receber" }>(
            "SELECT tipo FROM lancamentos WHERE empresa_id = $1 AND id = $2",
            [req.empresaId, id.data],
        );
        const settlementTable = receiving.rows[0]?.tipo === "receber" ? "recebimentos" : table;
        const settlement = await createSettlement(client, req.empresaId!, settlementTable, {
            lancamentoId: id.data,
            formaPagamentoId: body.data.forma_pagamento_id,
            valor: body.data.valor,
            data: body.data.data,
        });
        await client.query("COMMIT");
        return res.status(201).json({ id: id.data, status: settlement.status, saldo: settlement.saldo });
    } catch (error) {
        await client.query("ROLLBACK");
        if (error instanceof SettlementError) return res.status(error.status).json({ message: error.message });
        return res.status(400).json({ message: "Não foi possível dar baixa no lançamento" });
    } finally { client.release(); }
});
router.use(createResourceRouter(schema, false));

export default router;
