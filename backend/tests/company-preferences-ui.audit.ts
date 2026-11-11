// Opt-in: frontend local e API inteiramente simulada; nenhuma escrita financeira real.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium, type Route } from "playwright";
import type { Company, Row } from "../../frontend/src/types";

const output = process.env.AUDIT_OUTPUT || "../.audit/company-preferences";
async function run() {
    await mkdir(output, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: "America/Sao_Paulo" });
    page.setDefaultTimeout(10000);
    const companies: Company[] = [
        { id: randomUUID(), nome: "Empresa A — Serviços e assistência técnica", identificador: "A", perfil: "comum", licenca_status: "ativa", contas_modo_valor: "total", vencimento_dias_urgente: 1, vencimento_dias_atencao: 7, avisar_contas_vencidas: false },
        { id: randomUUID(), nome: "Empresa B — Comércio e distribuição", identificador: "B", perfil: "comum", licenca_status: "ativa", contas_modo_valor: "parcela", vencimento_dias_urgente: 3, vencimento_dias_atencao: 10, avisar_contas_vencidas: false },
    ];
    const [a, b] = companies;
    const people = companies.map(company => ({ id: randomUUID(), empresa_id: company.id, nome: "Cliente com nome longo para revisão de legibilidade no celular", cliente: true, fornecedor: true }));
    const plans = companies.map(company => ({ id: randomUUID(), empresa_id: company.id, descricao: "Serviços de manutenção e suporte prolongado", tipo: "ambos" }));
    const bank = { id: randomUUID(), empresa_id: a.id, descricao: "Instituição válida da origem" };
    const accounts: Row[] = [
        ...[[-1, "pagar", "pendente"], [0, "receber", "parcial"], [2, "pagar", "pendente"], [8, "receber", "pendente"], [-2, "pagar", "pago"], [-3, "receber", "cancelado"]].map(([offset, tipo, status], index) => {
            const day = new Date("2026-11-11T00:00:00Z"); day.setUTCDate(day.getUTCDate() + Number(offset));
            return { id: randomUUID(), numero: index + 1, empresa_id: a.id, empresa_identificador: "A", descricao: `Conta ${index + 1} — manutenção de equipamentos e serviços com descrição bastante longa`,
                tipo: String(tipo), status: String(status), valor: 120, desconto: 10, acrescimo: 5, saldo: status === "pago" ? 0 : 115,
                pessoa_id: people[0].id, pessoa_nome: people[0].nome, plano_conta_id: plans[0].id, plano_conta_descricao: plans[0].descricao,
                banco_id: index < 2 ? bank.id : index === 2 ? "banco-reservado" : null,
                data_vencimento: day.toISOString(), competencia: "2026-11-01T00:00:00Z", num_doc: "DOC-123", observacoes: "Observações da conta original.",
                grupo_parcelamento_id: "grupo-origem", numero_parcela: 2, total_parcelas: 3, quantidade_baixas: status === "parcial" || status === "pago" ? 1 : 0 };
        }),
        { id: randomUUID(), numero: 7, empresa_id: b.id, empresa_identificador: "B", descricao: "Conta da empresa B", tipo: "receber", status: "pendente", valor: 90, saldo: 90, data_vencimento: "2026-11-13", competencia: "2026-11-01" },
    ];
    const original = structuredClone(accounts);
    const writes: { path: string; company: string; body: Row }[] = [];
    const reads: string[] = [], errors: string[] = [];
    let releaseOldSearch: (() => void) | undefined;
    page.on("pageerror", error => errors.push(error.message));
    async function mockApi(route: Route) {
        const request = route.request(), url = new URL(request.url()), path = url.pathname, scope = request.headers()["x-empresa-id"] || "";
        if (url.origin === "http://127.0.0.1:5173") return route.continue();
        const list = (data: Row[]) => route.fulfill({ json: { data, meta: { pagina: 1, paginas: 1, total: data.length, pagar: 230, receber: 320 }, saldo_atual: 0 } });
        if (request.method() === "GET") {
            reads.push(path + url.search);
            if (path === "/auth/me") return route.fulfill({ json: { data: { id: "preferences-audit", nome: "Auditoria", email: "auditoria@invalid.test", role: "comum" } } });
            if (path === "/empresas") return route.fulfill({ json: { data: companies } });
            if (path.startsWith("/bancos/")) return path.endsWith(bank.id) ? route.fulfill({ json: { data: bank } }) : route.fulfill({ status: 404, json: { message: "Cadastro reservado à importação" } });
            if (path === "/lancamentos" && url.searchParams.has("resumo")) return route.fulfill({ json: { data: { rows: accounts, flowRows: [], overdueRows: [accounts[0]], overdue: 1, automaticOverdue: a.avisar_contas_vencidas ? 1 : 0, pagar: 230, receber: 320, totalPaid: 0 } } });
            if (path.startsWith("/lancamentos/")) return route.fulfill({ json: { data: accounts.find(row => row.id === path.split("/").at(-1) && row.empresa_id === scope) } });
            const scopeIds = (url.searchParams.get("empresas") || scope).split(",");
            if (path === "/lancamentos") {
                let rows = accounts.filter(row => scopeIds.includes(String(row.empresa_id)));
                if (url.searchParams.get("busca")) rows = rows.filter(row => String(row.descricao).includes(url.searchParams.get("busca")!));
                if (url.searchParams.get("busca") === "antiga") await new Promise<void>(resolve => { releaseOldSearch = resolve; });
                return list(rows);
            }
            if (path === "/pessoas") return list(people.filter(row => scopeIds.includes(row.empresa_id)));
            if (path === "/planos-contas") return list(plans.filter(row => scopeIds.includes(row.empresa_id)));
            if (path === "/bancos") return list(scopeIds.includes(bank.empresa_id) ? [bank] : []);
            return list([]);
        }
        const body = request.postDataJSON() as Row;
        writes.push({ path, company: scope, body });
        if (path.startsWith("/empresas/")) {
            Object.assign(companies.find(company => company.id === scope)!, body);
            return route.fulfill({ json: { id: scope } });
        }
        if (path === "/lancamentos") {
            const id = randomUUID();
            accounts.push({ ...body, id, empresa_id: scope, numero: 8, saldo: body.valor, status: "pendente" });
            return route.fulfill({ status: 201, json: { id } });
        }
        return route.fulfill({ status: 400, json: { message: "Operação não prevista na auditoria" } });
    }
    await page.route("**/*", mockApi);
    await page.addInitScript(ids => localStorage.setItem("fluxo-companies:preferences-audit", JSON.stringify(ids)), [a.id, b.id]);
    await page.clock.setFixedTime(new Date("2026-11-11T15:00:00Z"));
    const shot = (name: string) => page.screenshot({ path: `${output}/${name}.png`, fullPage: false });
    const noOverflow = async (label: string) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, label);
    try {
        await page.goto("http://127.0.0.1:5173/lancamentos");
        await page.locator(".resource-lancamentos tbody tr").first().waitFor();
        assert.equal(await page.locator(".due-urgent").count(), 3);
        assert.equal(await page.locator(".due-attention").count(), 1);
        assert.equal(await page.locator(".status-cancelado").count(), 1);
        assert.equal(reads.filter(path => /^\/(pessoas|planos-contas|bancos|formas-pagamento)/.test(path)).length, 0, "cadastros não são carregados antecipadamente");
        assert.equal(await page.locator(".notification-popover").count(), 0, "aviso automático desativado");
        await page.getByRole("button", { name: "Notificações", exact: true }).click();
        await page.locator(".notification-popover").waitFor();
        await page.getByRole("button", { name: "Fechar notificações", exact: true }).click();
        await page.mouse.move(900, 850);
        const actionBox = await page.locator(".launch-actions").first().boundingBox();
        assert.ok(actionBox && actionBox.x > 72 && actionBox.x + actionBox.width <= 1440, "ações ficam visíveis sem rolagem horizontal");
        await shot("contas-desktop");
        await page.getByRole("button", { name: "Baixa rápida", exact: true }).first().click();
        await page.getByRole("combobox", { name: "Forma de pagamento da baixa rápida", exact: true }).waitFor();
        const quickBox = await page.locator(".quick-settlement").boundingBox();
        assert.ok(quickBox && quickBox.x >= 72 && quickBox.x + quickBox.width <= 1440, "baixa rápida continua acessível com ações fixas");
        await page.getByRole("button", { name: "Cancelar baixa rápida", exact: true }).click();
        const clone = page.getByRole("button", { name: `Clonar conta: ${accounts[1].descricao}`, exact: true });
        await clone.click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("heading", { name: "Nova Conta a Receber", exact: true }).waitFor();
        assert.equal(writes.length, 0, "abrir o clone não grava");
        assert.equal(await dialog.locator('input[name="valor"]').inputValue(), "115");
        assert.equal(await dialog.locator('input[name="parcelas"]').inputValue(), "1");
        assert.equal(await dialog.locator('input[name="data_vencimento"]').inputValue(), "2026-11-11");
        assert.equal(await dialog.locator('input[name="competencia"]').inputValue(), "nov/2026");
        assert.equal(await dialog.locator('input[name="pessoa_id"]').inputValue(), people[0].id);
        assert.equal(await dialog.locator('input[name="plano_conta_id"]').inputValue(), plans[0].id);
        assert.equal(await dialog.locator('input[name="banco_id"]').inputValue(), bank.id);
        assert.equal(await dialog.locator('textarea[name="observacoes"]').inputValue(), accounts[1].observacoes);
        await dialog.getByRole("combobox", { name: "Empresa do cadastro" }).selectOption(b.id);
        assert.equal(await dialog.getByRole("radio", { name: "Informar valor de cada parcela", exact: true }).isChecked(), true);
        assert.equal(await dialog.locator('input[name="pessoa_id"]').inputValue(), "");
        assert.equal(await dialog.locator('input[name="plano_conta_id"]').inputValue(), "");
        await dialog.locator('input[name="parcelas"]').fill("3");
        assert.match(await dialog.locator(".installment-total").innerText(), /345,00/);
        await dialog.getByRole("combobox", { name: "Empresa do cadastro" }).selectOption(a.id);
        assert.equal(await dialog.getByRole("radio", { name: "Informar valor total", exact: true }).isChecked(), true);
        assert.match(await dialog.locator(".installment-total").innerText(), /115,00/);
        await dialog.locator('input[name="parcelas"]').fill("1");
        // Retornar à origem não restaura cadastros que foram removidos ao trocar de empresa.
        assert.equal(await dialog.locator('input[name="pessoa_id"]').inputValue(), "");
        await dialog.getByRole("combobox", { name: "Descrição", exact: true }).fill("Clone revisado");
        await shot("clone-desktop");
        await dialog.getByRole("button", { name: /^Gravar →$/ }).click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(writes.at(-1)!.path, "/lancamentos");
        assert.equal(writes.at(-1)!.company, a.id);
        assert.equal(writes.at(-1)!.body.tipo, "receber");
        assert.equal(writes.at(-1)!.body.valor, 115);
        for (const field of ["id", "status", "grupo_parcelamento_id", "numero_parcela", "total_parcelas", "importacao_id", "baixas_pendentes"]) assert.equal(field in writes.at(-1)!.body, false);
        assert.deepEqual(accounts.slice(0, original.length), original, "a origem não foi alterada");
        await page.getByRole("button", { name: `Clonar conta: ${accounts[0].descricao}`, exact: true }).click();
        await dialog.locator('input[name="banco_id"]').waitFor({ state: "attached" });
        await dialog.getByRole("combobox", { name: "Descrição", exact: true }).fill("Clone com instituição");
        await dialog.getByRole("button", { name: /^Gravar →$/ }).click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(writes.at(-1)!.body.banco_id, bank.id, "vínculo válido com a instituição é preservado");
        await page.getByRole("button", { name: `Clonar conta: ${accounts[2].descricao}`, exact: true }).click();
        await dialog.locator('input[name="valor"]').waitFor();
        assert.equal(await dialog.locator('input[name="banco_id"]').count(), 0, "instituição interna indisponível não é propagada");
        await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        const search = page.getByRole("searchbox", { name: "Buscar cliente ou descrição", exact: true });
        const oldRequest = page.waitForRequest(request => new URL(request.url()).searchParams.get("busca") === "antiga");
        await search.fill("antiga");
        await oldRequest;
        await search.fill("Clone revisado");
        await page.locator(".resource-lancamentos tbody tr").filter({ hasText: "Clone revisado" }).waitFor();
        releaseOldSearch?.();
        await page.waitForTimeout(100);
        assert.equal(await page.locator(".resource-lancamentos tbody tr").count(), 1, "resposta antiga não substitui a busca atual");
        await search.fill("");
        await page.waitForFunction(() => document.querySelectorAll(".resource-lancamentos tbody tr").length > 1);

        await page.getByRole("combobox", { name: "Filtrar por empresa" }).selectOption(b.id);
        await page.getByRole("button", { name: /Selecionar empresa:/ }).click();
        await page.getByRole("button", { name: "Configurações da empresa", exact: true }).click();
        await dialog.locator('input[name="nome"]').waitFor();
        assert.equal(await dialog.getByRole("combobox", { name: "Empresa do cadastro" }).inputValue(), b.id);
        await dialog.locator('[name="vencimento_dias_urgente"]').fill("4");
        await dialog.locator('[name="vencimento_dias_atencao"]').fill("4");
        assert.equal(await dialog.locator("form").evaluate(form => (form as HTMLFormElement).checkValidity()), false);
        await dialog.locator('[name="vencimento_dias_atencao"]').fill("12");
        await dialog.locator('[name="contas_modo_valor"]').selectOption("total");
        await dialog.locator('[name="caixa_data_inicio"]').fill("2026-01-01");
        await shot("configuracoes-desktop");
        const readsBeforeSettings = reads.length;
        await dialog.getByRole("button", { name: /Salvar alterações/ }).click();
        await dialog.waitFor({ state: "hidden" });
        assert.deepEqual(reads.slice(readsBeforeSettings), ["/empresas"], "preferências de cadastro não recarregam contas, alertas ou cadastros auxiliares");
        assert.equal(writes.at(-1)!.company, b.id);
        assert.equal(await page.getByRole("combobox", { name: "Filtrar por empresa" }).inputValue(), b.id, "salvar preserva o filtro atual");
        assert.equal(a.vencimento_dias_urgente, 1);
        assert.equal(b.vencimento_dias_urgente, 4);
        await page.getByRole("button", { name: "Pagar", exact: true }).click();
        await dialog.locator('input[name="parcelas"]').waitFor();
        assert.equal(await dialog.getByRole("radio", { name: "Informar valor total", exact: true }).isChecked(), true);
        await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });

        for (const width of [390, 360]) {
            await page.setViewportSize({ width, height: 844 });
            await page.goto("http://127.0.0.1:5173/lancamentos");
            await page.locator(".resource-lancamentos tbody tr").first().waitFor();
            await noOverflow(`Contas sem overflow em ${width}px`);
            await shot(`contas-mobile-${width}`);
            await page.getByRole("button", { name: /^Clonar conta:/ }).first().click();
            await dialog.locator('input[name="valor"]').waitFor();
            assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
            await dialog.getByRole("button", { name: /^Gravar →$/ }).scrollIntoViewIfNeeded();
            await shot(`clone-mobile-${width}`);
            await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
            await dialog.waitFor({ state: "hidden" });
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole("button", { name: "Abrir navegação", exact: true }).click();
        await page.getByRole("button", { name: /Selecionar empresa:/ }).click();
        await page.getByRole("button", { name: "Configurações da empresa", exact: true }).click();
        await dialog.locator('input[name="nome"]').waitFor();
        assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, "configurações sem overflow no celular");
        await dialog.locator('[name="avisar_contas_vencidas"]').check();
        await dialog.getByRole("button", { name: /Salvar alterações/ }).scrollIntoViewIfNeeded();
        await shot("configuracoes-mobile");
        await dialog.getByRole("button", { name: /Salvar alterações/ }).click();
        await dialog.waitFor({ state: "hidden" });
        await page.locator(".notification-popover").waitFor();
        await page.getByRole("button", { name: "Fechar notificações", exact: true }).click();
        // Revisão ampla das telas com fixtures sintéticas, em desktop e celular.
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 900 });
            for (const path of ["/", "/caixa", "/pessoas", "/bancos", "/formas-pagamento", "/planos-contas", "/tipos-caixa-diario", "/baixas"]) {
                await page.goto("http://127.0.0.1:5173" + path);
                await page.locator(".page-content").waitFor();
                await page.waitForFunction(() => !document.querySelector(".table-loading, .full-loader"));
                await noOverflow(`${path} sem overflow em ${width}px`);
                if (!["/", "/caixa"].includes(path)) {
                    await page.locator(".list-heading > .button-primary").click();
                    await dialog.locator(".form-grid").waitFor();
                    assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, `formulário ${path} sem overflow em ${width}px`);
                    const save = dialog.getByRole("button", { name: /^Cadastrar →$/ });
                    await save.scrollIntoViewIfNeeded();
                    const box = await save.boundingBox();
                    assert.ok(box && box.y >= 0 && box.y + box.height <= 900, `ação do formulário ${path} acessível`);
                    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
                    await dialog.waitFor({ state: "hidden" });
                }
            }
        }
        assert.deepEqual(errors, []);
        const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, timezoneId: "America/Sao_Paulo" });
        const phone = await touch.newPage();
        phone.on("pageerror", error => errors.push(error.message));
        await phone.route("**/*", mockApi);
        await phone.goto("http://127.0.0.1:5173/lancamentos");
        await phone.locator(".resource-lancamentos tbody tr").first().waitFor();
        await phone.getByRole("button", { name: /^Clonar conta:/ }).first().tap();
        await phone.getByRole("dialog").locator('input[name="valor"]').waitFor();
        await phone.screenshot({ path: `${output}/clone-toque.png` });
        await touch.close();
        assert.deepEqual(errors, []);
        console.log("OK: preferências por empresa, limites, clonagem sem escrita ao abrir e sem alterar origem, dependências, filtros preservados, carregamento sob demanda e revisão de 9 telas desktop/mobile.");
        console.log(`Capturas: ${output}`);
    } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
