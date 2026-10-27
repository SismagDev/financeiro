import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../db";
import { optionalBoolean, text } from "../resources/resource";

const extraFields = {
    razao_social: z.string().trim().max(200).nullable().optional(),
    endereco: z.string().trim().max(500).nullable().optional(),
    responsavel_nome: z.string().trim().max(200).nullable().optional(),
    responsavel_cpf: z.string().trim().transform(value => value.replace(/[.\-\s]/g, ""))
        .refine(value => !value || /^\d{11}$/.test(value), "Informe um CPF com 11 dígitos").nullable().optional(),
    observacoes: z.string().trim().max(5000).nullable().optional(),
};
export const personCreateSchema = z.object({
    nome: text(), celular: z.string().trim().max(50).nullable().optional(),
    documento: z.string().trim().max(50).nullable().optional(),
    cliente: z.boolean().optional(), fornecedor: z.boolean().optional(), ativo: z.boolean().optional(),
    ...extraFields,
}).strict();
export const personPatchSchema = personCreateSchema.partial().extend({
    cliente: optionalBoolean, fornecedor: optionalBoolean, ativo: optionalBoolean,
}).strict();
const rolesSchema = z.object({ cliente: z.boolean(), fornecedor: z.boolean() })
    .refine(person => person.cliente || person.fornecedor, {
        path: ["cliente"], message: "Selecione cliente, fornecedor ou ambos",
    });

type PersonInput = z.infer<typeof personPatchSchema>;
export async function savePerson(empresaId: string, input: PersonInput, id?: string, transactionClient?: PoolClient, importId?: string) {
    const client = transactionClient ?? await pool.connect();
    try {
        if (!transactionClient) await client.query("BEGIN");
        let previous = { cliente: false, fornecedor: false };
        if (id) {
            const existing = await client.query<{ cliente: boolean | null; fornecedor: boolean | null }>(
                "SELECT cliente, fornecedor FROM pessoas WHERE empresa_id = $1 AND id = $2 FOR UPDATE", [empresaId, id]);
            if (!existing.rowCount) { if (!transactionClient) await client.query("ROLLBACK"); return null; }
            previous = { cliente: Boolean(existing.rows[0]!.cliente), fornecedor: Boolean(existing.rows[0]!.fornecedor) };
        }
        // Valida o estado final sob bloqueio, sem perder os vínculos omitidos no PATCH.
        const roles = rolesSchema.parse({ cliente: input.cliente ?? previous.cliente, fornecedor: input.fornecedor ?? previous.fornecedor });
        const entries = Object.entries(id ? input : { ...input, ...roles, ...(importId ? { id: importId } : {}) }).filter(([, value]) => value !== undefined);
        const values: unknown[] = entries.map(([, value]) => value);
        let result;
        if (id) {
            const assignments = entries.map(([field], index) => field + " = $" + (index + 1));
            values.push(empresaId, id);
            result = await client.query<{ id: string }>(
                "UPDATE pessoas SET " + assignments.join(", ") + " WHERE empresa_id = $" + (values.length - 1) + " AND id = $" + values.length + " RETURNING id", values);
        } else {
            values.push(empresaId);
            result = await client.query<{ id: string }>(
                "INSERT INTO pessoas (" + [...entries.map(([field]) => field), "empresa_id"].join(", ") + ") VALUES (" + values.map((_, index) => "$" + (index + 1)).join(", ") + ") RETURNING id", values);
        }
        if (!transactionClient) await client.query("COMMIT");
        return { id: result.rows[0]!.id };
    } catch (error) { if (!transactionClient) await client.query("ROLLBACK"); throw error; }
    finally { if (!transactionClient) client.release(); }
}
