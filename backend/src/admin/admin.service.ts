import { pool } from "../db";
import { hashPassword } from "../utils/passwords";
import type { UserRole } from "../auth/auth.types";

export type AdminUser = { id: string; nome: string; email: string; role: UserRole; ativo: boolean; created_at: Date };

export async function listUsers() {
    const result = await pool.query<AdminUser>("SELECT id, nome, email, role, ativo, created_at FROM users ORDER BY nome");
    return result.rows;
}

export async function createAdminUser(data: { nome: string; email: string; password: string; role: UserRole }) {
    const passwordHash = await hashPassword(data.password);
    const result = await pool.query<AdminUser>(
        "INSERT INTO users (nome, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, nome, email, role, ativo, created_at",
        [data.nome, data.email.toLowerCase().trim(), passwordHash, data.role],
    );
    return result.rows[0];
}

export async function updateAdminUser(id: string, data: { nome?: string; email?: string; password?: string; role?: UserRole; ativo?: boolean }) {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined);
    if (!entries.length) return null;
    const values: unknown[] = [];
    const set: string[] = [];
    for (const [key, value] of entries) {
        const column = key === "password" ? "password_hash" : key;
        const normalized = key === "email" && typeof value === "string" ? value.toLowerCase().trim() : value;
        values.push(key === "password" && typeof normalized === "string" ? await hashPassword(normalized) : normalized);
        set.push(`${column} = $${values.length}`);
    }
    values.push(id);
    const result = await pool.query<AdminUser>(
        `UPDATE users SET ${set.join(", ")} WHERE id = $${values.length} RETURNING id, nome, email, role, ativo, created_at`,
        values,
    );
    if (data.ativo === false || data.password !== undefined) await pool.query("DELETE FROM user_sessions WHERE sess->'user'->>'id' = $1", [id]);
    return result.rows[0] ?? null;
}

export async function deleteAdminUser(id: string) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("DELETE FROM user_sessions WHERE sess->'user'->>'id' = $1", [id]);
        await client.query("DELETE FROM users_empresas WHERE user_id = $1", [id]);
        const result = await client.query("DELETE FROM users WHERE id = $1 RETURNING id", [id]);
        await client.query("COMMIT");
        return result.rows[0]?.id ?? null;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function listCompaniesForAdmin() {
    const result = await pool.query("SELECT id, nome, cnpj, ativo, created_at, licenca_expira_em, CASE WHEN licenca_expira_em > CURRENT_TIMESTAMP THEN 'ativa' ELSE 'vencida' END AS licenca_status FROM empresas ORDER BY nome");
    return result.rows;
}

export async function listCompanyUsersForAdmin(companyId: string) {
    const result = await pool.query<AdminUser>(
        `SELECT u.id, u.nome, u.email, u.role, u.ativo, u.created_at
         FROM users u JOIN users_empresas ue ON ue.user_id = u.id
         WHERE ue.empresa_id = $1 ORDER BY u.nome`,
        [companyId],
    );
    return result.rows;
}
export async function createCompanyForAdmin(data: { nome: string; cnpj?: string | null }, adminId: string) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const created = await client.query<{ id: string }>("INSERT INTO empresas (nome, cnpj) VALUES ($1, $2) RETURNING id", [data.nome, data.cnpj ?? null]);
        await client.query("INSERT INTO users_empresas (user_id, empresa_id, perfil) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING", [adminId, created.rows[0].id]);
        await client.query("COMMIT");
        return created.rows[0];
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function updateCompanyForAdmin(id: string, data: { nome: string; cnpj?: string | null }) {
    const result = await pool.query("UPDATE empresas SET nome = $1, cnpj = $2 WHERE id = $3 RETURNING id", [data.nome, data.cnpj ?? null, id]);
    return result.rows[0]?.id ?? null;
}

export async function linkUserToCompany(companyId: string, userId: string, perfil: string) {
    await pool.query("INSERT INTO users_empresas (user_id, empresa_id, perfil) VALUES ($1, $2, $3) ON CONFLICT (user_id, empresa_id) DO UPDATE SET perfil = EXCLUDED.perfil", [userId, companyId, perfil]);
}

export async function unlinkUserFromCompany(companyId: string, userId: string) {
    const result = await pool.query("DELETE FROM users_empresas WHERE user_id = $1 AND empresa_id = $2 RETURNING user_id", [userId, companyId]);
    return result.rows[0]?.user_id ?? null;
}

export async function renewCompanyLicense(id: string, expiration: Date) {
    const result = await pool.query(
        "UPDATE empresas SET licenca_expira_em = $1 WHERE id = $2 RETURNING id, licenca_expira_em",
        [expiration, id],
    );
    return result.rows[0] ?? null;
}

export async function setCompanyActive(id: string, ativo: boolean) {
    const result = await pool.query("UPDATE empresas SET ativo = $1 WHERE id = $2 RETURNING id, ativo", [ativo, id]);
    return result.rows[0] ?? null;
}
