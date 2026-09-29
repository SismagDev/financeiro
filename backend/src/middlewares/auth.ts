import "dotenv/config";
import type { NextFunction, Request, Response } from "express";
import { AUTH_MESSAGES } from "../auth/auth.constants";
import { findUserByIdService } from "../auth/auth.service";
import type { PublicUser, UserRole } from "../auth/auth.types";

declare module "express-session" {
    interface SessionData {
        user?: { id: string };
    }
}

declare global {
    namespace Express {
        interface Request {
            currentUser?: PublicUser;
        }
    }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    if (!req.session.user?.id) {
        res.status(401).json({ message: AUTH_MESSAGES.UNAUTHORIZED });
        return;
    }

    next();
}

export async function attachCurrentUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const userId = req.session.user?.id;

        if (!userId) {
            res.status(401).json({ message: AUTH_MESSAGES.UNAUTHORIZED });
            if (process.env.NODE_ENV === "development") {
                console.log("401: id nao encontrado na sessao");
            }
            return;
        }

        const user = await findUserByIdService(userId);

        if (!user || !user.ativo) {
            res.status(401).json({ message: AUTH_MESSAGES.UNAUTHORIZED });
            if (process.env.NODE_ENV === "development") {
                console.log("401: não encontrou user buscando por id => " + userId);
            }
            return;
        }

        req.currentUser = user;
        next();
    } catch (error) {
        console.error("attachCurrentUser error:", error);
        res.status(500).json({ message: AUTH_MESSAGES.INTERNAL_ERROR });
    }
}

export function requireRole(...roles: UserRole[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const user = req.currentUser;

        if (!user) {
            res.status(401).json({ message: AUTH_MESSAGES.UNAUTHORIZED });
            if (process.env.NODE_ENV === "development") {
                console.log("401: user => " + user);
            }
            return;
        }

        if (!roles.includes(user.role)) {
            res.status(403).json({ message: AUTH_MESSAGES.FORBIDDEN });
            if (process.env.NODE_ENV === "development") {
                console.log("403: roles aceitas => " + roles.join(",") + ". role do user => " + user.role);
            }
            return;
        }

        next();
    };
}
