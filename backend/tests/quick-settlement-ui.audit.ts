// Opt-in: frontend local em execução; API simulada, sem alterações no banco real.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { localDateInputValue } from "../../frontend/src/utils/dates";

async function run() {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const companies = [randomUUID(), randomUUID()], forms = [randomUUID(), randomUUID()];
        const accounts = companies.map((empresa_id, index) => ({ id: randomUUID(), empresa_id, numero: index + 1,
            descricao: `Conta rápida ${index + 1}`, tipo: index ? "pagar" : "receber", valor: 100,
            desconto: index ? 0 : 10, acrescimo: index ? 0 : 5, saldo: index ? 100 : 55,
            status: index ? "pendente" : "parcial", quantidade_baixas: index ? 0 : 1,
            data_vencimento: localDateInputValue(), competencia: localDateInputValue().slice(0, 7) + "-01" }));
        const errors: string[] = [], posts: { company: string | undefined; body: Record<string, unknown> }[] = [];
        let failNext = false;
        page.on("pageerror", error => errors.push(error.message));
        await page.addInitScript(ids => localStorage.setItem("fluxo-companies:audit", JSON.stringify(ids)), companies);
        await page.route("**/*", async route => {
            const request = route.request(), url = new URL(request.url()), path = url.pathname;
            if (request.resourceType() === "document") return route.continue();
            const meta = { total: 2, pagina: 1, paginas: 1 };
            if (path === "/auth/me") return route.fulfill({ json: { data: { id: "audit", nome: "Teste", role: "comum" } } });
            if (path === "/empresas") return route.fulfill({ json: { data: companies.map((id, i) => ({ id, nome: `Empresa ${i + 1}`, perfil: "comum", licenca_status: "ativa" })) } });
            if (path === "/lancamentos") return route.fulfill({ json: url.searchParams.has("resumo")
                ? { data: { overdue: 0, overdueRows: [] } } : { data: accounts, meta } });
            const account = accounts.find(item => path.startsWith(`/lancamentos/${item.id}`));
            if (account && path.endsWith("/baixar")) {
                posts.push({ company: request.headers()["x-empresa-id"], body: request.postDataJSON() });
                await new Promise(resolve => setTimeout(resolve, 300));
                if (failNext) { failNext = false; return route.fulfill({ status: 400, json: { message: "Falha de teste" } }); }
                account.saldo = 0; account.status = "pago"; account.quantidade_baixas++;
                return route.fulfill({ json: { id: randomUUID() } });
            }
            if (account) return route.fulfill({ json: { data: account } });
            if (path === "/formas-pagamento") {
                const company = url.searchParams.get("empresas");
                assert.equal(url.searchParams.get("ativo"), "true");
                assert.ok(companies.includes(company!));
                const index = companies.indexOf(company!);
                return route.fulfill({ json: { data: [{ id: forms[index], empresa_id: company, descricao: `Pix empresa ${index + 1}`, ativo: true }], meta: { total: 1, pagina: 1, paginas: 1 } } });
            }
            if (["/recebimentos", "/movimentacoes", "/pessoas", "/planos-contas", "/bancos"].includes(path)) return route.fulfill({ json: { data: [], meta: { total: 0, pagina: 1, paginas: 1 } } });
            return route.continue();
        });
        await page.goto((process.env.AUDIT_FRONTEND_URL || "http://127.0.0.1:5178") + "/lancamentos");
        const first = page.locator("tbody tr").filter({ hasText: "Conta rápida 1" });
        const second = page.locator("tbody tr").filter({ hasText: "Conta rápida 2" });
        const quick = page.locator(".quick-settlement");
        await first.waitFor();
        await page.getByRole("combobox", { name: "Tipo de conta", exact: true }).click();
        assert.deepEqual(await page.getByRole("listbox", { name: "Tipo de conta", exact: true }).getByRole("option").allTextContents(), ["A pagar", "A receber", "Todos"]);
        await page.getByRole("heading", { name: "Contas", exact: true }).click();
        assert.equal(await second.getByRole("button", { name: "Baixa", exact: true }).count(), 1);
        assert.equal(await page.getByText("Dar baixa", { exact: true }).count(), 0);
        await first.getByRole("button", { name: "Baixa rápida", exact: true }).click();
        assert.equal(await quick.count(), 1);
        assert.equal(await quick.getByRole("button", { name: "Confirmar baixa rápida" }).isDisabled(), true);
        await second.getByRole("button", { name: "Baixa rápida", exact: true }).click();
        assert.equal(await first.locator(".quick-settlement").count(), 0);
        assert.equal(await second.locator(".quick-settlement").count(), 1);
        await quick.getByRole("combobox").click();
        await quick.getByRole("option", { name: "Pix empresa 2" }).click();
        assert.equal(await quick.count(), 1);
        await quick.getByRole("button", { name: "Cancelar baixa rápida" }).click();
        assert.equal(posts.length, 0);
        assert.equal(await quick.count(), 0);
        assert.equal(await second.getByRole("button", { name: "Excluir registro" }).count(), 1);

        // A ação externa continua funcionando ao fechar a baixa rápida.
        for (const action of ["row", "details", "settle"]) {
            await second.getByRole("button", { name: "Baixa rápida", exact: true }).click();
            if (action === "row") await first.locator("td").first().click();
            if (action === "details") await first.getByTitle("Detalhes das baixas", { exact: true }).click();
            if (action === "settle") await second.getByRole("button", { name: "Baixa", exact: true }).click();
            await page.getByRole("dialog").waitFor();
            assert.equal(await quick.count(), 0);
            await page.getByRole("button", { name: "Fechar cadastro", exact: true }).click();
            await page.getByRole("dialog").waitFor({ state: "hidden" });
        }
        // Forma da empresa correta, erro recuperável, confirmação única e saldo atualizado.
        for (const [index, row] of [first, second].entries()) {
            if (index) await page.setViewportSize({ width: 390, height: 844 });
            await row.getByRole("button", { name: "Baixa rápida", exact: true }).click();
            assert.ok(await page.locator(".table-wrap").evaluate(element =>
                Math.abs(element.scrollWidth - element.clientWidth - element.scrollLeft) <= 1));
            await row.hover();
            assert.equal(await row.getByRole("button", { name: "Excluir registro" }).count(), 0);
            for (const label of ["Confirmar baixa rápida", "Cancelar baixa rápida"]) {
                const button = quick.getByRole("button", { name: label });
                const bounds = await button.boundingBox(), icon = await button.locator("svg").boundingBox();
                assert.ok(bounds && icon && Math.abs(bounds.x + bounds.width / 2 - icon.x - icon.width / 2) < 1
                    && Math.abs(bounds.y + bounds.height / 2 - icon.y - icon.height / 2) < 1);
            }
            await quick.getByRole("combobox").fill("Pix");
            await quick.getByRole("option", { name: `Pix empresa ${index + 1}` }).waitFor();
            await quick.getByRole("combobox").press("ArrowDown");
            await quick.getByRole("combobox").press("Enter");
            const previous = await row.locator(".settle-row-button").boundingBox(), editor = await quick.boundingBox();
            assert.ok(previous && editor && previous.x + previous.width <= editor.x && Math.abs(previous.y + previous.height / 2 - editor.y - editor.height / 2) < 2);
            await quick.scrollIntoViewIfNeeded();
            if (process.env.AUDIT_OUTPUT_DIR) await page.screenshot({ path: `${process.env.AUDIT_OUTPUT_DIR}/baixa-rapida-${index ? "mobile" : "desktop"}.png` });
            if (!index) {
                failNext = true;
                await quick.getByRole("button", { name: "Confirmar baixa rápida" }).click();
                await page.locator(".toast-error").filter({ hasText: "Falha de teste" }).waitFor();
                assert.equal(await quick.count(), 1);
            }
            const count = posts.length;
            await quick.getByRole("button", { name: "Confirmar baixa rápida" }).dblclick();
            await quick.waitFor({ state: "hidden" });
            assert.equal(posts.length, count + 1);
            assert.deepEqual(posts.at(-1), { company: companies[index], body: { forma_pagamento_id: forms[index], valor: index ? 100 : 55,
                data: localDateInputValue(), desconto: 0, acrescimo: 0 } });
            assert.equal(await row.getByRole("button", { name: "Baixa rápida", exact: true }).count(), 0);
            assert.match(await row.innerText(), /Pago/);
        }
        assert.deepEqual(errors, []);
        console.log("PASS: abertura, seleção, teclado, cancelamento, troca de linha, ações externas, erro/repetição, empresa, saldo integral, data local e atualização em desktop/mobile (API simulada).");
    } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
