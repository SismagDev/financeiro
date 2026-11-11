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
let userUpdates = 0;
let companyValues: unknown[] = [];
const originalQuery = pool.query.bind(pool);
const originalConnect = pool.connect.bind(pool);
let passwordHash = "";

(pool as unknown as { query: typeof pool.query }).query = (async (sql: string, values?: unknown[]) => {
    if (sql.includes("FROM users_empresas ue")) {
        if (values?.[1] === "55555555-5555-4555-8555-555555555555") return { rows: [], rowCount: 0 };
        return { rows: [{ licenca_expira_em: new Date("2099-01-01") }], rowCount: 1 };
    }
    if (sql.includes("from users") || sql.includes("FROM users")) {
        const id = values?.[0];
        if (id === userId) return { rows: [{ id: userId, nome: "Comum", email: "comum@test", role: "comum", ativo: true }], rowCount: 1 };
        if (id === adminId) return { rows: [{ id: adminId, nome: "Admin", email: "admin@test", role: "admin", ativo: true }], rowCount: 1 };
        const email = values?.[0];
        if (email === "ativo@test") return { rows: [{ id: userId, nome: "Ativo", email, password_hash: passwordHash, role: "comum", ativo: true }], rowCount: 1 };
        if (email === "inativo@test") return { rows: [{ id: userId, nome: "Inativo", email, password_hash: passwordHash, role: "comum", ativo: false }], rowCount: 1 };
        if (email === "outra@test") return { rows: [{ id: "66666666-6666-4666-8666-666666666666", nome: "Outra pessoa", email, password_hash: passwordHash, role: "comum", ativo: true }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
    }
    if (sql.includes("FROM users_empresas ue")) {
        if (values?.[1] === "55555555-5555-4555-8555-555555555555") return { rows: [], rowCount: 0 };
        return { rows: [{ licenca_expira_em: new Date("2099-01-01") }], rowCount: 1 };
    }
    if (sql.includes("SELECT 1 FROM users_empresas")) return { rows: [{ ok: 1 }], rowCount: 1 };
    if (sql.includes("UPDATE empresas")) { companyValues = values || []; updates++; return { rows: [{ id: activeCompany }], rowCount: 1 }; }
    if (sql.includes("UPDATE users")) { userUpdates++; return { rows: [{ id: userId }], rowCount: 1 }; }
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

test("usuário configura e remove início do caixa; data inválida não grava", async () => {
    const options = { method: "PATCH", headers: { "x-test-user": userId, "x-empresa-id": activeCompany } };
    const saved = await request(`/empresas/${activeCompany}`, { ...options, body: JSON.stringify({ nome: "Empresa", caixa_data_inicio: "2026-01-01" }) });
    assert.equal(saved.response.status, 200);
    assert.deepEqual(companyValues, ["Empresa", "2026-01-01T00:00:00Z", activeCompany]);
    const count = updates;
    const invalid = await request(`/empresas/${activeCompany}`, { ...options, body: JSON.stringify({ nome: "Empresa", caixa_data_inicio: "2026-02-30" }) });
    assert.equal(invalid.response.status, 400); assert.equal(updates, count);
    const cleared = await request(`/empresas/${activeCompany}`, { ...options, body: JSON.stringify({ nome: "Empresa", caixa_data_inicio: null }) });
    assert.equal(cleared.response.status, 200); assert.deepEqual(companyValues, ["Empresa", null, activeCompany]);
    const omitted = await request(`/empresas/${activeCompany}`, { ...options, body: JSON.stringify({ nome: "Empresa" }) });
    assert.equal(omitted.response.status, 200); assert.deepEqual(companyValues, ["Empresa", activeCompany]);
});
test("vínculos só podem ser gerenciados pelo fluxo administrativo global", async () => { const denied = await request(`/empresas/${activeCompany}/usuarios`, { method: "POST", headers: { "x-test-user": userId, "x-empresa-id": activeCompany }, body: JSON.stringify({}) }); assert.equal(denied.response.status, 404); const allowed = await request(`/admin/companies/${activeCompany}/users`, { method: "POST", headers: { "x-test-user": adminId }, body: JSON.stringify({ userId, perfil: "comum" }) }); assert.equal(allowed.response.status, 201); });
test("login não revela usuário inexistente, senha inválida ou conta inativa", async () => { const cases = [["ausente@test", "qualquer"], ["ativo@test", "errada"], ["inativo@test", "senha-correta"]]; const answers = await Promise.all(cases.map(([email, password]) => request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }))); for (const answer of answers) { assert.equal(answer.response.status, 401); assert.deepEqual(answer.body, { message: "Credenciais inválidas" }); } });
test("serviço compartilhado recusa valor acima do saldo e tipo incompatível", async () => { const client = { query: async (sql: string) => { if (sql.includes("FROM lancamentos")) return { rows: [{ valor: "100.00", tipo: "receber", status: "pendente" }], rowCount: 1 }; return { rows: [{ total: "0" }], rowCount: 1 }; } } as never; await assert.rejects(() => createSettlement(client, activeCompany, "movimentacoes", { lancamentoId: activeCompany, formaPagamentoId: activeCompany, valor: 101 }), SettlementError); });



test("administrador aceita identificadores repetidos e nulos e preserva o campo quando omitido", async () => {
    for (const id of [activeCompany, expiredCompany]) {
        const result = await request(`/admin/companies/${id}`, { method: "PATCH", headers: { "x-test-user": adminId }, body: JSON.stringify({ nome: "Empresa", identificador: " F1 " }) });
        assert.equal(result.response.status, 200);
        assert.equal(companyValues[3], true);
        assert.equal(companyValues[4], "F1");
    }
    const cleared = await request(`/admin/companies/${activeCompany}`, { method: "PATCH", headers: { "x-test-user": adminId }, body: JSON.stringify({ nome: "Empresa", identificador: null }) });
    assert.equal(cleared.response.status, 200);
    assert.equal(companyValues[4], null);
    const omitted = await request(`/admin/companies/${activeCompany}`, { method: "PATCH", headers: { "x-test-user": adminId }, body: JSON.stringify({ nome: "Empresa" }) });
    assert.equal(omitted.response.status, 200);
    assert.equal(companyValues[3], false);
});
test("usuário comum não altera identificador pelo cadastro administrativo nem pela edição da empresa", async () => {
    const payload = JSON.stringify({ nome: "Empresa", identificador: "F1" });
    const admin = await request(`/admin/companies/${activeCompany}`, { method: "PATCH", headers: { "x-test-user": userId }, body: payload });
    assert.equal(admin.response.status, 403);
    const regular = await request(`/empresas/${activeCompany}`, { method: "PATCH", headers: { "x-test-user": userId, "x-empresa-id": activeCompany }, body: payload });
    assert.equal(regular.response.status, 400);
});

test("seleção multiempresa não concede acesso a empresa sem vínculo", async () => {
    const id = "55555555-5555-4555-8555-555555555555";
    const before = updates;
    const result = await request(`/empresas/${id}`, { method: "PATCH", headers: { "x-test-user": userId, "x-empresa-id": id }, body: JSON.stringify({ nome: "Sem acesso" }) });
    assert.equal(result.response.status, 403);
    assert.equal(updates, before);
});

test("preferências são gravadas apenas na empresa autorizada e campos omitidos são preservados", async () => {
    const settings = { nome: "Empresa", contas_modo_valor: "parcela", vencimento_dias_urgente: 0, vencimento_dias_atencao: 10, avisar_contas_vencidas: false };
    const options = { method: "PATCH", headers: { "x-test-user": userId, "x-empresa-id": activeCompany }, body: JSON.stringify(settings) };
    assert.equal((await request(`/empresas/${activeCompany}`, options)).response.status, 200);
    assert.deepEqual(companyValues, ["Empresa", "parcela", 0, 10, false, activeCompany]);
    const before = updates;
    assert.equal((await request(`/empresas/${expiredCompany}`, options)).response.status, 403);
    assert.equal(updates, before);
    assert.equal((await request(`/empresas/${activeCompany}`, { ...options, headers: { "x-empresa-id": activeCompany } })).response.status, 401);
    assert.equal(updates, before);
});

test("preferências rejeitam limites incoerentes, tipos inválidos e campos extras sem escrita", async () => {
    const before = updates;
    for (const values of [
        { vencimento_dias_urgente: 7, vencimento_dias_atencao: 7 }, { vencimento_dias_urgente: 8, vencimento_dias_atencao: 2 },
        { vencimento_dias_urgente: -1, vencimento_dias_atencao: 7 }, { vencimento_dias_urgente: 1.5, vencimento_dias_atencao: 7 },
        { vencimento_dias_urgente: 1, vencimento_dias_atencao: 366 }, { vencimento_dias_atencao: 7 },
        { contas_modo_valor: "invalido" }, { avisar_contas_vencidas: "false" }, { perfil: "admin" },
    ]) {
        const result = await request(`/empresas/${activeCompany}`, { method: "PATCH", headers: { "x-test-user": userId, "x-empresa-id": activeCompany }, body: JSON.stringify({ nome: "Empresa", ...values }) });
        assert.equal(result.response.status, 400);
        assert.ok(Array.isArray(result.body.erros));
    }
    assert.equal(updates, before);
});

test("troca de credenciais exige a senha do usuário da sessão, sem aceitar outra conta", async () => {
    const before = userUpdates;
    const denied = await request(`/auth/${userId}`, { method: "PATCH", headers: { "x-test-user": userId }, body: JSON.stringify({ email: "outra@test", senha: "senha-correta", email_novo: "novo@test.com" }) });
    assert.equal(denied.response.status, 401);
    assert.equal(userUpdates, before);
    const allowed = await request(`/auth/${userId}`, { method: "PATCH", headers: { "x-test-user": userId }, body: JSON.stringify({ email: "ativo@test", senha: "senha-correta", email_novo: "novo@test.com" }) });
    assert.equal(allowed.response.status, 200);
    assert.equal(userUpdates, before + 1);
});

test("login valida tipos e tamanho antes de autenticar", async () => {
    for (const body of [{}, { email: {}, password: "senha" }, { email: "ativo@test", password: [] }, { email: "ativo@test", password: "a".repeat(255) }]) {
        const result = await request("/auth/login", { method: "POST", body: JSON.stringify(body) });
        assert.equal(result.response.status, 400);
    }
});
