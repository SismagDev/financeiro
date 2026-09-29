import type { Request, Response } from "express";
import { AUTH_MESSAGES, AUTH_COOKIE_NAME } from "./auth.constants";
import {
    authenticateUserService,
    createUserService,
    deleteUserService,
    findUserByIdService,
    updateUserService,
    destroyUserSessions,
} from "./auth.service";
import { userRoles } from "./auth.types";
import z from "zod";
import { hashPassword } from "../utils/passwords";
import { gerarMensagemErroController } from "../utils/error";

export async function registerUser(req: Request, res: Response) {
    try {
        const parsed = z
            .object({
                nome: z.string().trim().min(2).max(200),
                email: z.string().trim().email().max(254),
                password: z.string().min(6).max(128),
                role: z.enum(userRoles).optional(),
            })
            .strict()
            .safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ message: "Dados de cadastro inválidos" });
        const { nome, email, password, role } = parsed.data;

        const safeRole = role ? (userRoles.includes(role) ? role : "comum") : "comum";

        if (safeRole !== "comum" && req.currentUser?.role !== "admin") {
            return res.status(403).json({
                message: "O usuário logado não tem permissão de cadastrar coordenadores/administradores",
            });
        }

        const user = await createUserService(nome, email, password, safeRole);

        res.status(201).json({
            message: AUTH_MESSAGES.REGISTER_SUCCESS,
            data: user,
        });
    } catch (error: any) {
        if (error?.code === "23505") {
            return res.status(409).json({ message: AUTH_MESSAGES.EMAIL_ALREADY_EXISTS });
        }

        console.error("registerController error:", error);
        res.status(500).json({ message: AUTH_MESSAGES.INTERNAL_ERROR });
    }
}

export async function update(req: Request, res: Response) {
    const idUserAtualizar = req.params.id;
    if (!idUserAtualizar || typeof idUserAtualizar !== "string" || idUserAtualizar === "undefined") {
        return res.status(400).json({ message: "O ID do usuário não foi informado" });
    }

    const usuarioLogado = req.currentUser;

    const usuarioAtualizar = await findUserByIdService(idUserAtualizar);
    // se usuário não existe, retorna 404
    if (!usuarioAtualizar) return res.status(400).json({ message: "Usuário não existe" });

    if (usuarioLogado?.role !== "admin" && usuarioLogado?.id !== usuarioAtualizar.id) {
        return res
            .status(403)
            .json({ message: "O usuário logado não tem permissão para atualizar este usuário" });
    }

    const PatchUsuarioSchema = z
        .object({
            email: z
                .string()
                .trim()
                .min(1, "email não pode ser vazio")
                .max(254, "email muito grande")
                .optional(),

            email_novo: z
                .string()
                .trim()
                .min(1, "email não pode ser vazio")
                .max(254, "email muito grande")
                .optional(),

            nome: z
                .string()
                .trim()
                .min(1, "nome não pode ser vazio")
                .max(254, "nome muito grande")
                .optional(),

            senha: z.string().optional(),

            senha_nova: z
                .string()
                .trim()
                .min(1, "senha não pode ser vazia")
                .max(254, "senha muito grande")
                .optional(),
        })
        .strict()
        .refine(
            (data) =>
                data.email_novo !== undefined || data.nome !== undefined || data.senha_nova !== undefined,
            {
                message: "nenhum campo para atualizar foi enviado",
            },
        )
        .refine((data) => !(data.senha_nova !== undefined && data.senha === undefined), {
            message: "senha é obrigatória ao alterar a senha",
            path: ["senha"],
        })
        .refine((data) => !(!data.senha && (data.email_novo || data.senha_nova)), {
            message: "senha é obrigatória ao alterar a email/senha",
            path: ["senha"],
        });

    const parsed = PatchUsuarioSchema.safeParse(req.body);

    if (!parsed.success) {
        const errors = parsed.error.flatten();

        return res.status(400).json({
            message: "invalid_body",
            path: errors.fieldErrors,
            formErrors: errors.formErrors,
        });
    }

    const data = parsed.data;

    try {
        // autentica usuário se informou senha ou se deve editar email novo ou senha nova
        const precisaSenha = data.email_novo !== undefined || data.senha_nova !== undefined;

        if (precisaSenha) {
            if (usuarioLogado?.id !== idUserAtualizar && usuarioLogado?.role !== "admin") {
                return res.status(403).json({ message: "Sem permissão para atualizar este usuário" });
            }

            if (!data.email) {
                return res.status(400).json({
                    message: "email obrigatório",
                });
            }

            if (!data.senha) {
                return res.status(400).json({
                    message: "senha obrigatória",
                });
            }

            const user = await authenticateUserService(data.email, data.senha, true);

            if (typeof user === "string") {
                return res.status(401).json({
                    message: user,
                });
            }
        }

        // monta dados que realmente vão para o banco
        const updateData: {
            email?: string;
            nome?: string;
            password_hash?: string;
        } = {};

        if (data.email_novo) {
            updateData.email = data.email_novo;
        }

        if (data.nome) {
            updateData.nome = data.nome;
        }

        if (data.senha_nova) {
            updateData.password_hash = await hashPassword(data.senha_nova);
        }

        const result = await updateUserService(idUserAtualizar, updateData);

        // Remove user do cache
        if (data.senha_nova) await destroyUserSessions(idUserAtualizar);

        return res.status(200).json({
            message: "user_updated",
            data: result,
        });
    } catch (e: unknown) {
        return res.status(500).json({
            message: gerarMensagemErroController(e, "Erro interno ao atualizar usuário. Tente novamente"),
        });
    }
}

export async function login(req: Request, res: Response) {
    const { email, password } = req.body;

    if (!email || !password) {
        await new Promise((r) => setTimeout(r, 2000)); // aguarda 2 segundos
        return res.status(400).json({ message: AUTH_MESSAGES.EMAIL_AND_PASSWORD_REQUIRED });
    }

    try {
        const user = await authenticateUserService(email, password);

        if (!user || typeof user === "string") {
            await new Promise((r) => setTimeout(r, 1000)); // aguarda 1 segundo
            return res
                .status(401)
                .json({ message: typeof user === "string" ? user : AUTH_MESSAGES.INVALID_CREDENTIALS });
        }

        req.session.regenerate((err: any) => {
            if (err) {
                console.error("session regenerate error:", err);
                return res.status(500).json({ message: AUTH_MESSAGES.INTERNAL_ERROR });
            }

            req.session.user = { id: user.id };

            req.session.save((saveErr: any) => {
                if (saveErr) {
                    console.error("session save error:", saveErr);
                    return res.status(500).json({ message: AUTH_MESSAGES.INTERNAL_ERROR });
                }

                res.json({
                    message: AUTH_MESSAGES.LOGIN_SUCCESS,
                    data: user,
                });
            });
        });
    } catch (error) {
        console.error("loginController error:", error);
        res.status(500).json({ message: AUTH_MESSAGES.INTERNAL_ERROR });
    }
}

export function logout(req: Request, res: Response): void {
    try {
        req.session.destroy((err: any) => {
            if (err) {
                console.error("logoutController error:", err);
                return res.status(500).json({ message: AUTH_MESSAGES.INTERNAL_ERROR });
            }

            res.clearCookie(AUTH_COOKIE_NAME, {
                httpOnly: true,
                secure: true,
                sameSite: "lax",
            });

            res.json({ message: AUTH_MESSAGES.LOGOUT_SUCCESS });
        });
    } catch (e: unknown) {
        res.status(500).json({
            message: gerarMensagemErroController(e, AUTH_MESSAGES.INTERNAL_ERROR),
        });

        return;
    }
}

export async function me(req: Request, res: Response): Promise<void> {
    try {
        if (!req.session.user?.id) {
            res.status(401).json({ message: AUTH_MESSAGES.UNAUTHORIZED });
            return;
        }

        const user = await findUserByIdService(req.session.user.id);

        if (!user) {
            res.status(401).json({ message: AUTH_MESSAGES.UNAUTHORIZED });
            return;
        }

        if (!user.ativo) {
            res.status(403).json({ message: AUTH_MESSAGES.USER_INACTIVE });
            return;
        }

        res.json({ data: user });
    } catch (e: unknown) {
        res.status(500).json({
            message: gerarMensagemErroController(e, AUTH_MESSAGES.INTERNAL_ERROR),
        });

        return;
    }
}

export async function getUser(req: Request, res: Response) {
    const { user_id } = req.params;
    const userId = typeof user_id === "string" ? user_id : "";
    if (!z.string().uuid().safeParse(userId).success) {
        return res.status(400).json({ message: "O ID do usuário não foi informado" });
    }

    try {
        const user = await findUserByIdService(userId);
        return res.status(200).json({ data: user });
    } catch (e) {
        return res
            .status(500)
            .json({ message: gerarMensagemErroController(e, "Erro ao procurar usuário por ID") });
    }
}

export async function deleteUser(req: Request, res: Response) {
    const idUser = req.params.id;
    const userId = typeof idUser === "string" ? idUser : "";

    if (!z.string().uuid().safeParse(userId).success) {
        return res.status(400).json({ message: "O ID do usuário não foi informado" });
    }

    try {
        await deleteUserService(userId);

        // Remove user do cache
        return res.status(200).json({ message: "User deletado com sucesso" });
    } catch (e: unknown) {
        res.status(500).json({
            message: gerarMensagemErroController(e, AUTH_MESSAGES.INTERNAL_ERROR),
        });

        return;
    }
}
