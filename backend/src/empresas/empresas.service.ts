import { pool } from "../db";

export async function updateCompanySettings(id: string, settings: { nome: string; cnpj?: string | null; caixa_data_inicio?: string | null }) {
    const values: unknown[] = [settings.nome];
    const fields = ["nome = $1"];
    if (settings.cnpj !== undefined) {
        values.push(settings.cnpj);
        fields.push(`cnpj = $${values.length}`);
    }
    if (settings.caixa_data_inicio !== undefined) {
        values.push(settings.caixa_data_inicio ? `${settings.caixa_data_inicio}T00:00:00Z` : null);
        fields.push(`caixa_data_inicio = $${values.length}::timestamptz`);
    }
    values.push(id);
    return pool.query(`UPDATE empresas SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING id`, values);
}
