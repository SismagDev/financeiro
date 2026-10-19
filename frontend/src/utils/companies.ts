import type { Company, Row } from "../types";

export function toggleCompany(ids: string[], id: string): string[] {
    return ids.includes(id) ? ids.length > 1 ? ids.filter(value => value !== id) : ids : [...ids, id];
}

export function companyRows(data: Record<string, Row[]>, ids: string[], filter = ""): Record<string, Row[]> {
    return Object.fromEntries(Object.entries(data).map(([key, rows]) => [key,
        rows.filter(row => ids.includes(String(row.empresa_id)) && (!filter || row.empresa_id === filter)),
    ]));
}

export async function loadCompanyResources(companies: Company[], endpoints: { key: string; endpoint: string }[],
    request: (path: string, options: RequestInit, companyId: string) => Promise<{ data: Row[] }>) {
    const results = await Promise.all(companies.map(async company => {
        const entries = await Promise.all(endpoints.map(async resource => {
            const result = await request(resource.endpoint, {}, company.id);
            return [resource.key, result.data.map(row => ({ ...row, empresa_id: company.id, empresa_identificador: company.identificador ?? null }))] as const;
        }));
        return Object.fromEntries(entries);
    }));
    return Object.fromEntries(endpoints.map(({ key }) => [key, results.flatMap(data => data[key] || [])]));
}
