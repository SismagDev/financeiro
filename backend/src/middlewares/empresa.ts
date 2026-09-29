import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db";

declare global {
    namespace Express {
        interface Request {
            empresaId?: string;
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
        const membership = await pool.query(
            `SELECT 1 FROM users_empresas ue
             JOIN empresas e ON e.id = ue.empresa_id
             JOIN users u ON u.id = ue.user_id
             WHERE ue.user_id = $1 AND ue.empresa_id = $2 AND e.ativo = TRUE AND u.ativo = TRUE LIMIT 1`,
            [userId, parsed.data],
        );

        if (membership.rowCount === 0) {
            res.status(403).json({ message: "Você não tem acesso a esta empresa" });
            return;
        }

        req.empresaId = parsed.data;
        next();
    } catch {
        res.status(500).json({ message: "Erro ao validar acesso à empresa" });
    }
}
