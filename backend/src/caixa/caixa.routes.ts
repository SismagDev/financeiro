import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import { attachCurrentUser } from "../middlewares/auth";
import { requireEmpresa } from "../middlewares/empresa";

const router = Router();
router.use(attachCurrentUser, requireEmpresa);

router.get("/", async (req: Request, res: Response) => {
    const query = z
        .object({
            de: z.string().date().optional(),
            ate: z.string().date().optional(),
            saldo_inicial: z.coerce.number().finite().default(0),
        })
        .safeParse(req.query);
    if (!query.success) return res.status(400).json({ message: "Filtros de caixa inválidos" });
    if (query.data.de && query.data.ate && query.data.de > query.data.ate) {
        return res.status(400).json({ message: "O período inicial deve ser anterior ao final" });
    }

    try {
        const result = await pool.query<{
            id: string;
            data: string;
            descricao: string;
            tipo: "Entrada" | "Saída";
            categoria: string;
            forma_pagamento: string | null;
            instituicao: string | null;
            valor: string;
        }>(
            `SELECT m.id, COALESCE(m.data_movimentacao, m.created_at::date)::text AS data,
                    l.descricao, 'Saída' AS tipo, l.tipo AS categoria,
                    fp.descricao AS forma_pagamento, b.descricao AS instituicao,
                    (-m.valor)::numeric AS valor
               FROM movimentacoes m
               JOIN lancamentos l ON l.id = m.lancamento_id AND l.empresa_id = m.empresa_id
               LEFT JOIN formas_pagamento fp ON fp.id = m.forma_pagamento_id AND fp.empresa_id = m.empresa_id
               LEFT JOIN bancos b ON b.id = l.banco_id AND b.empresa_id = l.empresa_id
              WHERE m.empresa_id = $1
                AND ($2::date IS NULL OR COALESCE(m.data_movimentacao, m.created_at::date) >= $2::date)
                AND ($3::date IS NULL OR COALESCE(m.data_movimentacao, m.created_at::date) <= $3::date)
             UNION ALL
             SELECT r.id, COALESCE(r.data_recebimento, r.created_at::date)::text AS data,
                    l.descricao, 'Entrada' AS tipo, l.tipo AS categoria,
                    fp.descricao AS forma_pagamento, b.descricao AS instituicao,
                    r.valor::numeric AS valor
               FROM recebimentos r
               JOIN lancamentos l ON l.id = r.lancamento_id AND l.empresa_id = r.empresa_id
               LEFT JOIN formas_pagamento fp ON fp.id = r.forma_pagamento_id AND fp.empresa_id = r.empresa_id
               LEFT JOIN bancos b ON b.id = l.banco_id AND b.empresa_id = l.empresa_id
              WHERE r.empresa_id = $1
                AND ($2::date IS NULL OR COALESCE(r.data_recebimento, r.created_at::date) >= $2::date)
                AND ($3::date IS NULL OR COALESCE(r.data_recebimento, r.created_at::date) <= $3::date)
              ORDER BY data ASC, id ASC`,
            [req.empresaId, query.data.de ?? null, query.data.ate ?? null],
        );

        let saldo = query.data.saldo_inicial;
        const data = result.rows.map((row) => {
            const valor = Number(row.valor);
            const saldoAntes = saldo;
            saldo = Math.round((saldo + valor) * 100) / 100;
            return { ...row, valor, saldo_antes: saldoAntes, saldo_depois: saldo };
        });
        return res.json({ data, saldo_atual: saldo, saldo_inicial: query.data.saldo_inicial });
    } catch (e) {
        return res.status(500).json({ message: "Erro ao calcular o caixa" });
    }
});

export default router;
