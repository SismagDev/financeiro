import { hash, verify, argon2id } from "argon2";

export const hashPassword = (async (password: string) =>
    await hash(password, {
        type: argon2id,
        memoryCost: 32768,
        timeCost: 3,
        parallelism: 1,
    })
)

export const verifyPassword = (async (passwordHash: string, password: string) => await verify(passwordHash, password)); 