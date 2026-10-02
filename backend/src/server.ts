import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import session from "express-session";
import connectPgSimple from "connect-pg-simple";

import authRoutes from "./auth/auth.routes";
import empresaRoutes from "./empresas/empresas.routes";
import pessoasRoutes from "./pessoas/pessoas.routes";
import bancosRoutes from "./bancos/bancos.routes";
import formasPagamentoRoutes from "./formas_pagamento/formas_pagamento.routes";
import lancamentosRoutes from "./lancamentos/lancamentos.routes";
import planosContasRoutes from "./planos_contas/planos_contas.routes";
import movimentacoesRoutes from "./movimentacoes/movimentacoes.routes";
import recebimentosRoutes from "./recebimentos/recebimentos.routes";
import caixaRoutes from "./caixa/caixa.routes";
import adminRoutes from "./admin/admin.routes";

import { pool } from "./db";
import { AUTH_COOKIE_NAME, SESSION_MAX_AGE_MS } from "./auth/auth.constants";

const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET deve existir e ter pelo menos 32 caracteres.");
}
const validatedSessionSecret = sessionSecret as string;

const app = express();

async function startServer() {
    const PgSession = connectPgSimple(session);

    app.set("trust proxy", process.env.TRUST_PROXY === "true");

    app.use(
        cors({
            origin: (origin: any, cb: any) => {
                if (!isProduction) {
                    // dev: permite qualquer origem (mas retornando o origin exato, não "*")
                    return cb(null, true);
                }

                // prod: só seu frontend
                return cb(null, origin === process.env.FRONTEND_URL);
            },
            credentials: true,
        }),
    );

    app.use(express.json({ limit: "100kb" }));
    app.use(cookieParser());

    app.use(
        session({
            name: AUTH_COOKIE_NAME,
            store: new PgSession({
                pool,
                tableName: "user_sessions",
                createTableIfMissing: true,
            }),
            secret: validatedSessionSecret,
            resave: false,
            saveUninitialized: false,
            rolling: true,
            cookie: {
                httpOnly: true,
                secure: isProduction,
                sameSite: "lax",
                maxAge: SESSION_MAX_AGE_MS,
            },
        }),
    );

    app.use(
        express.text({
            limit: "50mb",
        }),
    );

    app.use("/auth", authRoutes);
    app.use("/empresas", empresaRoutes);
    app.use("/pessoas", pessoasRoutes);
    app.use("/bancos", bancosRoutes);
    app.use("/formas-pagamento", formasPagamentoRoutes);
    app.use("/lancamentos", lancamentosRoutes);
    app.use("/planos-contas", planosContasRoutes);
    app.use("/lancamento", lancamentosRoutes);
    app.use("/movimentacoes", movimentacoesRoutes);
    app.use("/recebimentos", recebimentosRoutes);
    app.use("/caixa", caixaRoutes);
    app.use("/admin", adminRoutes);

    app.get("/health", (_req, res) => {
        res.status(200).json({ status: "ok" });
    });

    // Warmup banco de dados
    await pool.query("SELECT 1");

    app.listen(Number(port), "0.0.0.0", () => {
        console.log("🔥 Backend rodando na porta " + port + " (0.0.0.0)");
    });
}

startServer();

export default app;