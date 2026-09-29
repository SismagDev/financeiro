export const AUTH_COOKIE_NAME = "sid";

export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias


export const AUTH_MESSAGES = {
    UNAUTHORIZED: "Não autenticado",
    FORBIDDEN: "Sem permissão",
    INVALID_CREDENTIALS: "Credenciais inválidas",
    USERNAME_MISSING: "O nome do usuário é obrigatório",
    EMAIL_ALREADY_EXISTS: "Email já cadastrado",
    EMAIL_AND_PASSWORD_REQUIRED: "Email e senha são obrigatórios",
    PASSWORD_TOO_SHORT: "Senha muito curta",
    LOGIN_SUCCESS: "Login realizado",
    LOGOUT_SUCCESS: "Logout realizado",
    REGISTER_SUCCESS: "Usuário criado",
    INTERNAL_ERROR: "Erro interno",
    USER_INACTIVE: "Usuário inativo. Entre em contato com a coordenação",
} as const;
