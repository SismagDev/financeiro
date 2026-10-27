import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db";

declare global {
    namespace Express {
        interface Request {
            empresaId?: string;
            empresaIds?: string[];
        }
    }
}

export async function requireEmpresa(req: Request, res: Response, next: NextFunction): Promise<void> {
    const parsed = z.string().uuid().safeParse(req.header("x-empresa-id"));
    const userId = req.session.user?.id;

    if (!parsed.success) {
        res.status(400).json({ message: "Informe um x-empresa-id válido" });
        return;
    }

    if (!userId) {
        res.status(401).json({ message: "Não autenticado" });
        return;
    }

    try {
        const membership = await pool.query<{ licenca_expira_em: Date | null }>(
            `SELECT e.licenca_expira_em FROM users_empresas ue
             JOIN empresas e ON e.id = ue.empresa_id
             JOIN users u ON u.id = ue.user_id
             WHERE ue.user_id = $1 AND ue.empresa_id = $2 AND e.ativo = TRUE AND u.ativo = TRUE LIMIT 1`,
            [userId, parsed.data],
        );

        if (membership.rowCount === 0) {
            res.status(403).json({ message: "Você não tem acesso a esta empresa" });
            return;
        }

        const expiration = membership.rows[0].licenca_expira_em;
        if (req.currentUser?.role !== "admin" && (!expiration || expiration <= new Date())) {
            res.status(403).json({ message: "A licença desta empresa expirou" });
            return;
        }

        req.empresaId = parsed.data;
        // Escopo coletivo é permitido somente em consultas de coleção; escritas continuam por empresa.
        if (req.method === "GET" && req.path === "/" && req.query.empresas !== undefined) {
            const scope = z.string().transform(value => value.split(",")).pipe(z.array(z.string().uuid()).min(1)).safeParse(req.query.empresas);
            if (!scope.success) { res.status(400).json({ message: "Empresas inválidas" }); return; }
            const ids = [...new Set(scope.data.map(id => id.toLowerCase()))];
            const additionalIds = ids.filter(id => id !== parsed.data.toLowerCase());
            if (!additionalIds.length) { req.empresaIds = ids; next(); return; }
            const access = await pool.query<{ id: string; licenca_expira_em: Date | null }>(
                `SELECT e.id, e.licenca_expira_em FROM empresas e
                 JOIN users_empresas ue ON ue.empresa_id = e.id
                 WHERE ue.user_id = $1 AND e.id = ANY($2::uuid[]) AND e.ativo = TRUE`, [userId, additionalIds]);
            if (access.rows.length !== additionalIds.length || (req.currentUser?.role !== "admin" &&
                access.rows.some(item => !item.licenca_expira_em || item.licenca_expira_em <= new Date()))) {
                res.status(403).json({ message: "Uma das empresas está indisponível ou não pertence ao usuário" }); return;
            }
            req.empresaIds = ids;
        }
        next();
    } catch {
        res.status(500).json({ message: "Erro ao validar acesso à empresa" });
    }
}
