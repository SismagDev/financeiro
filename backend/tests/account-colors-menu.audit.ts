// Conferência direcionada com API simulada; não grava dados reais.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
async function run() {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const company = "11111111-1111-4111-8111-111111111111";
    const today = new Date().toISOString().slice(0, 10);
    const rows = ["receber", "pagar"].flatMap(tipo => [0, 3, 20].map((days, index) => {
        const due = new Date(today); due.setUTCDate(due.getUTCDate() + days);
        return { id: `${tipo}-${index}`, empresa_id: company, tipo, descricao: `Descrição longa para conferir documento e vencimento ${tipo} ${index}`, valor: 100, saldo: 100, status: "pendente", data_vencimento: due.toISOString(), competencia: today.slice(0, 7) + "-01", num_doc: "DOC-123456", quantidade_baixas: 0 };
    }));
    let writes = 0;
    await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        if (url.origin === "http://127.0.0.1:5188") return route.continue();
        if (request.method() !== "GET") writes++;
        if (path === "/auth/me") return route.fulfill({ json: { data: { id: "audit", role: "comum", email: "audit@invalid" } } });
        if (path === "/empresas") return route.fulfill({ json: { data: [{ id: company, nome: "Empresa teste", perfil: "comum", licenca_status: "ativa" }] } });
        if (url.searchParams.has("resumo")) return route.fulfill({ json: { data: { overdue: 0, automaticOverdue: 0, overdueRows: [] } } });
        if (path.startsWith("/lancamentos/")) return route.fulfill({ json: { data: rows.find(row => row.id === path.split("/").at(-1)) } });
        return route.fulfill({ json: { data: path === "/lancamentos" ? rows : [], meta: { pagina: 1, paginas: 1, total: rows.length } } });
    });
    try {
        await page.goto("http://127.0.0.1:5188/lancamentos");
        const trigger = page.getByRole("button", { name: /^Ações da conta:/ }).first();
        await trigger.waitFor();
        assert.equal(await page.locator(".settle-row-button").first().isVisible(), false);
        await trigger.tap();
        const menu = page.getByRole("menu", { name: "Ações da conta" });
        await menu.waitFor();
        const box = await menu.boundingBox();
        assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844);
        await menu.press("ArrowDown"); await menu.press("Escape");
        assert.equal(await menu.count(), 0);
        await trigger.tap(); await page.getByRole("heading", { name: "Contas", exact: true }).tap();
        assert.equal(await menu.count(), 0);
        await trigger.tap(); await menu.getByRole("menuitem", { name: "Baixa rápida", exact: true }).tap();
        assert.equal(await menu.count(), 0);
        await page.getByRole("combobox", { name: "Forma de pagamento da baixa rápida" }).waitFor();
        await page.getByRole("button", { name: "Cancelar baixa rápida" }).tap();
        await trigger.tap(); await menu.getByRole("menuitem", { name: "Clonar conta", exact: true }).tap();
        const dialog = page.getByRole("dialog"); await dialog.locator('input[name="valor"]').waitFor();
        assert.equal(await menu.count(), 0); assert.equal(writes, 0);
        assert.equal(await dialog.locator(".keep-account-data").evaluate(el => getComputedStyle(el).paddingTop), "10px");
        await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
        const output = process.env.AUDIT_OUTPUT;
        if (output) { await mkdir(output, { recursive: true }); await trigger.tap(); await page.screenshot({ path: `${output}/menu-mobile.png` }); await menu.press("Escape"); }
        await page.setViewportSize({ width: 1440, height: 900 });
        assert.equal(await trigger.isVisible(), false);
        const colors = await page.locator(".resource-lancamentos tbody tr").evaluateAll(elements => elements.map(el => getComputedStyle(el.querySelector("td")!).backgroundColor));
        assert.equal(new Set(colors.slice(0, 3)).size, 3);
        assert.equal(new Set(colors.slice(3, 6)).size, 3);
        assert.notEqual(colors[0], colors[3]);
        assert.equal(await page.locator(".resource-lancamentos tbody td").first().evaluate(el => getComputedStyle(el).color), "rgb(23, 34, 30)");
        if (output) await page.screenshot({ path: `${output}/cores-desktop.png` });
        assert.deepEqual(errors, []);
        console.log("OK: três níveis por tipo, menu móvel, toque fora, Escape/setas, baixa rápida, clonagem sem escrita, padding e desktop preservado.");
    } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
