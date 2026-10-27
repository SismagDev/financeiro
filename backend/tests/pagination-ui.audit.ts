import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { chromium } from "playwright";

// Executado pelo pagination.audit.ts com PAGINATION_UI=1. Chromium real, headless.
export async function auditUi(api: string, ids: string[], account: string) {
    const frontend = "http://127.0.0.1:5177", apiOrigin = "http://127.0.0.1:31999";
    const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5177", "--strictPort"],
        { cwd: resolve("../frontend"), env: { ...process.env, VITE_API_URL: apiOrigin }, windowsHide: true, stdio: "pipe" });
    let logs = "";
    vite.stdout.on("data", data => { logs += String(data); });
    vite.stderr.on("data", data => { logs += String(data); });
    const browser = await chromium.launch({ headless: true });
    const calls: { path: string; method: string }[] = [], errors: string[] = [];
    try {
        for (let attempt = 0; ; attempt++) {
            if (await fetch(frontend).then(response => response.ok).catch(() => false)) break;
            if (attempt >= 80 || vite.exitCode !== null) throw new Error("Vite indisponível: " + logs);
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        const user = (await (await fetch(api + "/auth/me")).json()).data;
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        await page.addInitScript(({ ids, user }) => {
            localStorage.setItem("fluxo-companies:" + user, JSON.stringify(ids));
            localStorage.setItem("fluxo-overdue-warning:" + user + ":" + ids[0], new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()));
        }, { ids, user: user.id });
        page.on("pageerror", error => errors.push(error.message));
        await page.route(apiOrigin + "/**", async route => {
            const request = route.request(), url = new URL(request.url());
            calls.push({ path: url.pathname + url.search, method: request.method() });
            const response = await fetch(api + url.pathname + url.search, { method: request.method(),
                headers: { "Content-Type": "application/json", "x-empresa-id": request.headers()["x-empresa-id"] || ids[0]! }, body: request.postData() || undefined });
            const body = await response.text();
            if (url.searchParams.get("busca") === "Pessoa 001") await new Promise(resolve => setTimeout(resolve, 600));
            await route.fulfill({ status: response.status, body, contentType: "application/json" }).catch(() => { /* Request cancelado pelo navegador. */ });
        });
        await page.goto(frontend + "/pessoas");
        await page.getByText("1–50 de 160 registros", { exact: true }).waitFor();
        assert.ok(calls.every(call => ["/auth/me", "/empresas", "/pessoas", "/lancamentos"].includes(new URL(call.path, api).pathname)));
        assert.ok(calls.filter(call => call.path.startsWith("/lancamentos")).every(call => call.path.includes("resumo=alertas")));
        assert.equal(await page.locator("tbody tr").count(), 50);
        assert.equal(calls.filter(call => call.path === "/auth/me").length, 1);
        assert.equal(calls.filter(call => call.path === "/empresas").length, 1);
        await page.getByRole("button", { name: "Próxima", exact: true }).click();
        await page.getByText("51–100 de 160 registros", { exact: true }).waitFor();
        assert.ok(calls.some(call => call.path.startsWith("/pessoas?") && call.path.includes("pagina=2")));
        await page.getByRole("searchbox", { name: "Buscar nome, CPF ou celular" }).fill("12345600100");
        await page.getByText("1–2 de 2 registros", { exact: true }).waitFor();
        const search = page.getByRole("searchbox", { name: "Buscar nome, CPF ou celular" });
        await search.fill("Pessoa 001");
        await page.waitForRequest(request => request.url().includes("busca=Pessoa+001"));
        await search.fill("Pessoa 002");
        await page.getByRole("row", { name: /Pessoa 002/ }).first().waitFor();
        await page.waitForTimeout(800);
        assert.equal(await page.getByRole("row", { name: /Pessoa 001/ }).count(), 0);
        assert.equal(await page.getByRole("row", { name: /Pessoa 002/ }).count(), 2);
        console.log("UI PASS início restrito, próxima página, CPF e descarte de resposta antiga");

        await page.getByRole("button", { name: "Contas", exact: true }).click();
        await page.getByRole("heading", { name: "Contas", exact: true }).waitFor();
        await page.locator(".launch-filters input[type=date]").first().fill("2026-10-01");
        await page.locator(".launch-filters input[type=date]").nth(1).fill("2026-10-31");
        await page.getByText("1–50 de 139 registros", { exact: true }).waitFor();
        const beforeCreate = calls.length;
        await page.getByRole("button", { name: "Nova conta", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Cadastro", exact: true });
        await dialog.getByRole("combobox", { name: "Cliente", exact: true }).click();
        await dialog.getByRole("option", { name: /^Pessoa \d{3}$/ }).first().waitFor();
        assert.ok(calls.slice(beforeCreate).some(call => call.path.startsWith("/pessoas?") && call.path.includes("opcoes=true")));
        const initialNames = await dialog.getByRole("option", { name: /^Pessoa \d{3}$/ }).allTextContents();
        const outsideFirstPage = Array.from({ length: 80 }, (_, index) => `Pessoa ${String(index + 1).padStart(3, "0")}`).find(name => !initialNames.includes(name))!;
        await dialog.getByRole("combobox", { name: "Cliente", exact: true }).fill(outsideFirstPage);
        await dialog.getByRole("option", { name: outsideFirstPage, exact: true }).click();
        assert.equal(await dialog.locator('input[name="pessoa_id"]').inputValue() !== "", true);
        await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
        console.log("UI PASS datas na query e seletor busca pessoa fora da primeira página");

        const record = await (await fetch(api + "/lancamentos/" + account, { headers: { "x-empresa-id": ids[0]! } })).json();
        await page.getByRole("searchbox", { name: "Buscar cliente ou descrição", exact: true }).fill(record.data.descricao);
        const targetRow = page.getByRole("row", { name: `Editar conta: ${record.data.numero}`, exact: true })
            .filter({ has: page.getByRole("cell", { name: "AUD-0", exact: true }) });
        await targetRow.waitFor();
        await targetRow.getByRole("button", { name: "Detalhes", exact: true }).click();
        const details = page.getByRole("dialog", { name: "Detalhes das baixas", exact: true });
        await details.getByText("1–50 de 70 registros", { exact: true }).waitFor();
        await details.getByRole("button", { name: "Próxima", exact: true }).click();
        await details.getByText("51–70 de 70 registros", { exact: true }).waitFor();
        await details.getByRole("button", { name: "Dar baixa", exact: true }).click();
        const settle = page.getByRole("dialog", { name: "Registrar baixa", exact: true });
        await settle.getByRole("combobox", { name: "Forma de pagamento", exact: true }).click();
        await settle.getByRole("option", { name: "Pix auditoria", exact: true }).click();
        await settle.locator('input[name="valor"]').fill("1");
        const beforeSettlement = calls.length;
        await settle.getByRole("button", { name: /Confirmar baixa/ }).click();
        await settle.waitFor({ state: "hidden" });
        await details.getByText("51–71 de 71 registros", { exact: true }).waitFor();
        const mutationCalls = calls.slice(beforeSettlement);
        assert.ok(mutationCalls.some(call => call.path.endsWith("/baixar") && call.method === "POST"));
        assert.ok(mutationCalls.every(call => !["/pessoas", "/bancos", "/planos-contas", "/empresas", "/caixa"].includes(new URL(call.path, api).pathname)));
        assert.equal(errors.length, 0, errors.join("\n"));
        console.log("UI PASS detalhes paginados e baixa sem recarregar pessoas, bancos, planos, empresas ou caixa");
        await details.locator(".modal-head > button").click();
        await page.getByRole("searchbox", { name: "Buscar cliente ou descrição", exact: true }).fill("");
        await page.getByText("1–50 de 139 registros", { exact: true }).waitFor();
        const sorted = page.waitForResponse(response => response.url().startsWith(apiOrigin + "/lancamentos?") && response.url().includes("ordem=data_vencimento") && response.url().includes("direcao=desc"));
        await page.getByRole("button", { name: /^Vencimento/ }).click();
        await sorted;
        await page.getByRole("combobox", { name: "Filtrar por empresa", exact: true }).selectOption(ids[1]!);
        await page.getByText("1–50 de 70 registros", { exact: true }).waitFor();
        assert.equal(await page.getByRole("cell", { name: "AUD-0", exact: true }).count(), 0);
        assert.equal(await page.getByRole("cell", { name: "AUD-1", exact: true }).count(), 50);
        await page.getByRole("button", { name: "Pessoas", exact: true }).click();
        await page.getByText("1–50 de 80 registros", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Próxima", exact: true }).click();
        await page.getByText("51–80 de 80 registros", { exact: true }).waitFor();
        await page.getByRole("combobox", { name: "Filtrar por empresa", exact: true }).selectOption("");
        await page.getByText("1–50 de 160 registros", { exact: true }).waitFor();
        console.log("UI PASS ordenação no backend, isolamento por empresa e retorno à primeira página ao alterar o escopo");
    } finally {
        await browser.close(); vite.kill();
    }
}
