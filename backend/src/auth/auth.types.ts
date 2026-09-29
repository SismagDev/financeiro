export const userRoles = ["admin", "contador", "comum"] as const;
export type UserRole = (typeof userRoles)[number];

export type UserRecord = {
    id: string;
    email: string;
    nome: string;
    password_hash: string;
    role: UserRole;
    ativo: boolean;
    created_at: Date;
};

export type PublicUser = {
    id: string;
    email: string;
    nome?: string;
    role: UserRole;
    ativo?: boolean;
};

