// Frontend local com API simulada; sem gravações ou screenshots.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

async function run() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const company = randomUUID(), bank = randomUUID(), form = randomUUID();
    const calls: URLSearchParams[] = [], errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
        const url = new URL(route.request().url()), path = url.pathname;
        if (path === '/auth/me') return route.fulfill({ json: { data: { id: 'audit', email: 'audit@invalid', role: 'comum' } } });
        if (path === '/empresas') return route.fulfill({ json: { data: [{ id: company, nome: 'Empresa teste', perfil: 'comum', licenca_status: 'ativa' }] } });
        if (path === '/caixa') {
            calls.push(url.searchParams);
            if (url.searchParams.get('ordem') === 'data_baixa') assert.equal(url.searchParams.get('direcao'), 'asc');
            assert.equal(route.request().headers()['x-empresa-id'], company);
            const total = url.searchParams.get('mostrar_recebimentos') === 'false' ? 0 : url.searchParams.has('banco_id') ? 1 : url.searchParams.has('data_inicial') ? 51 : 123;
            const previous = url.searchParams.has('data_inicial') ? 35 : 0;
            const pages = Math.max(1, Math.ceil(total / 50));
            const current = url.searchParams.has('ultima_pagina') ? pages : Math.min(pages, Number(url.searchParams.get('pagina') || 1));
            const data = Array.from({ length: Math.min(50, Math.max(0, total - (current - 1) * 50)) }, (_, index) => {
                const n = (current - 1) * 50 + index;
                return { id: String(n), data: '2025-01-01', tipo: 'Entrada', descricao: `Movimento ${n + 1}`, valor: 1, saldo_antes: n + previous, saldo_depois: n + 1 + previous };
            });
            return route.fulfill({ json: { data, meta: { total, pagina: current, paginas: pages, saldo_anterior: previous }, saldo_atual: total + previous } });
        }
        if (path === '/lancamentos' && url.searchParams.has('resumo')) return route.fulfill({ json: { data: { rows: [], flowRows: [], overdueRows: [], overdue: 0, receber: 0, pagar: 0, totalPaid: 0 } } });
        if (['/bancos','/formas-pagamento','/lancamentos','/pessoas','/planos-contas'].includes(path)) {
            const data = path === '/bancos' ? [{ id: bank, empresa_id: company, descricao: 'Banco teste' }] : path === '/formas-pagamento' ? [{ id: form, banco_id: bank, empresa_id: company, descricao: 'Pix teste' }] : [];
            return route.fulfill({ json: { data, meta: { total: data.length, pagina: 1, paginas: 1 } } });
        }
        return route.continue();
    });
    try {
        await page.goto(process.env.AUDIT_FRONTEND_URL || 'http://127.0.0.1:5189');
        const open = () => page.getByRole('button', { name: 'Gestão de caixa', exact: true }).click();
        await open();
        await page.getByText('Página 3 de 3', { exact: true }).waitFor();
        assert.equal(calls.length, 1); // Não consulta a primeira página para descobrir o total.
        assert.equal(await page.locator('tbody tr').count(), 23);
        await page.getByRole('button', { name: 'Anterior', exact: true }).click();
        await page.getByText('Página 2 de 3', { exact: true }).waitFor();
        assert.equal(calls.at(-1)!.has('ultima_pagina'), false);
        await page.getByLabel('Data inicial', { exact: true }).fill('2025-01-01');
        await page.getByText('Página 2 de 2', { exact: true }).waitFor();
        assert.equal(calls.at(-1)!.get('ultima_pagina'), 'true');
        assert.match(await page.locator('.summary-card').nth(1).locator('strong').innerText(), /35,00/);
        await page.getByLabel('Data final', { exact: true }).fill('2025-01-31');
        await page.waitForRequest(request => request.url().includes('data_final=2025-01-31'));
        await page.getByRole('combobox', { name: 'Filtrar por banco', exact: true }).click();
        await page.getByRole('option', { name: 'Banco teste', exact: true }).click();
        await page.getByText('Página 1 de 1', { exact: true }).waitFor();
        await page.getByRole('combobox', { name: 'Filtrar por forma de pagamento', exact: true }).click();
        await page.getByRole('option', { name: 'Pix teste', exact: true }).click();
        await page.waitForRequest(request => request.url().includes(`forma_pagamento_id=${form}`));
        await page.getByRole('combobox', { name: 'Natureza do movimento', exact: true }).click();
        await page.getByRole('option', { name: 'Saídas', exact: true }).click();
        await page.getByText('Nenhuma movimentação no período', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
        await page.getByText('Página 3 de 3', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Anterior', exact: true }).click();
        await page.getByText('Página 2 de 3', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Contas', exact: true }).click(); await open();
        await page.getByText('Página 3 de 3', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Descrição', exact: true }).click();
        await page.waitForRequest(request => request.url().includes('ordem=descricao') && request.url().includes('direcao=asc'));
        await page.getByRole('button', { name: 'Descrição ↑', exact: true }).click();
        await page.waitForRequest(request => request.url().includes('ordem=descricao') && request.url().includes('direcao=desc'));
        await page.locator('.cash-input').fill('100');
        assert.match(await page.locator('.summary-main strong').innerText(), /223,00/);
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log('PASS caixa UI: última página em uma consulta, navegação, filtros, limpeza, resultado vazio, reabertura, saldo inicial e largura móvel.');
    } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
