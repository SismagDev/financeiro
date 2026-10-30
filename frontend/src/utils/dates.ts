import type { Row } from "../types";

const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function localDateInputValue(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function savedDashboardYear(value: string | null, date = new Date()) {
    const year = Number(value);
    return /^\d{4}$/.test(value || "") && year >= 1000 && year <= 9998 ? year : date.getFullYear();
}
export function dateInputValue(value: Row[string]) {
    return String(value ?? "").match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}
export function competenceLabel(value: Row[string]) {
    const date = dateInputValue(value);
    if (!date) return "";
    return `${months[Number(date.slice(5, 7)) - 1]}/${date.slice(0, 4)}`;
}
export function competenceDate(value: string) {
    const [month, year] = value.toLowerCase().split("/");
    const index = months.indexOf(month);
    return index < 0 || !/^\d{4}$/.test(year ?? "") ? "" : `${year}-${String(index + 1).padStart(2, "0")}-01`;
}

