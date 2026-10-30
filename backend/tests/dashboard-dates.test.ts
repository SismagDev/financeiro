import assert from "node:assert/strict";
import { test } from "node:test";
import { competenceLabel, localDateInputValue, savedDashboardYear } from "../../frontend/src/utils/dates";
import { listSchema } from "../src/resources/list.service";

test("datas iniciais usam o dia e mês locais inclusive na virada do ano", () => {
    for (const [date, expected] of [[new Date(2026, 11, 31, 23, 59), "2026-12-31"], [new Date(2027, 0, 1, 0, 1), "2027-01-01"]] as const) {
        assert.equal(localDateInputValue(date), expected);
        assert.equal(competenceLabel(localDateInputValue(date)), expected.startsWith("2026") ? "dez/2026" : "jan/2027");
    }
});

test("ano do dashboard restaura preferência válida e usa o ano corrente para inválidos", () => {
    const now = new Date(2026, 9, 30);
    assert.equal(savedDashboardYear("2025", now), 2025);
    for (const input of [null, "", " ", "0", "-1", "abc", "2026x", "2026.5", "10000", "Infinity"])
        assert.equal(savedDashboardYear(input, now), 2026);
    assert.equal(listSchema.safeParse({ ano: "2025" }).success, true);
    for (const ano of ["0", "-1", "2026.5", "abc", "9999"]) assert.equal(listSchema.safeParse({ ano }).success, false);
});
