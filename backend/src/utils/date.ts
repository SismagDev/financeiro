export function isValidDate(value: unknown): value is Date {
    return value instanceof Date && !isNaN(value.getTime());
}

export function formatarDataBR(date: string | null) {
    if (!date) return null;

    const d = new Date(date);

    const parts = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).formatToParts(d);

    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

    return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export function brDateTimeToIsoDate(valor: any) {
    if (!valor) return null;

    const [data] = valor.split(" ");
    if (!data) return null;

    const [dia, mes, ano] = data.split("/");
    if (!dia || !mes || !ano) return null;

    return `${ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
}

export function validarDataISO(dataStr: string): boolean {
    const [ano, mes, dia] = dataStr.split("-").map(Number);

    if (!ano || !mes || !dia) {
        return false;
    }

    const data = new Date(ano, mes - 1, dia);

    return data.getFullYear() === ano && data.getMonth() === mes - 1 && data.getDate() === dia;
}
