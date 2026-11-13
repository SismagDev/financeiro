// Opt-in: frontend local; API simulada, sem alterações no banco real.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, type Locator } from "playwright";

async function run() {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
        page.setDefaultTimeout(10000);
        const company = randomUUID(), bank = randomUUID(), accountId = randomUUID();
        const account = { id: accountId, empresa_id: company, numero: 1, descricao: "Conta teste", tipo: "pagar", valor: 100,
            desconto: 20, acrescimo: 0, saldo: 80, status: "pendente", quantidade_baixas: 0, data_vencimento: "2026-11-13", competencia: "2026-11-01" };
        const forms = Array.from({ length: 35 }, (_, index) => ({ id: randomUUID(), empresa_id: company, banco_id: bank,
            descricao: `Forma ${String(index + 1).padStart(2, "0")}`, banco_descricao: "Banco teste", ativo: true }));
        const posts: Record<string, number>[] = [], errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.route("**/*", async route => {
            const request = route.request(), url = new URL(request.url()), path = url.pathname;
            if (request.resourceType() === "document") return route.continue();
            const list = (data: unknown[]) => route.fulfill({ json: { data, meta: { total: data.length, pagina: 1, paginas: 1 } } });
            if (path === "/auth/me") return route.fulfill({ json: { data: { id: "combo-audit", nome: "Teste", role: "comum" } } });
            if (path === "/empresas") return list([{ id: company, nome: "Empresa teste", perfil: "comum", licenca_status: "ativa", avisar_contas_vencidas: false }]);
            if (path === `/lancamentos/${accountId}/baixar`) {
                const body = request.postDataJSON(); posts.push(body);
                account.saldo = Math.round((account.saldo - body.valor - body.desconto + body.acrescimo) * 100) / 100;
                return route.fulfill({ json: { id: randomUUID() } });
            }
            if (path === `/lancamentos/${accountId}`) return route.fulfill({ json: { data: account } });
            if (path === "/lancamentos") return url.searchParams.has("resumo") ? route.fulfill({ json: { data: { overdue: 0, overdueRows: [] } } }) : list([account]);
            if (path === "/bancos") return list([{ id: bank, empresa_id: company, descricao: "Banco teste" }]);
            if (path === "/formas-pagamento") return list(forms.filter(form => form.descricao.toLowerCase().includes((url.searchParams.get("busca") || "").toLowerCase())));
            if (["/recebimentos", "/movimentacoes", "/pessoas", "/planos-contas", "/caixa"].includes(path)) return list([]);
            return route.continue();
        });
        const url = (process.env.AUDIT_FRONTEND_URL || "http://127.0.0.1:5186") + "/lancamentos";
        async function bounds(list: Locator) {
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const box = await list.boundingBox();
            assert.ok(box);
            assert.ok(box.x >= 15 && box.y >= 15, JSON.stringify(box));
            assert.ok(box.x + box.width <= page.viewportSize()!.width - 15, JSON.stringify(box));
            assert.ok(box.y + box.height <= page.viewportSize()!.height - 23, JSON.stringify(box));
            assert.ok(await list.evaluate(element => {
                const rect = element.getBoundingClientRect();
                return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + 12));
            }), "A lista deve sobrepor os controles e o modal.");
            return box;
        }
        await page.goto(url);
        const filter = page.getByRole("combobox", { name: "Filtrar por forma de pagamento", exact: true });
        await filter.click();
        const outsideList = page.locator(".combobox-results");
        await outsideList.getByRole("option", { name: "Forma 35", exact: true }).waitFor();
        assert.ok((await bounds(outsideList)).height > 210, "A lista deve mostrar mais linhas que o limite antigo.");
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 640 }]) {
            await page.setViewportSize(viewport);
            await filter.evaluate(input => {
                Object.assign(input.parentElement!.parentElement!.style, { position: "fixed", left: "16px", top: `${window.innerHeight - 70}px`, width: "250px", zIndex: "60" });
                window.dispatchEvent(new Event("resize"));
            });
            const listBox = await bounds(outsideList), control = await filter.boundingBox();
            assert.ok(control && listBox.y + listBox.height < control.y, "Perto do rodapé a lista deve abrir para cima.");
        }
        for (let i = 0; i < 25; i++) await filter.press("ArrowDown");
        const active = outsideList.locator(".active");
        const activeBox = await active.boundingBox(), listBox = await outsideList.boundingBox();
        assert.ok(activeBox && listBox && activeBox.y >= listBox.y && activeBox.y + activeBox.height <= listBox.y + listBox.height + 1);
        await filter.press("Escape");
        assert.equal(await outsideList.count(), 0);
        await filter.evaluate(input => input.parentElement!.parentElement!.removeAttribute("style"));

        // Dentro do modal: clipping, zoom, busca, toque, teclado e fechamento.
        await page.setViewportSize({ width: 1440, height: 1000 });
        const row = page.locator("tbody tr").filter({ hasText: "Conta teste" });
        await row.getByRole("button", { name: "Baixa", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("combobox", { name: "Banco", exact: true }).fill("Banco");
        await dialog.getByRole("option", { name: "Banco teste", exact: true }).click();
        const payment = dialog.getByRole("combobox", { name: "Forma de pagamento", exact: true });
        await payment.click();
        const list = dialog.locator(".combobox-results");
        await list.getByRole("option", { name: "Forma 35", exact: true }).waitFor();
        await dialog.evaluate(element => { element.style.overflow = "hidden"; });
        const modalBox = await dialog.boundingBox(), dropdown = await bounds(list);
        assert.ok(modalBox && (dropdown.y < modalBox.y || dropdown.y + dropdown.height > modalBox.y + modalBox.height), "A lista deve ultrapassar o modal.");
        for (const zoom of [80, 120, 100]) {
            await page.evaluate(value => document.documentElement.style.setProperty("--app-zoom", String(value / 100)), zoom);
            await page.waitForTimeout(80);
            const dropdown = await bounds(list), anchor = await payment.boundingBox();
            assert.ok(anchor && Math.abs(dropdown.x - anchor.x) <= 1, "A lista deve acompanhar a posição do campo com zoom.");
            assert.ok(anchor && Math.min(Math.abs(dropdown.y - anchor.y - anchor.height - 5), Math.abs(anchor.y - dropdown.y - dropdown.height - 5)) <= 1,
                "A lista deve permanecer ancorada ao campo com zoom.");
        }
        await page.setViewportSize({ width: 390, height: 640 });
        await bounds(list);
        await payment.fill("35");
        await list.getByRole("option", { name: "Forma 35", exact: true }).tap();
        assert.equal(await payment.inputValue(), "Forma 35");
        await payment.click();
        await payment.press("ArrowDown");
        await payment.press("Enter");
        assert.equal(await list.count(), 0);
        await payment.click();
        await dialog.getByText("Valor do saldo a baixar", { exact: true }).click();
        assert.equal(await list.count(), 0);

        // O formulário envia o excedente em acrescimo, somando apenas o ajuste manual.
        const base = dialog.getByLabel("Valor do saldo a baixar", { exact: true });
        for (const [value, surcharge] of [[50, 0], [80, 0], [95.35, 15.35]]) {
            await base.fill(String(value));
            assert.equal(Number(await dialog.locator('input[name="valor"]').inputValue()), value);
            assert.equal(Number(await dialog.locator('input[name="acrescimo"]').inputValue()), surcharge);
            assert.equal(await dialog.getByText(/Acréscimo automático de/).count(), surcharge ? 1 : 0);
            assert.equal(await dialog.getByRole("button", { name: /Confirmar baixa/ }).isEnabled(), true);
        }
        assert.match(await dialog.getByText(/Acréscimo automático de/).innerText(), /15,35/);
        await dialog.getByLabel("Modificador", { exact: true }).selectOption("acrescimo");
        await dialog.getByLabel("Valor do modificador", { exact: true }).fill("2.10");
        assert.equal(Number(await dialog.locator('input[name="valor"]').inputValue()), 97.45);
        assert.equal(Number(await dialog.locator('input[name="acrescimo"]').inputValue()), 17.45);
        await dialog.getByLabel("Modificador", { exact: true }).selectOption("desconto");
        await dialog.getByLabel("Valor do modificador", { exact: true }).fill("5");
        assert.equal(Number(await dialog.locator('input[name="valor"]').inputValue()), 90.35);
        assert.equal(Number(await dialog.locator('input[name="acrescimo"]').inputValue()), 15.35);
        await dialog.getByLabel("Modificador", { exact: true }).selectOption("none");
        await dialog.getByRole("button", { name: /Confirmar baixa/ }).click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(posts.length, 1);
        assert.equal(posts[0].valor, 95.35);
        assert.equal(posts[0].acrescimo, 15.35);
        assert.equal(posts[0].desconto, 0);
        assert.equal(account.saldo, 0);
        assert.deepEqual(errors, []);
        console.log("PASS: combobox sobrepõe modal, respeita margens/rodapé, amplia linhas e preserva busca, toque, teclado e fechamento em desktop/mobile/zoom; baixa calcula e envia acréscimo uma única vez.");
    } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
