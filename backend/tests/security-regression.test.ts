import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import express, { type Request, type Response, type NextFunction } from "express";
import { hashPassword } from "../src/utils/passwords";
import { pool } from "../src/db";
import empresaRoutes from "../src/empresas/empresas.routes";
import adminRoutes from "../src/admin/admin.routes";
import authRoutes from "../src/auth/auth.routes";
import { createSettlement, SettlementError } from "../src/lancamentos/settlement.service";

const activeCompany = "11111111-1111-4111-8111-111111111111";
const expiredCompany = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const adminId = "44444444-4444-4444-8444-444444444444";
let updates = 0;
const originalQuery = pool.query.bind(pool);
const originalConnect = pool.connect.bind(pool);
let passwordHash = "";

(pool as unknown as { query: typeof pool.query }).query = (async (sql: string, values?: unknown[]) => {
    if (sql.includes("FROM users_empresas ue")) return { rows: [{ licenca_expira_em: new Date("2099-01-01") }], rowCount: 1 };
    if (sql.includes("from users") || sql.includes("FROM users")) {
        const id = values?.[0];
        if (id === userId) return { rows: [{ id: userId, nome: "Comum", email: "comum@test", role: "comum", ativo: true }], rowCount: 1 };
        if (id === adminId) return { rows: [{ id: adminId, nome: "Admin", email: "admin@test", role: "admin", ativo: true }], rowCount: 1 };
        const email = values?.[0];
        if (email === "ativo@test") return { rows: [{ id: userId, nome: "Ativo", email, password_hash: passwordHash, role: "comum", ativo: true }], rowCount: 1 };
        if (email === "inativo@test") return { rows: [{ id: userId, nome: "Inativo", email, password_hash: passwordHash, role: "comum", ativo: false }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
    }
    if (sql.includes("FROM users_empresas ue")) return { rows: [{ licenca_expira_em: new Date("2099-01-01") }], rowCount: 1 };
    if (sql.includes("SELECT 1 FROM users_empresas")) return { rows: [{ ok: 1 }], rowCount: 1 };
    if (sql.includes("UPDATE empresas")) { updates++; return { rows: [{ id: activeCompany }], rowCount: 1 }; }
    if (sql.includes("INSERT INTO users_empresas")) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
}) as typeof pool.query;

const app = express();
app.use(express.json());
app.use((req: Request, _res: Response, next: NextFunction) => { const id = req.header("x-test-user"); req.session = { user: id ? { id } : undefined, regenerate: (done) => done(null), save: (done) => done(null) } as never; next(); });
app.use("/empresas", empresaRoutes); app.use("/admin", adminRoutes); app.use("/auth", authRoutes);
let server: http.Server; let base = "";
before(async () => { passwordHash = await hashPassword("senha-correta"); server = app.listen(0); await new Promise<void>((resolve) => server.on("listening", resolve)); const address = server.address() as { port: number }; base = `http://127.0.0.1:${address.port}`; });
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); (pool as unknown as { query: typeof pool.query }).query = originalQuery; (pool as unknown as { connect: typeof pool.connect }).connect = originalConnect; });
async function request(path: string, options: RequestInit = {}) { const response = await fetch(base + path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } }); return { response, body: await response.json().catch(() => null) }; }

test("bloqueia uso de empresa ativa no cabeçalho para editar outra empresa", async () => { updates = 0; const { response } = await request(`/empresas/${expiredCompany}`, { method: "PATCH", headers: { "x-test-user": userId, "x-empresa-id": activeCompany }, body: JSON.stringify({ nome: "Tentativa" }) }); assert.equal(response.status, 403); assert.equal(updates, 0); });
test("permite editar a empresa selecionada", async () => { const { response } = await request(`/empresas/${activeCompany}`, { method: "PATCH", headers: { "x-test-user": userId, "x-empresa-id": activeCompany }, body: JSON.stringify({ nome: "Permitida" }) }); assert.equal(response.status, 200); assert.equal(updates, 1); });
test("vínculos só podem ser gerenciados pelo fluxo administrativo global", async () => { const denied = await request(`/empresas/${activeCompany}/usuarios`, { method: "POST", headers: { "x-test-user": userId, "x-empresa-id": activeCompany }, body: JSON.stringify({}) }); assert.equal(denied.response.status, 404); const allowed = await request(`/admin/companies/${activeCompany}/users`, { method: "POST", headers: { "x-test-user": adminId }, body: JSON.stringify({ userId, perfil: "comum" }) }); assert.equal(allowed.response.status, 201); });
test("login não revela usuário inexistente, senha inválida ou conta inativa", async () => { const cases = [["ausente@test", "qualquer"], ["ativo@test", "errada"], ["inativo@test", "senha-correta"]]; const answers = await Promise.all(cases.map(([email, password]) => request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }))); for (const answer of answers) { assert.equal(answer.response.status, 401); assert.deepEqual(answer.body, { message: "Credenciais inválidas" }); } });
test("serviço compartilhado recusa valor acima do saldo e tipo incompatível", async () => { const client = { query: async (sql: string) => { if (sql.includes("FROM lancamentos")) return { rows: [{ valor: "100.00", tipo: "receber", status: "pendente" }], rowCount: 1 }; return { rows: [{ total: "0" }], rowCount: 1 }; } } as never; await assert.rejects(() => createSettlement(client, activeCompany, "movimentacoes", { lancamentoId: activeCompany, formaPagamentoId: activeCompany, valor: 101 }), SettlementError); });


