import { pool } from "../db";
import { hashPassword, verifyPassword } from "../utils/passwords";
import { AUTH_MESSAGES } from "./auth.constants";
import type { PublicUser, UserRecord } from "./auth.types";

function toPublicUser(user: Pick<UserRecord, "id" | "email" | "nome" | "role" | "ativo">): PublicUser {
    return {
        id: user.id,
        email: user.email,
        nome: user.nome,
        role: user.role,
        ativo: user.ativo,
    };
}

export async function createUserService(
    nome: string,
    email: string,
    password: string,
    role: string,
): Promise<PublicUser> {
    const normalizedEmail = email.toLowerCase().trim();
    const passwordHash = await hashPassword(password);

    const result = await pool.query<Pick<UserRecord, "id" | "email" | "nome" | "role" | "ativo">>(
        `
      insert into users (nome, email, password_hash, role)
      values ($1, $2, $3, $4)
      returning id, nome, email, role, ativo
    `,
        [nome, normalizedEmail, passwordHash, role],
    );

    return toPublicUser(result.rows[0]);
}

export async function authenticateUserService(
    email: string,
    password: string,
    burleAtivo = false,
): Promise<PublicUser | string> {
    const normalizedEmail = email.toLowerCase().trim();

    const result = await pool.query<UserRecord>(
        `
      select id, nome, email, password_hash, role, ativo, created_at
      from users
      where email = $1
      limit 1
    `,
        [normalizedEmail],
    );

    const user = result.rows[0];
    if (!user) return AUTH_MESSAGES.INVALID_CREDENTIALS;

    const ok = await verifyPassword(user.password_hash, password);
    if (!ok) return AUTH_MESSAGES.INVALID_CREDENTIALS;

    if (!user.ativo && !burleAtivo) {
        return AUTH_MESSAGES.USER_INACTIVE;
    }

    return toPublicUser(user);
}

export async function findUserByIdService(id: string): Promise<PublicUser | null> {
    const result = await pool.query<Pick<UserRecord, "id" | "email" | "nome" | "role" | "ativo">>(
        `
      select id, nome, email, role, ativo
      from users
      where id = $1
      limit 1
    `,
        [id],
    );

    const user = result.rows[0];
    if (!user) return null;

    const publicUser = toPublicUser(user);

    return publicUser;
}

export async function destroyUserSessions(id: string) {
    await pool.query("DELETE FROM user_sessions WHERE sess->'user'->>'id' = $1", [id]);
}

export async function deleteUserService(id: string) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        await client.query("DELETE FROM users WHERE id = $1", [id]);

        await client.query("DELETE FROM user_sessions WHERE sess->'user'->>'id' = $1", [id]);

        await client.query("COMMIT");
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

export async function updateUserService(idUser: string, dados: any) {
    // Pode atualizar nomente nome
    const keys = Object.keys(dados);

    if (keys.length === 0) {
        throw new Error("Nenhum campo informado para atualizar.");
    }

    const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(", ");

    const values = Object.values(dados);

    const result = await pool.query<{ id: string }>(
        `
        UPDATE users
        SET ${setClause}
        WHERE id = $${keys.length + 1}
        RETURNING id
        `,
        [...values, idUser],
    );

    return result.rows[0]?.id ?? null;
}
