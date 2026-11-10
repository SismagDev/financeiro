// Frontend local, somente API simulada. Nenhuma importação real.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { analyzeCash, prepareCash } from "../src/importacao/caixa-diario.plan";
import { cashFixture, cashHeader } from "./fixtures/daily-cash";

async function run() {
    const fixture = cashFixture();
    const secondCompany = randomUUID(), secondBank = randomUUID();
    fixture.arquivo += '\r\n1;5/1/2025;Service/Zaal;R$ 10,00;R$ 20,00;;-R$ 2,00;;';
    const mapping = fixture.filiais["1"], company = mapping.empresa_id, bank = randomUUID();
    const forms = Object.entries(mapping.formas).map(([column, id]) => ({ id, empresa_id: company, descricao: column, banco_id: bank, ativo: true }));
    fixture.arquivo += '\r\n1;6/1/2025;Service/Zaal;R$ 40,00;;;;;';
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(({ company, secondCompany }) => localStorage.setItem("fluxo-companies:audit", JSON.stringify([company, secondCompany])), { company, secondCompany });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let manualCalls = 0, importCalls = 0;
    const response = (data: unknown[]) => ({ data, meta: { total: data.length, pagina: 1, paginas: 1 } });
    await page.route("**/*", async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        if (path === "/auth/me") return route.fulfill({ json: { data: { id: "audit", email: "audit@invalid", role: "comum" } } });
        if (path === "/empresas") return route.fulfill({ json: response([{ id: company, nome: "Empresa teste", perfil: "comum", licenca_status: "ativa" }, { id: secondCompany, nome: "Empresa segunda", perfil: "comum", licenca_status: "ativa" }]) });
        if (path === "/bancos") return route.fulfill({ json: response([{ id: bank, empresa_id: company, descricao: "Banco teste" }, { id: secondBank, empresa_id: secondCompany, descricao: "Banco segundo" }]) });
        if (path === "/formas-pagamento") return route.fulfill({ json: response([...forms, { id: randomUUID(), empresa_id: secondCompany, banco_id: secondBank, descricao: "Forma segunda", ativo: true }]) });
        if (path === "/tipos-caixa-diario") return route.fulfill({ json: response([{ id: mapping.tipo_caixa_diario_id, empresa_id: company, descricao: "Service/Zaal" }]) });
        if (path === "/importacao/caixa-diario") {
            const body = request.postDataJSON();
            if (body.acao === "analisar") return route.fulfill({ json: analyzeCash(body) });
            if (body.acao === "manual") {
                manualCalls++;
                assert.equal(body.valores.data, "2025-01-03");
                assert.equal(body.valores.valor, 60);
                assert.deepEqual(body.valores.baixas.map((row: { valor: number }) => row.valor), [10, 20, 30]);
                if (manualCalls === 1) return route.fulfill({ status: 409, json: { message: "Falha controlada: tente novamente" } });
                return route.fulfill({ status: 201, json: { id: randomUUID(), chave: body.chave } });
            }
            const plan = prepareCash(body);
            const ready = plan.dias.filter(day => !day.pendencias.length && day.total > 0 && day.data !== "2025-01-06");
            if (body.acao === "importar") {
                importCalls++;
                assert.deepEqual(body.resolvidos, ["1:2025-01-03"]);
                assert.equal(ready.length, 1);
            }
            return route.fulfill({ json: { ...plan, conflitos: plan.dias.some(day => day.data === "2025-01-06") ? [{ filial: "1", data: "2025-01-06" }] : [], ignorados: plan.dias.filter(day => day.data === "2025-01-06").length, total_ignorado: plan.dias.filter(day => day.data === "2025-01-06").reduce((sum, day) => sum + day.total, 0), dias_importados: body.acao === "importar" ? [{ filial: "1", data: "2025-01-02" }] : [], quantidade: ready.length, total: ready.reduce((sum, day) => sum + Math.round(day.total * 100), 0) / 100, importados: body.acao === "importar" ? ready.length : 0,
                dias: plan.dias.map(day => ({ ...day, empresa_id: company, status: day.data === "2025-01-06" ? "existente" : body.resolvidos.includes(day.chave) ? "resolvido" : day.pendencias.length ? "pendente" : day.total ? "pronto" : "zero",
                    valores_formulario: { data: day.data, tipo_caixa_diario_id: mapping.tipo_caixa_diario_id, valor: day.total, observacoes: "Importação teste",
                        baixas: Object.entries(day.valores).filter(([, value]) => value > 0).map(([column, valor]) => ({ banco_id: bank, forma_pagamento_id: mapping.formas[column as keyof typeof mapping.formas], valor })) } })) } });
        }
        if (path === "/lancamentos" && new URL(request.url()).searchParams.has("resumo")) return route.fulfill({ json: { data: { rows: [], flowRows: [], overdueRows: [], overdue: 0, pagar: 0, receber: 0, totalPaid: 0 } } });
        if (["/lancamentos", "/caixa", "/movimentacoes", "/recebimentos", "/pessoas", "/planos-contas"].includes(path)) return route.fulfill({ json: { ...response([]), rows: [], flowRows: [], overdueRows: [], overdue: 0, pagar: 0, receber: 0, totalPaid: 0 } });
        return route.continue();
    });
    try {
        await page.goto(process.env.AUDIT_FRONTEND_URL || "http://127.0.0.1:5189");
        await page.getByRole("button", { name: "Contas", exact: true }).click();
        await page.getByRole("button", { name: "Importar caixa diário", exact: true }).click();
        const modal = page.getByRole("dialog", { name: "Importar caixa diário" });
        await modal.locator('input[type="file"]').setInputFiles({ name: "caixa.txt", mimeType: "text/plain", buffer: Buffer.from(fixture.arquivo) });
        await modal.getByLabel("Data inicial", { exact: true }).fill("2025-01-01");
        await modal.getByRole("button", { name: "Analisar arquivo", exact: true }).click();
        await modal.getByRole("combobox", { name: "Empresa da filial 1", exact: true }).click();
        await modal.getByRole("option", { name: "Empresa teste", exact: true }).click();
        await modal.getByRole("combobox", { name: "Tipo da filial 1", exact: true }).waitFor();
        await modal.getByRole("combobox", { name: "Empresa da filial 1", exact: true }).click();
        await modal.getByRole("option", { name: "Empresa segunda", exact: true }).click();
        await modal.getByRole("combobox", { name: "Dinheiro da filial 1", exact: true }).click();
        assert.equal(await modal.getByRole("option").filter({ hasText: "Banco teste" }).count(), 0);
        await modal.getByRole("option", { name: "Banco segundo — Forma segunda", exact: true }).click();
        await modal.getByRole("combobox", { name: "Empresa da filial 1", exact: true }).click();
        await modal.getByRole("option", { name: "Empresa teste", exact: true }).click();
        assert.equal(await modal.getByRole("combobox", { name: "Dinheiro da filial 1", exact: true }).inputValue(), "");
        for (const [index, label] of ["Dinheiro", "Cartão", "Banco/Pix", "Outros"].entries()) {
            const combo = modal.getByRole("combobox", { name: `${label} da filial 1`, exact: true });
            await combo.click();
            assert.equal(await modal.getByRole("option").filter({ hasText: /Banco teste/ }).count(), 4 - index);
            await modal.getByRole("option").filter({ hasText: /Banco teste/ }).first().click();
        }
        await modal.getByRole("button", { name: "Conferir prévia", exact: true }).click();
        await modal.getByRole("heading", { name: "Pendências (2)", exact: true }).waitFor();
        const existing = modal.locator(".cash-import-existing");
        assert.equal(await existing.getAttribute("open"), null);
        await existing.locator("summary").click();
        assert.match(await existing.innerText(), /06\/01\/2025/);
        assert.equal(await existing.locator("ul").evaluate(element => getComputedStyle(element).maxHeight), "240px");
        await existing.locator("summary").click();
        const first = () => modal.locator(".cash-import-pending").filter({ hasText: "03/01/2025" });
        await first().getByRole("button", { name: "Fazer manualmente" }).click();
        assert.equal(await modal.locator('input[type="date"]').inputValue(), "2025-01-03");
        assert.equal(await modal.locator('input[type="number"]').first().inputValue(), "60");
        assert.equal(await modal.locator(".daily-cash-entries li").count(), 2); // Formulário mantém a paginação existente.
        await modal.getByRole("button", { name: "Cancelar", exact: true }).click();
        assert.equal(manualCalls, 0);
        await first().getByRole("button", { name: "Fazer manualmente" }).click();
        // Fechar pelo cabeçalho também retorna à importação, sem perder a prévia.
        await modal.getByRole("button", { name: "Fechar cadastro", exact: true }).click();
        await modal.getByRole("heading", { name: "Pendências (2)", exact: true }).waitFor();
        await first().getByRole("button", { name: "Fazer manualmente" }).click();
        await modal.getByRole("button", { name: "Gravar Caixa Diário", exact: true }).click();
        await modal.getByRole("alert").filter({ hasText: "Falha controlada" }).waitFor();
        assert.equal(await modal.locator('input[type="number"]').first().inputValue(), "60");
        await modal.getByRole("button", { name: "Gravar Caixa Diário", exact: true }).click();
        await modal.getByRole("heading", { name: "Pendências (1)", exact: true }).waitFor();
        assert.equal(await first().count(), 0);
        await modal.getByRole("button", { name: "Não importar este dia", exact: true }).click();
        await modal.getByRole("heading", { name: "Pendências (0)", exact: true }).waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
        await modal.getByRole("button", { name: "Confirmar importação de 1 caixas", exact: true }).click();
        await modal.getByRole("status").filter({ hasText: "1 caixas importados" }).waitFor();
        assert.equal(importCalls, 1); assert.equal(manualCalls, 2);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await modal.getByRole("button", { name: "Fechar cadastro", exact: true }).click();
        await page.getByLabel("Filtrar por empresa", { exact: true }).selectOption(secondCompany);
        for (const name of ["Receber", "Pagar", "Caixa Diário"]) {
            await page.locator(".account-create-buttons").getByRole("button", { name, exact: true }).click();
            assert.equal(await page.getByLabel("Empresa do cadastro", { exact: true }).inputValue(), secondCompany);
            await page.getByRole("button", { name: "Fechar cadastro", exact: true }).click();
        }
        await page.getByRole("button", { name: "Pessoas", exact: true }).click();
        await page.locator(".page-heading > button").click();
        assert.equal(await page.getByLabel("Empresa do cadastro", { exact: true }).inputValue(), secondCompany);
        await page.getByRole("button", { name: "Fechar cadastro", exact: true }).click();
        await page.getByLabel("Filtrar por empresa", { exact: true }).selectOption("");
        await page.locator(".page-heading > button").click();
        assert.equal(await page.getByLabel("Empresa do cadastro", { exact: true }).inputValue(), company);
        await page.getByRole("button", { name: "Fechar cadastro", exact: true }).click();
        await page.getByRole("button", { name: "Contas", exact: true }).click();
        await page.getByRole("button", { name: "Importar caixa diário", exact: true }).click();
        const historicalFile = [cashHeader + ';Receita_Service;Receita_Zaal;Despesas',
            ['1','8/1/2025','Service/Zaal','','R$ 0,00','','','R$ 900,00','R$ 700,00','R$ 100,10','R$ 20,20','R$ 10,05'].join(';'),
            ['1','9/1/2025','Service/Zaal','','','','','','','R$ 10,00','','R$ 15,00'].join(';')].join('\r\n');
        await modal.locator('input[type="file"]').setInputFiles({ name: 'historico.txt', mimeType: 'text/plain', buffer: Buffer.from(historicalFile) });
        await modal.getByLabel('Data inicial', { exact: true }).fill('2025-01-01');
        await modal.getByRole('button', { name: 'Analisar arquivo', exact: true }).click();
        await modal.getByRole('combobox', { name: 'Empresa da filial 1', exact: true }).click();
        await modal.getByRole('option', { name: 'Empresa teste', exact: true }).click();
        assert.equal(await modal.getByRole('combobox', { name: 'Dinheiro da filial 1', exact: true }).count(), 0);
        await modal.getByRole('button', { name: 'Conferir prévia', exact: true }).click();
        await modal.getByRole('heading', { name: 'Pendências (1)', exact: true }).waitFor();
        await modal.locator('summary').filter({ hasText: 'Ver todos os dias' }).click();
        assert.match(await modal.locator('table').innerText(), /Baixa histórica/);
        assert.match(await modal.locator('table').innerText(), /110,25/);
        assert.match(await modal.locator('table').innerText(), /-R\$\s*5,00/);
        await modal.getByRole('button', { name: 'Fazer manualmente', exact: true }).click();
        assert.equal(await modal.locator('input[type="date"]').inputValue(), '2025-01-09');
        assert.equal(await modal.locator('input[type="number"]').first().inputValue(), '0');
        assert.equal(await modal.locator('.daily-cash-entries li').count(), 0);
        await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
        await modal.getByRole('heading', { name: 'Pendências (1)', exact: true }).waitFor();
        assert.deepEqual(errors, []);
        console.log("PASS UI: upload, data, filial, exclusividade das formas, prévia, cancelamento, falha e sucesso manual, pendência ignorada, confirmação e largura móvel.");
    } catch (error) { console.error("Erros do navegador:", errors); console.error((await page.locator("body").innerText()).slice(0, 2500)); throw error; }
    finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
