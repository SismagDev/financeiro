// Frontend local com API simulada: nenhuma gravação real.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

async function run() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const company = randomUUID(), client = randomUUID();
    const writes: { id: string; body: Record<string, unknown> }[] = [];
    let failAccount = false, clientAttempts = 0, people: object[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url()), path = url.pathname;
        if (path === '/auth/me') return route.fulfill({ json: { data: { id: 'audit', email: 'audit@invalid', role: 'comum' } } });
        if (path === '/empresas') return route.fulfill({ json: { data: [{ id: company, nome: 'Empresa teste', perfil: 'comum', licenca_status: 'ativa' }] } });
        if (path === '/pessoas' && req.method() === 'POST') {
            assert.equal(req.headers()['x-empresa-id'], company); clientAttempts++;
            if (clientAttempts === 1) return route.fulfill({ status: 400, json: { message: 'Falha controlada no cliente' } });
            people = [{ ...req.postDataJSON(), id: client, empresa_id: company }];
            return route.fulfill({ json: { id: client } });
        }
        if (path === '/lancamentos' && req.method() === 'POST') {
            assert.equal(req.headers()['x-empresa-id'], company);
            if (failAccount) { failAccount = false; return route.fulfill({ status: 400, json: { message: 'Falha controlada na conta' } }); }
            const id = randomUUID(); writes.push({ id, body: req.postDataJSON() });
            await new Promise(resolve => setTimeout(resolve, 150));
            return route.fulfill({ json: { id } });
        }
        if (path.startsWith('/lancamentos/') && req.method() === 'GET') { const latest = writes.at(-1)!; return route.fulfill({ json: { data: { ...latest.body, id: latest.id, empresa_id: company, saldo: latest.body.valor, status: 'pendente' } } }); }
        if (path === '/lancamentos' && url.searchParams.has('resumo')) return route.fulfill({ json: { data: { rows: [], flowRows: [], overdueRows: [], overdue: 0, receber: 0, pagar: 0, totalPaid: 0 } } });
        if (['/lancamentos','/pessoas','/bancos','/formas-pagamento','/planos-contas'].includes(path)) return route.fulfill({ json: { data: path === '/pessoas' ? people : [], meta: { total: 0, pagina: 1, paginas: 1 } } });
        return route.continue();
    });
    try {
        await page.goto(process.env.AUDIT_FRONTEND_URL || 'http://127.0.0.1:5189');
        await page.getByRole('button', { name: 'Contas', exact: true }).click();
        await page.locator('.account-create-buttons').getByRole('button', { name: 'Receber', exact: true }).click();
        const account = page.getByRole('dialog', { name: 'Cadastro', exact: true });
        const keep = account.getByLabel('Manter dados para cadastrar outra conta', { exact: true });
        assert.equal(await keep.isChecked(), false);
        await account.getByRole('heading', { name: 'Valores', exact: true }).waitFor();
        await account.getByRole('combobox', { name: 'Descrição', exact: true }).fill('Conta de teste');
        await account.locator('input[name="valor"]').fill('123.45');
        const before = await account.boundingBox();
        const searchClient = async () => {
            await account.getByRole('combobox', { name: 'Cliente', exact: true }).fill('Cliente Novo');
            await account.getByRole('button', { name: 'Adicionar cliente', exact: true }).click();
        };
        await searchClient();
        const person = page.getByRole('dialog', { name: 'Cadastrar cliente', exact: true });
        await person.waitFor();
        const after = await account.boundingBox(); assert.equal(before?.height, after?.height);
        assert.equal(await person.locator('input[name="nome"]').inputValue(), 'Cliente Novo');
        await person.getByRole('button', { name: 'Cancelar cadastro', exact: true }).click();
        assert.equal(await account.locator('input[name="pessoa_id"]').inputValue(), '');
        assert.equal(await account.locator('input[name="valor"]').inputValue(), '123.45');
        await searchClient();
        await person.getByRole('button', { name: 'Salvar cliente', exact: true }).click();
        await person.getByRole('alert').filter({ hasText: 'Falha controlada' }).waitFor();
        assert.equal(await person.locator('input[name="nome"]').inputValue(), 'Cliente Novo');
        await person.getByRole('button', { name: 'Salvar cliente', exact: true }).click();
        await person.waitFor({ state: 'hidden' });
        assert.equal(await account.locator('input[name="pessoa_id"]').inputValue(), client);
        await keep.check();
        await account.getByRole('button', { name: 'Gravar →', exact: true }).dblclick();
        await page.waitForFunction(() => !document.querySelector('.modal-actions button.button-primary[disabled]'));
        await account.getByRole('button', { name: 'Gravar →', exact: true }).waitFor({ state: 'visible' });
        assert.equal(writes.length, 1);
        assert.equal(await keep.isChecked(), true);
        assert.equal(await account.locator('input[name="valor"]').inputValue(), '123.45');
        assert.equal(await account.getByRole('combobox', { name: 'Descrição', exact: true }).inputValue(), 'Conta de teste');
        failAccount = true;
        const failureResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/lancamentos' && response.request().method() === 'POST' && response.status() === 400);
        await account.getByRole('button', { name: 'Gravar →', exact: true }).click();
        await failureResponse;
        await page.waitForFunction(() => !document.querySelector('.modal-actions button.button-primary[disabled]'));
        assert.equal(writes.length, 1); assert.equal(await keep.isChecked(), true);
        await account.getByRole('button', { name: 'Gravar + Baixa', exact: true }).click();
        await page.getByRole('dialog', { name: 'Registrar baixa', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Fechar baixa', exact: true }).click();
        assert.equal(await account.locator('input[name=\"valor\"]').inputValue(), '123.45');
        assert.equal(writes.length, 2); assert.notEqual(writes[0].id, writes[1].id);
        assert.equal(writes[1].body.pessoa_id, client); assert.equal(writes[1].body.valor, 123.45);
        await keep.uncheck();
        await account.getByRole('button', { name: 'Gravar →', exact: true }).click();
        await account.waitFor({ state: 'hidden' });
        await page.locator('.account-create-buttons').getByRole('button', { name: 'Pagar', exact: true }).click();
        assert.equal(await account.getByLabel('Manter dados para cadastrar outra conta', { exact: true }).isChecked(), false);
        assert.deepEqual(errors, []);
        console.log('PASS contas: cliente em modal sem expandir, cancelar/erro/sucesso e seleção; campos mantidos, duas contas distintas, envio duplo bloqueado e padrão desmarcado.');
    } catch (error) { console.error("Erros do navegador:", errors); console.error("Envios:", writes.length); console.error(await page.locator("input:invalid").evaluateAll(inputs => inputs.map(input => ({ name: (input as HTMLInputElement).name, message: (input as HTMLInputElement).validationMessage })))); console.error((await page.locator("body").innerText()).slice(-4500)); throw error; }
    finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
