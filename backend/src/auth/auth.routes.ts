import { Router } from "express";
import { deleteUser, getUser, login, logout, me, registerUser, update } from "./auth.controller";
import { attachCurrentUser, requireRole } from "../middlewares/auth";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const router = Router();

const loginIpLimiter = rateLimit({
    windowMs: 3 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,

    keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "desconhecido")}`,

    handler: (_req, res) => {
        res.status(429).json({
            message: "Muitas tentativas de login. Tente novamente em 3 minutos",
        });
    },
});

const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? "desconhecido"),
});

router.post("/register", registerLimiter, registerUser);
router.post("/register/admin", attachCurrentUser, requireRole("admin"), registerUser);
router.post("/login", loginIpLimiter, login);
router.post("/logout", attachCurrentUser, logout);
router.patch("/:id", attachCurrentUser, update);
router.get("/me", me);
router.get("/:user_id", attachCurrentUser, requireRole("admin"), getUser);
router.delete("/:id", attachCurrentUser, requireRole("admin"), deleteUser);

export default router;
