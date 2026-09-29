import { randomUUID } from "node:crypto";
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
        "pessoa_id",
        "banco_id",
        "grupo_parcelamento_id",
        "numero_parcela",
        "total_parcelas",
    ],
    searchFields: ["descricao"],
    create: strictObject({
        descricao: text(),
        valor,
        tipo,
        status: status.optional(),
        data_vencimento: data,
        pessoa_id: uuidField,
        banco_id: uuidField,
    }),
    patch: strictObject({
        descricao: optionalText(),
        valor: optionalMoney,
        tipo: tipo.optional(),
        data_vencimento: optionalDate,
        pessoa_id: uuidField,
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
    relations: { pessoa_id: "pessoas", banco_id: "bancos" },
};

const router = Router();
router.use(attachCurrentUser, requireEmpresa);
const writeAccess = requireRole("admin", "contador", "comum");

router.post("/parcelado", writeAccess, async (req: Request, res: Response) => {
    const body = z
        .object({
            descricao: text(),
            valor,
            tipo,
            data_vencimento: data,
            pessoa_id: z.string().uuid().nullable().optional(),
            banco_id: z.string().uuid().nullable().optional(),
            parcelas: z.coerce.number().int().min(2).max(60),
            modo_valor: z.enum(["total", "parcela"]).default("total"),
            intervalos: z.array(z.coerce.number().int().positive()).max(60).optional(),
        })
        .strict()
        .safeParse(req.body);
    if (!body.success) return res.status(400).json(formatarErroZod(body.error));

    const client = await pool.connect();
    try {
        const {
            descricao,
            valor: valorInformado,
            tipo: tipoLancamento,
            data_vencimento,
            pessoa_id,
            banco_id,
            parcelas,
            modo_valor,
            intervalos,
        } = body.data;
        if (intervalos && intervalos.length !== parcelas)
            return res.status(400).json({ message: "Informe um vencimento em dias para cada parcela" });
        const total =
            modo_valor === "parcela" ? Math.round(valorInformado * parcelas * 100) / 100 : valorInformado;
        if (pessoa_id) {
            const person = await pool.query("SELECT 1 FROM pessoas WHERE empresa_id = $1 AND id = $2", [
                req.empresaId,
                pessoa_id,
            ]);
            if (!person.rowCount) return res.status(400).json({ message: "Pessoa não encontrada" });
        }
        if (banco_id) {
            const related = await pool.query("SELECT 1 FROM bancos WHERE empresa_id = $1 AND id = $2", [
                req.empresaId,
                banco_id,
            ]);
            if (!related.rowCount) return res.status(400).json({ message: "Instituição não encontrada" });
        }
        const totalCentavos = Math.round(total * 100);
        const base = Math.floor(totalCentavos / parcelas);
        if (base < 1)
            return res.status(400).json({ message: "O valor é muito baixo para esse número de parcelas" });
        await client.query("BEGIN");
        const grupoId = randomUUID();
        const [ano, mes, dia] = data_vencimento.split("-").map(Number);
        const dataBase = new Date(Date.UTC(ano, mes - 1, dia));
        const ids: string[] = [];
        for (let index = 0; index < parcelas; index++) {
            const diasAteVencimento = intervalos ? intervalos[index] : index * 30;
            const due = new Date(dataBase);
            due.setUTCDate(due.getUTCDate() + diasAteVencimento);
            const vencimento = due.toISOString().slice(0, 10);
            const valorParcela = (base + (index < totalCentavos % parcelas ? 1 : 0)) / 100;
            const result = await client.query<{ id: string }>(
                `INSERT INTO lancamentos
                    (empresa_id, descricao, valor, tipo, data_vencimento, pessoa_id, banco_id, grupo_parcelamento_id, numero_parcela, total_parcelas)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
                [
                    req.empresaId,
                    descricao,
                    valorParcela.toFixed(2),
                    tipoLancamento,
                    vencimento,
                    pessoa_id ?? null,
                    banco_id ?? null,
                    grupoId,
                    index + 1,
                    parcelas,
                ],
            );
            ids.push(result.rows[0].id);
        }
        await client.query("COMMIT");
        return res.status(201).json({ grupo_parcelamento_id: grupoId, parcelas: ids.length, ids });
    } catch {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Não foi possível criar as parcelas" });
    } finally {
        client.release();
    }
});

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
