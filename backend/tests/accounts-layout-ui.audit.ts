// API simulada: layout e preferência de zoom, sem gravações no banco.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

async function run() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const company = randomUUID();
    const row = { id: randomUUID(), empresa_id: company, empresa_identificador: '1', numero: 123, pessoa_nome: 'Cliente de teste', pessoa_id: randomUUID(),
        descricao: 'Descrição extensa de uma conta para conferir quebra de texto no celular sem perder acesso às ações', tipo: 'receber', valor: 100, saldo: 100, status: 'pendente', data_vencimento: '2026-11-20', quantidade_baixas: 0 };
    const errors: string[] = [];
    await context.route('**/*', async route => {
        const url = new URL(route.request().url()), path = url.pathname;
        if (path === '/auth/me') return route.fulfill({ json: { data: { id: 'audit', email: 'audit@invalid', role: 'comum' } } });
        if (path === '/empresas') return route.fulfill({ json: { data: [{ id: company, nome: 'Empresa teste', perfil: 'comum', licenca_status: 'ativa' }] } });
        if (path === '/lancamentos' && url.searchParams.has('resumo')) return route.fulfill({ json: { data: { rows: [], flowRows: [], overdueRows: [], overdue: 0, pagar: 0, receber: 0, totalPaid: 0 } } });
        if (['/lancamentos','/pessoas','/formas-pagamento','/bancos','/planos-contas'].includes(path)) return route.fulfill({ json: { data: path === '/lancamentos' ? [row] : [], meta: { total: 1, pagina: 1, paginas: 1 } } });
        return route.continue();
    });
    let page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const url = process.env.AUDIT_FRONTEND_URL || 'http://127.0.0.1:5189';
    try {
        await page.goto(url);
        assert.equal(await page.locator('.zoom-controls output').innerText(), '100%');
        await page.getByRole('button', { name: 'Contas', exact: true }).click();
        await page.locator('tbody tr').waitFor();
        assert.equal(await page.locator('th').filter({ hasText: /^Tipo$/ }).count(), 0);
        const ratio = await page.evaluate(() => document.querySelector('.page-content')!.getBoundingClientRect().width / document.querySelector('.main-area')!.getBoundingClientRect().width);
        assert.ok(ratio >= 0.9 && ratio <= 0.96, `Área útil ${ratio}`);
        await page.getByRole('button', { name: 'Aumentar zoom', exact: true }).click();
        await page.getByRole('button', { name: 'Aumentar zoom', exact: true }).click();
        assert.equal(await page.evaluate(() => localStorage.getItem('fluxo-zoom')), '120');
        await page.close(); page = await context.newPage();
        await page.goto(url + '/contas');
        assert.equal(await page.locator('.zoom-controls output').innerText(), '120%');
        await page.reload();
        assert.equal(await page.locator('.zoom-controls output').innerText(), '120%');
        await page.evaluate(() => localStorage.setItem('fluxo-zoom', 'inválido'));
        await page.reload();
        assert.equal(await page.locator('.zoom-controls output').innerText(), '100%');
        await page.getByRole('button', { name: 'Contas', exact: true }).click();
        await page.locator('tbody tr').waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.locator('.account-col-numero').isVisible(), false);
        const layout = await page.locator('tbody tr').evaluate(element => {
            return { descriptionRow: getComputedStyle(element.querySelector('.account-col-descricao')!).gridRowStart,
                actionsColumn: getComputedStyle(element.querySelector('.launch-actions')!).gridColumnStart,
                dueRow: getComputedStyle(element.querySelector('.account-col-data_vencimento')!).gridRowStart,
                width: document.documentElement.scrollWidth, viewport: innerWidth };
        });
        assert.equal(layout.descriptionRow, '2'); assert.equal(layout.dueRow, '3'); assert.equal(layout.actionsColumn, '4');
        assert.ok(layout.width <= layout.viewport);
        await page.getByTitle('Registrar recebimento', { exact: true }).click();
        await page.getByRole('dialog').waitFor();
        assert.deepEqual(errors, []);
        console.log('PASS largura desktop 94%, zoom salvo após reabrir/recarregar, fallback inválido e Contas móvel com ações acessíveis.');
    } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
