// Validação visual direcionada: API simulada, nenhuma escrita real.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
async function run() {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const company = "11111111-1111-4111-8111-111111111111";
    let admin = false;
    const rows = ["pendente", "pago"].map((status, index) => ({ id: `conta-${index}`, empresa_id: company, numero: index + 1, descricao: "Descrição longa da conta com documento e vencimento", pessoa_nome: "Cliente para conferir largura", plano_conta_descricao: "Serviços e manutenção", tipo: "receber", valor: 100, saldo: index ? 0 : 100, status, data_vencimento: "2026-11-11", data_ultima_baixa: index ? "2026-11-11" : null, quantidade_baixas: index, num_doc: "DOC-123456" }));
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin === "http://127.0.0.1:5188") return route.continue();
        if (url.pathname === "/auth/me") return route.fulfill({ json: { data: { id: "audit", email: "audit@invalid", role: admin ? "admin" : "comum" } } });
        if (url.pathname === "/empresas") return route.fulfill({ json: { data: [{ id: company, nome: "Empresa teste", perfil: "comum", licenca_status: "ativa" }] } });
        if (url.searchParams.has("resumo")) return route.fulfill({ json: { data: { overdue: 0, automaticOverdue: 0, overdueRows: [], rows, flowRows: [], pagar: 0, receber: 100, totalPaid: 100 } } });
        const generic = { id: "cadastro", empresa_id: company, nome: "Cadastro com nome longo para conferir a rolagem horizontal", descricao: "Cadastro de conferência", documento: "12345678901", celular: "11999999999", endereco: "Endereço para conferir a rolagem", responsavel_nome: "Responsável do cadastro", cliente: true, fornecedor: true, ativo: true };
        return route.fulfill({ json: { data: url.pathname === "/lancamentos" ? rows : url.pathname.startsWith("/admin") || ["/caixa", "/movimentacoes"].includes(url.pathname) ? [] : [generic], meta: { total: 2, pagina: 1, paginas: 1 }, saldo_atual: 0 } });
    });
    const output = process.env.AUDIT_OUTPUT;
    if (output) await mkdir(output, { recursive: true });
    try {
        for (const width of [1920, 390]) {
            await page.setViewportSize({ width, height: 1080 });
            for (const path of ["/", "/caixa", "/lancamentos", "/pessoas", "/bancos", "/formas-pagamento", "/planos-contas", "/tipos-caixa-diario", "/baixas"]) {
                await page.goto("http://127.0.0.1:5188" + path);
                await page.locator(".page-content").waitFor();
                await page.waitForFunction(() => !document.querySelector(".table-loading, .full-loader"));
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, path);
                if (width === 1920) {
                    const ratio = await page.evaluate(() => document.querySelector(".page-content")!.getBoundingClientRect().width / document.querySelector(".main-area")!.getBoundingClientRect().width);
                    assert.ok(ratio > .99, `${path}: largura global ${ratio}`);
                }
                if (path === "/lancamentos") {
                    const label = page.locator(".balance-cell small").filter({ hasText: "Quitação:" });
                    await label.scrollIntoViewIfNeeded();
                    assert.match(await label.innerText(), /Quitação: 11\/11\/2026/);
                    assert.equal(await label.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, "data sem corte horizontal");
                    if (width === 1920) {
                        const buttons = await page.locator(".launch-actions > .settle-row-button").evaluateAll(elements => elements.map(el => el.getBoundingClientRect().left));
                        assert.ok(Math.abs(buttons[0] - buttons[1]) < 1, "Baixa e Detalhes começam na mesma posição");
                    }
                    if (output) await page.screenshot({ path: `${output}/quitacao-${width}.png` });
                }
                if (!["/", "/caixa", "/lancamentos"].includes(path)) {
                    const trash = page.locator(".resource-table:not(.resource-lancamentos) tbody .row-delete").first();
                    if (await trash.count()) {
                        await page.locator(".resource-table tbody tr").first().hover();
                        const wrap = page.locator(".list-panel .table-wrap");
                        for (const end of [false, true]) {
                            await wrap.evaluate((el, end) => { el.scrollLeft = end ? el.scrollWidth : 0; }, end);
                            const bounds = await wrap.boundingBox(), button = await trash.boundingBox();
                            assert.ok(bounds && button && button.x >= bounds.x && button.x + button.width <= bounds.x + bounds.width + 1, `${path}: lixeira na borda visível`);
                        }
                        assert.ok(await page.locator("td.delete-actions").first().evaluate(el => el.getBoundingClientRect().width >= 48), "espaço reservado para lixeira");
                    }
                    await page.locator(".list-heading > .button-primary").click();
                    const dialog = page.getByRole("dialog"); await dialog.locator(".form-grid").waitFor();
                    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
                    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
                }
            }
        }
        admin = true;
        for (const width of [1920, 390]) {
            await page.setViewportSize({ width, height: 1080 }); await page.reload();
            await page.locator(".admin-page").waitFor();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        }
        assert.deepEqual(errors, []);
        console.log("OK: largura global em 9 telas e área administrativa, desktop/celular, formulários, quitação completa e ações alinhadas.");
    } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
