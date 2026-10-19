// Auditoria opt-in, sem screenshots/traces. Requer o frontend local em execução.
// node --import tsx tests/company-modals.audit.ts
import assert from "node:assert/strict";
import { chromium, type Locator } from "playwright";
import { randomUUID } from "node:crypto";
import { resources, baixasResource } from "../../frontend/src/data/resources";
import type { Resource, Row } from "../../frontend/src/types";

async function run() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(6000);
    const companies = ["A", "B"].map(nome => ({ id: randomUUID(), nome: `Empresa ${nome}`, perfil: "comum", licenca_status: "ativa", identificador: nome }));
    const [a, b] = companies;
    const rows: Record<string, Row[]> = Object.fromEntries(resources.map(resource => [resource.endpoint, []]));
    const due = new Date().toISOString().slice(0, 7) + "-28";
    const ref: Record<string, Record<string, string>> = {};
    for (const company of companies) {
        const ids = Object.fromEntries(["pessoa", "banco", "forma", "plano", "pagar", "receber", "recebimento", "pagamento", "semBaixa"].map(key => [key, randomUUID()]));
        ref[company.id] = ids;
        const push = (endpoint: string, row: Row) => rows[endpoint]!.push({ empresa_id: company.id, created_at: due, ...row });
        push("/pessoas", { id: ids.pessoa, nome: `${company.identificador} pessoa`, cliente: true, fornecedor: false });
        push("/bancos", { id: ids.banco, descricao: `${company.identificador} banco`, ativo: true });
        push("/formas-pagamento", { id: ids.forma, descricao: `${company.identificador} forma`, tipo: "pix", banco_id: ids.banco, ativo: true });
        push("/planos-contas", { id: ids.plano, descricao: `${company.identificador} plano` });
        for (const tipo of ["pagar", "receber"]) push("/lancamentos", { id: ids[tipo], descricao: `${company.identificador} ${tipo}`, tipo, valor: 1000, saldo: 990, status: "parcial", numero: tipo === "pagar" ? 1 : 2, data_vencimento: due, competencia: due.slice(0, 7) + "-01", pessoa_id: ids.pessoa, plano_conta_id: ids.plano });
        push("/lancamentos", { id: ids.semBaixa, descricao: `${company.identificador} sem baixa`, tipo: "pagar", valor: 1000, saldo: 1000, status: "pendente", numero: 3, data_vencimento: due, competencia: due.slice(0, 7) + "-01" });
        push("/movimentacoes", { id: ids.pagamento, lancamento_id: ids.pagar, forma_pagamento_id: ids.forma, valor: 10, data_movimentacao: due });
        push("/recebimentos", { id: ids.recebimento, lancamento_id: ids.receber, forma_pagamento_id: ids.forma, valor: 10, data_recebimento: due });
    }
    const writes: { method: string; endpoint: string; empresa: string; body: Row }[] = [];
    const errors: string[] = [];
    const failures: { scenario: string; error: string }[] = [];
    let passed = 0;
    page.on("pageerror", error => errors.push(error.message));
    const base = process.env.AUDIT_FRONTEND_URL || "http://127.0.0.1:5173";
    try {
        await page.route("**/*", async route => {
            const request = route.request();
            const url = new URL(request.url());
            if (request.resourceType() === "document") return route.continue();
            if (url.pathname === "/auth/me") return route.fulfill({ json: { data: { id: "company-modal-audit", nome: "Auditoria", email: "audit@invalid", role: "comum" } } });
            if (url.pathname === "/empresas") return route.fulfill({ json: { data: companies } });
            if (url.pathname === "/caixa") return route.fulfill({ json: { data: [] } });
            const endpoint = Object.keys(rows).find(path => url.pathname === path || url.pathname.startsWith(path + "/"));
            if (!endpoint) return route.continue();
            const empresa = request.headers()["x-empresa-id"]!;
            if (!companies.some(company => company.id === empresa)) return route.fulfill({ status: 403, json: { message: "Empresa inválida" } });
            if (request.method() === "GET") return route.fulfill({ json: { data: rows[endpoint]!.filter(row => row.empresa_id === empresa) } });
            const body: Row = request.postDataJSON();
            writes.push({ endpoint: url.pathname, method: request.method(), empresa, body });
            for (const [field, path] of [["pessoa_id", "/pessoas"], ["banco_id", "/bancos"], ["plano_conta_id", "/planos-contas"], ["forma_pagamento_id", "/formas-pagamento"], ["lancamento_id", "/lancamentos"]]) {
                if (body[field] && !rows[path!]!.some(row => row.id === body[field] && row.empresa_id === empresa)) return route.fulfill({ status: 400, json: { message: "Referência de outra empresa" } });
            }
            if (request.method() === "PATCH") {
                const id = url.pathname.split("/").at(-1);
                const row = rows[endpoint]!.find(item => item.id === id && item.empresa_id === empresa);
                if (!row) return route.fulfill({ status: 404, json: { message: "Registro de outra empresa" } });
                Object.assign(row, body);
                return route.fulfill({ json: { id } });
            }
            const id = randomUUID();
            rows[endpoint]!.push({ ...body, id, empresa_id: empresa, numero: 99, status: "pendente", created_at: new Date().toISOString() });
            return route.fulfill({ json: { id, ...(url.pathname.endsWith("parcelado") ? { ids: [id], parcelas: 2 } : {}) } });
        });
        async function choose(dialog: Locator, label: string, option: string) {
            await dialog.getByRole("combobox", { name: label, exact: true }).click();
            await page.getByRole("option", { name: option, exact: true }).click();
        }
        async function navigate(title: string) {
            await page.getByRole("button", { name: title, exact: true }).click();
            await page.locator(".page-heading h1").waitFor();
            await page.locator(".table-loading").waitFor({ state: "hidden" });
        }
        async function create(_resource: Resource) {
            await page.locator(".page-heading > button").click();
            return page.getByRole("dialog");
        }
        async function scenario(name: string, action: () => Promise<void>) {
            if (process.env.AUDIT_SCENARIOS && !name.includes(process.env.AUDIT_SCENARIOS)) return;
            try { await action(); passed++; }
            catch (error) { failures.push({ scenario: name, error: error instanceof Error ? error.message : String(error) }); }
            finally {
                const close = page.locator(".modal-backdrop .modal-head .icon-button");
                while (await close.count()) await close.last().click();
            }
        }
        async function submit(dialog: Locator, expectedCompany: string, method: string) {
            const before = writes.length;
            await dialog.locator(".modal-actions").last().locator("button.button-primary").click();
            await dialog.waitFor({ state: "hidden" });
            assert.equal(writes.length, before + 1);
            assert.equal(writes.at(-1)!.empresa, expectedCompany);
            assert.equal(writes.at(-1)!.method, method);
        }
        async function fill(resource: Resource, dialog: Locator, company = b!) {
            if (resource.key === "pessoas") {
                await dialog.locator('input[name="nome"]').fill("Pessoa nova");
                await dialog.locator(".role-choice").first().click();
            } else if (resource.key === "lancamentos") {
                await dialog.getByRole("combobox", { name: "Descrição", exact: true }).fill("Conta nova");
                await dialog.locator('input[name="valor"]').fill("20");
                await choose(dialog, "Tipo", "A pagar");
                await dialog.locator('input[name="data_vencimento"]').fill(due);
                await choose(dialog, "Cliente", `${company.identificador} pessoa`);
                await choose(dialog, "Plano de contas", `${company.identificador} plano`);
            } else if (resource.key === "baixas") {
                const combo = dialog.getByRole("combobox", { name: "Cliente ou descrição da conta", exact: true });
                await combo.click();
                await page.getByRole("option").filter({ hasText: `${company.identificador} pagar` }).first().click();
                await choose(dialog, "Forma de pagamento", `${company.identificador} forma`);
                await dialog.locator('input[name="valor"]').fill("1");
            } else {
                await dialog.locator('input[name="descricao"]').fill("Registro novo");
                if (resource.key === "formas") {
                    await choose(dialog, "Tipo", "Pix");
                    await choose(dialog, "Instituição", `${company.identificador} banco`);
                }
            }
        }
        await page.goto(base);
        await page.getByRole("button", { name: "Nova conta", exact: true }).waitFor();
        await page.locator(".company-switch").click();
        await page.getByRole("checkbox", { name: "Empresa B", exact: true }).check();
        await page.locator("h1").click();
        const audited = [...resources.filter(resource => ["pessoas", "formas", "bancos", "planos", "lancamentos"].includes(resource.key)), baixasResource];
        for (const resource of audited) {
            await navigate(resource.title);
            await scenario(`${resource.title}: criação escolhe B com filtro em B e opções A/B`, async () => {
                await page.getByLabel("Filtrar por empresa").selectOption(b!.id);
                const dialog = await create(resource);
                const select = dialog.getByLabel("Empresa do cadastro");
                assert.equal(await select.inputValue(), a!.id, "Cadastro deve iniciar na primeira marcada, independentemente do filtro");
                assert.deepEqual(await select.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)), [a!.id, b!.id]);
                await select.selectOption(b!.id);
                await fill(resource, dialog);
                await submit(dialog, b!.id, "POST");
            });
            for (const filter of ["", a!.id]) await scenario(`${resource.title}: edição de B preserva origem com filtro ${filter ? "A alterado com modal aberto" : "Todas marcadas"}`, async () => {
                await page.getByLabel("Filtrar por empresa").selectOption("");
                const text = resource.key === "pessoas" ? "B pessoa" : resource.key === "bancos" ? "B banco" : resource.key === "formas" ? "B forma" : resource.key === "planos" ? "B plano" : "B pagar";
                await page.locator(".resource-table tbody tr").filter({ hasText: text }).first().click();
                const dialog = page.getByRole("dialog");
                assert.equal(await dialog.getByLabel("Empresa do cadastro").count(), 0, "Edição não deve permitir transferir o registro");
                if (filter) await page.getByLabel("Filtrar por empresa").evaluate((select, value) => { (select as HTMLSelectElement).value = value; select.dispatchEvent(new Event("change", { bubbles: true })); }, filter);
                await submit(dialog, b!.id, "PATCH");
            });
        }
        await navigate("Baixas");
        await scenario("Complementar: criação de recebimento usa B", async () => {
            const dialog = await create(baixasResource);
            await dialog.getByLabel("Empresa do cadastro").selectOption(b!.id);
            await dialog.getByRole("combobox", { name: "Cliente ou descrição da conta", exact: true }).click();
            await page.getByRole("option").filter({ hasText: "B receber" }).first().click();
            await choose(dialog, "Forma de pagamento", "B forma");
            await dialog.locator('input[name="valor"]').fill("1");
            await submit(dialog, b!.id, "POST");
            assert.equal(writes.at(-1)!.endpoint, "/recebimentos");
        });
        await scenario("Complementar: edição de recebimento preserva B com filtro A", async () => {
            await page.getByLabel("Filtrar por empresa").selectOption("");
            await page.locator(".resource-table tbody tr").filter({ hasText: "B receber" }).first().click();
            const dialog = page.getByRole("dialog");
            await page.getByLabel("Filtrar por empresa").evaluate((select, value) => { (select as HTMLSelectElement).value = value; select.dispatchEvent(new Event("change", { bubbles: true })); }, a!.id);
            await submit(dialog, b!.id, "PATCH");
            assert.ok(writes.at(-1)!.endpoint.startsWith("/recebimentos/"));
        });
        await navigate("Contas");
        for (const overlay of [false, true]) await scenario(`Complementar: baixa ${overlay ? "sobre detalhes" : "direta"} da conta usa B`, async () => {
            await page.getByLabel("Filtrar por empresa").selectOption("");
            const row = page.locator(".resource-table tbody tr").filter({ hasText: overlay ? "B pagar" : "B sem baixa" }).first();
            await row.locator(".settle-row-button").click();
            if (overlay) await page.getByRole("dialog").getByRole("button", { name: "Dar baixa", exact: true }).click();
            const dialog = overlay ? page.getByRole("dialog", { name: "Registrar baixa", exact: true }) : page.getByRole("dialog").last();
            await dialog.getByRole("combobox", { name: "Forma de pagamento", exact: true }).click();
            assert.equal(await page.getByRole("option", { name: "A forma", exact: true }).count(), 0);
            await page.getByRole("option", { name: "B forma", exact: true }).click();
            await dialog.locator('input[name="valor"]').fill("1");
            await submit(dialog, b!.id, "POST");
            assert.equal(writes.at(-1)!.endpoint, `/lancamentos/${ref[b!.id]![overlay ? "pagar" : "semBaixa"]}/baixar`);
        });
        await navigate("Contas");
        await page.getByLabel("Filtrar por empresa").selectOption("");
        await scenario("Contas: troca A→B limpa cliente, descrição, plano e forma", async () => {
            const dialog = await create(resources[0]!);
            for (const [label, option] of [["Cliente", "A pessoa"], ["Plano de contas", "A plano"], ["Forma para baixa imediata", "A forma"]]) await choose(dialog, label!, option!);
            await dialog.getByRole("combobox", { name: "Descrição", exact: true }).fill("Descrição A");
            await dialog.getByLabel("Empresa do cadastro").selectOption(b!.id);
            for (const name of ["Cliente", "Descrição", "Plano de contas", "Forma para baixa imediata"]) assert.equal(await dialog.getByRole("combobox", { name, exact: true }).inputValue(), "");
            for (const [label, expected, forbidden] of [["Cliente", "B pessoa", "A pessoa"], ["Plano de contas", "B plano", "A plano"], ["Forma para baixa imediata", "B forma", "A forma"], ["Descrição", "B pagar", "A pagar"]]) {
                await dialog.getByRole("combobox", { name: label!, exact: true }).click();
                assert.equal(await page.getByRole("option", { name: expected, exact: true }).count(), 1);
                assert.equal(await page.getByRole("option", { name: forbidden, exact: true }).count(), 0);
            }
        });
        await scenario("Contas: cadastro rápido de cliente usa empresa B", async () => {
            const dialog = await create(resources[0]!);
            await dialog.getByLabel("Empresa do cadastro").selectOption(b!.id);
            await dialog.getByRole("combobox", { name: "Cliente", exact: true }).fill("Cliente inline novo");
            await dialog.getByRole("button", { name: "Adicionar cliente", exact: true }).click();
            await dialog.getByRole("button", { name: "Salvar cliente", exact: true }).click();
            await dialog.locator(".inline-client").waitFor({ state: "hidden" });
            assert.equal(writes.at(-1)!.empresa, b!.id);
            assert.equal(writes.at(-1)!.endpoint, "/pessoas");
        });
        // Os estados de visibilidade/habilitação são exercitados em cada formulário.
        await page.locator(".company-switch").click();
        await page.getByRole("checkbox", { name: "Empresa A", exact: true }).uncheck();
        await page.locator("h1").click();
        for (const resource of audited) {
            await navigate(resource.title);
            await scenario(`${resource.title}: somente B marcada desabilita e grava em B`, async () => {
                const dialog = await create(resource);
                assert.ok(await dialog.getByLabel("Empresa do cadastro").isDisabled());
                assert.equal(await dialog.getByLabel("Empresa do cadastro").inputValue(), b!.id);
                await fill(resource, dialog);
                await submit(dialog, b!.id, "POST");
            });
        }
        companies.splice(0, 1);
        await page.reload();
        await page.locator(".page-heading h1").waitFor();
        for (const resource of audited) {
            await navigate(resource.title);
            await scenario(`${resource.title}: uma vinculada oculta e grava em B`, async () => {
                assert.equal(await page.getByLabel("Filtrar por empresa").count(), 0);
                const dialog = await create(resource);
                assert.equal(await dialog.getByLabel("Empresa do cadastro").count(), 0);
                await fill(resource, dialog);
                await submit(dialog, b!.id, "POST");
            });
        }
        if (errors.length) failures.push({ scenario: "erros JavaScript", error: errors.join("; ") });
        console.log(JSON.stringify({ mode: "frontend real e API simulada, sem capturas", passed, failed: failures.length, failures }, null, 2));
        if (failures.length) process.exitCode = 1;
    } finally { await browser.close(); }
}
run().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
