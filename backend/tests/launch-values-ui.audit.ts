// Opt-in: frontend local em execução; somente API simulada no navegador.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";

async function run() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const company = randomUUID(), accountId = randomUUID(), formId = randomUUID(), historicalFormId = randomUUID();
    const due = new Date().toISOString().slice(0, 7) + "-28";
    const account: Record<string, unknown> = { id: accountId, empresa_id: company, numero: 1, descricao: "Conta com ajustes", tipo: "receber", valor: 100, desconto: 10, acrescimo: 5, status: "parcial", data_vencimento: due, competencia: due.slice(0, 7) + "-01" };
    let saved: Record<string, unknown> | undefined;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        if (path === "/auth/me") return route.fulfill({ json: { data: { id: "audit", nome: "Teste", email: "audit@invalid", role: "comum" } } });
        if (path === "/empresas") return route.fulfill({ json: { data: [{ id: company, nome: "Empresa teste", perfil: "comum", licenca_status: "ativa" }] } });
        if (path === "/lancamentos/" + accountId && request.method() === "PATCH") {
            saved = request.postDataJSON(); Object.assign(account, saved); return route.fulfill({ json: { id: accountId } });
        }
        if (path === "/lancamentos") return route.fulfill({ json: { data: [account] } });
        if (path === "/formas-pagamento") return route.fulfill({ json: { data: [{ id: formId, empresa_id: company, descricao: "Pix", tipo: "pix", ativo: true }] } });
        if (path === "/recebimentos") return route.fulfill({ json: { data: [{ id: randomUUID(), empresa_id: company, lancamento_id: accountId, forma_pagamento_id: historicalFormId, forma_pagamento_descricao: "Baixa histórica", valor: 40, data_recebimento: due }] } });
        if (["/caixa", "/movimentacoes", "/pessoas", "/bancos", "/planos-contas"].includes(path)) return route.fulfill({ json: { data: [] } });
        return route.continue();
    });
    const output = process.env.AUDIT_OUTPUT_DIR;
    try {
        await page.goto(process.env.AUDIT_FRONTEND_URL || "http://127.0.0.1:5174");
        await page.getByRole("button", { name: "Contas", exact: true }).click();
        const row = page.locator("tbody tr").filter({ hasText: "Conta com ajustes" });
        await row.waitFor();
        assert.match(await row.innerText(), /95,00/);
        assert.match(await row.innerText(), /55,00/);
        await row.getByTitle("Detalhes das baixas", { exact: true }).click();
        let dialog = page.getByRole("dialog");
        assert.match(await dialog.locator(".account-value-summary").innerText(), /Valor original[\s\S]*100,00[\s\S]*Desconto[\s\S]*10,00[\s\S]*Acréscimo[\s\S]*5,00[\s\S]*Valor líquido[\s\S]*95,00/);
        assert.match(await dialog.locator("tbody").innerText(), /Baixa histórica/);
        assert.equal((await dialog.locator("tbody").innerText()).includes(historicalFormId.slice(0, 8)), false);
        if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: output + "/detalhes-desktop.png", animations: "disabled" }); }
        await dialog.locator(".modal-head .icon-button").click();
        await row.click(); dialog = page.getByRole("dialog");
        assert.equal(await dialog.locator('input[name="valor"]').inputValue(), "100");
        assert.equal(await dialog.locator('input[name="desconto"]').inputValue(), "10");
        assert.equal(await dialog.locator(".value-adjustments input[type=number]").isVisible(), false);
        await dialog.locator(".value-adjustments summary").click();
        await dialog.locator(".value-adjustments input[type=number]").fill("15");
        assert.match(await dialog.locator(".net-preview").innerText(), /90,00/);
        await dialog.locator(".value-adjustments select").selectOption("acrescimo");
        assert.equal(await dialog.locator(".value-adjustments input[type=number]").inputValue(), "5");
        await page.setViewportSize({ width: 390, height: 844 });
        if (output) await page.screenshot({ path: output + "/edicao-mobile.png", animations: "disabled" });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
        await dialog.getByRole("button", { name: /Salvar alterações/ }).click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(saved?.valor, 100); assert.equal(saved?.desconto, 15); assert.equal(saved?.acrescimo, 5);
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.getByRole("button", { name: "Baixas", exact: true }).click();
        await page.locator("tbody tr").filter({ hasText: "Baixa histórica" }).waitFor();
        assert.deepEqual(errors, []);
        console.log("PASS: listagem líquida, saldo, detalhes e listagem com nome histórico sem cadastro visível, ajustes opcionais, payload e layout móvel.");
    } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
