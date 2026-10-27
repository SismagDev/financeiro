export type Row = Record<string, string | number | boolean | null | undefined>
export type ListMeta = { total: number; pagina: number; paginas: number; pagar?: number; receber?: number; movimento?: number; sem_vinculo?: number }
export type OptionLoader = (source: string, query: string, page: number) => Promise<{ options: [string, string][]; hasMore: boolean }>
export type Company = { id: string; nome: string; identificador?: string | null; cnpj?: string; perfil: string; licenca_expira_em?: string | null; licenca_status?: "ativa" | "vencida" }
export type User = { id: string; nome?: string; email: string; role: string }
export type Field = { name: string; label: string; type?: string; required?: boolean; options?: [string, string][]; source?: string; wide?: boolean; maxLength?: number }
export type Resource = { key: string; title: string; endpoint: string; singular: string; icon: string; fields: Field[]; columns: [string, string][] }
