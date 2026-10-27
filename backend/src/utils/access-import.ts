import { createHash } from "node:crypto";

export function importId(empresaId: string, table: string, code: string): string {
    const bytes = createHash("sha256").update(`financeiro-access-v1:${empresaId.toLowerCase()}:${table}:${code}`).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// IDs reservados permitem reconhecer os cadastros internos sem alterar o schema.
export function historicalRecordId(empresaId: string, table: string): string | undefined {
    return table === "bancos" || table === "formas_pagamento" ? importId(empresaId, table, "baixa-historica") : undefined;
}

export function isHistoricalRecord(empresaId: string, table: string, id: unknown): boolean {
    return typeof id === "string" && id.toLowerCase() === historicalRecordId(empresaId, table);
}
