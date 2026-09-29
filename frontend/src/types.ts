export type Row = Record<string, string | number | boolean | null | undefined>
export type Company = { id: string; nome: string; cnpj?: string; perfil: string; licenca_expira_em?: string | null; licenca_status?: "ativa" | "vencida" }
export type User = { id: string; nome?: string; email: string; role: string }
export type Field = { name: string; label: string; type?: string; required?: boolean; options?: [string, string][]; source?: string; wide?: boolean }
export type Resource = { key: string; title: string; endpoint: string; singular: string; icon: string; fields: Field[]; columns: [string, string][] }
