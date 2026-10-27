import { SettlementError } from "../lancamentos/settlement.service";

export type AccessRow = Record<string, string>;

// Exportação do Access: ponto e vírgula, aspas escapadas e campos multilinha.
export function parseAccessText(text: string, file: string, requiredColumns: string[] = []): AccessRow[] {
    const records: string[][] = [];
    let record: string[] = [], value = "", quoted = false, closed = false;
    const source = text.replace(/^\uFEFF/, "");
    for (let index = 0; index <= source.length; index++) {
        const char = source[index];
        if (quoted) {
            if (char === undefined) throw new SettlementError(`${file}: campo com aspas não encerradas`);
            if (char === '"') {
                if (source[index + 1] === '"') { value += '"'; index++; }
                else { quoted = false; closed = true; }
            } else value += char;
        } else if (char === ";" || char === "\n" || char === "\r" || char === undefined) {
            record.push(value.trim()); value = ""; closed = false;
            if (char !== ";") {
                if (record.some(field => field !== "")) records.push(record);
                record = [];
                if (char === "\r" && source[index + 1] === "\n") index++;
            }
        } else if (char === '"' && value === "" && !closed) quoted = true;
        else {
            if (closed && char.trim()) throw new SettlementError(`${file}: caracteres após fechamento de aspas`);
            value += char;
        }
    }
    const headers = records.shift();
    if (!headers?.length || new Set(headers).size !== headers.length || headers.some(header => !header))
        throw new SettlementError(`${file}: cabeçalho ausente ou duplicado`);
    for (const column of requiredColumns) if (!headers.includes(column))
        throw new SettlementError(`${file}: coluna obrigatória ausente (${column})`);
    return records.map((fields, index) => {
        if (fields.length !== headers.length) throw new SettlementError(`${file}: registro ${index + 1} com quantidade de campos inválida`);
        return Object.fromEntries(headers.map((header, column) => [header, fields[column]]));
    });
}

export function accessMoney(value: string, context: string): number {
    if (!value) return 0;
    const clean = value.replace(/^R\$\s*/, "").trim();
    if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}$/.test(clean))
        throw new SettlementError(`${context}: valor monetário inválido (${value})`);
    const amount = Number(clean.replace(/\./g, "").replace(",", "."));
    if (!Number.isSafeInteger(Math.round(amount * 100))) throw new SettlementError(`${context}: valor fora do limite`);
    return Math.round(amount * 100) / 100;
}

export function accessDate(value: string, context: string): string {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: \d{1,2}:\d{2}:\d{2})?$/.exec(value);
    if (!match) throw new SettlementError(`${context}: data inválida (${value})`);
    const [, day, month, year] = match;
    const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const date = new Date(`${iso}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso)
        throw new SettlementError(`${context}: data inválida (${value})`);
    return iso;
}
