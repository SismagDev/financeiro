// Opt-in: npm exec -- tsx tests/pagination.audit.ts (a partir de backend).
// Exercita PostgreSQL real e HTTP; todos os dados de teste são revertidos.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import type { Server } from "node:http";
import { pool } from "../src/db";
import accounts from "../src/lancamentos/lancamentos.routes";
import people from "../src/pessoas/pessoas.routes";
import payments from "../src/movimentacoes/movimentacoes.routes";
import receipts from "../src/recebimentos/recebimentos.routes";
import forms from "../src/formas_pagamento/formas_pagamento.routes";
import banks from "../src/bancos/bancos.routes";
import plans from "../src/planos_contas/planos_contas.routes";
import cash from "../src/caixa/caixa.routes";

async function run() {
    const client = await pool.connect(), originalQuery = pool.query, originalConnect = pool.connect;
    const user = randomUUID(), ids = [randomUUID(), randomUUID()];
    let server: Server | undefined, sequence = 0, passed = 0;
    let queryQueue = Promise.resolve();
    const transactionQuery = (sql: string, values?: unknown[]) => {
        const result = queryQueue.then(() => client.query(sql, values));
        queryQueue = result.then(() => undefined, () => undefined);
        return result;
    };
    const check = (label: string) => { passed++; console.log(`PASS ${label}`); };
    try {
        await client.query("BEGIN");
        await client.query(await readFile("migrations/011_inicio_caixa_empresa.sql", "utf8"));
        await client.query("INSERT INTO users (id,nome,email,password_hash,role,ativo) VALUES ($1,'Auditoria paginação',$2,'sem-login','comum',TRUE)", [user, `${user}@audit.invalid`]);
        for (const [index, id] of ids.entries()) {
            await client.query("INSERT INTO empresas (id,nome,identificador,ativo,licenca_expira_em) VALUES ($1,'Auditoria paginação',$2,TRUE,CURRENT_TIMESTAMP + INTERVAL '1 year')", [id, `AUD-${index}`]);
            await client.query("INSERT INTO users_empresas (user_id,empresa_id,perfil) VALUES ($1,$2,'comum')", [user, id]);
            await client.query(`INSERT INTO pessoas (empresa_id,nome,documento,celular,cliente,fornecedor)
                SELECT $1, 'Pessoa ' || lpad(n::text,3,'0'), '123.456.' || lpad(n::text,3,'0') || '-00', '(11) 99999-0000', n % 2 = 0, n % 2 = 1 FROM generate_series(1,80) n`, [id]);
            await client.query(`INSERT INTO lancamentos (empresa_id,descricao,valor,tipo,status,data_vencimento,pessoa_id)
                SELECT $1, CASE WHEN n > 60 THEN 'Descrição repetida' ELSE 'Conta ' || lpad(n::text,3,'0') END, 100,
                    CASE WHEN n % 2 = 0 THEN 'receber' ELSE 'pagar' END, 'pendente',
                    CASE WHEN n % 2 = 0 THEN '2026-10-31'::date ELSE '2026-10-01'::date END,
                    (SELECT id FROM pessoas WHERE empresa_id=$1 ORDER BY nome LIMIT 1)
                FROM generate_series(1,70) n`, [id]);
        }
        const form = (await client.query("INSERT INTO formas_pagamento (empresa_id,descricao,tipo) VALUES ($1,'Pix auditoria','pix') RETURNING id", [ids[0]])).rows[0].id;
        const account = (await client.query("SELECT id FROM lancamentos WHERE empresa_id=$1 AND tipo='pagar' ORDER BY id LIMIT 1", [ids[0]])).rows[0].id;
        await client.query(`INSERT INTO movimentacoes (empresa_id,lancamento_id,forma_pagamento_id,valor,data_movimentacao)
            SELECT $1,$2,$3,1,'2026-10-01'::date FROM generate_series(1,70)`, [ids[0], account, form]);
        await client.query("UPDATE lancamentos SET status='parcial' WHERE empresa_id=$1 AND id=$2", [ids[0], account]);
        const receiving = (await client.query("SELECT id FROM lancamentos WHERE empresa_id=$1 AND tipo='receber' LIMIT 1", [ids[0]])).rows[0].id;
        await client.query("INSERT INTO recebimentos (empresa_id,lancamento_id,forma_pagamento_id,valor,data_recebimento) VALUES ($1,$2,$3,25,'2026-10-31')", [ids[0], receiving, form]);
        await client.query("UPDATE lancamentos SET status='parcial' WHERE empresa_id=$1 AND id=$2", [ids[0], receiving]);
        pool.query = transactionQuery as typeof pool.query;
        pool.connect = (async () => {
            const savepoint = `pagination_${++sequence}`;
            return { release() {}, query(sql: string, values?: unknown[]) {
                return transactionQuery(sql === "BEGIN" ? `SAVEPOINT ${savepoint}` : sql === "COMMIT" ? `RELEASE SAVEPOINT ${savepoint}` : sql === "ROLLBACK" ? `ROLLBACK TO SAVEPOINT ${savepoint}` : sql, values);
            } };
        }) as typeof pool.connect;
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => { req.session = { user: { id: user } } as typeof req.session; next(); });
        app.get("/auth/me", (_req, res) => res.json({ data: { id: user, nome: "Auditoria", role: "comum", email: "audit@audit.invalid" } }));
        app.get("/empresas", (_req, res) => res.json({ data: ids.map((id, index) => ({ id, nome: `Empresa ${index}`, identificador: `AUD-${index}`, perfil: "comum", licenca_status: "ativa" })) }));
        app.use("/lancamentos", accounts); app.use("/pessoas", people);
        app.use("/movimentacoes", payments); app.use("/recebimentos", receipts); app.use("/formas-pagamento", forms);
        app.use("/bancos", banks); app.use("/planos-contas", plans); app.use("/caixa", cash);
        server = app.listen(0, "127.0.0.1");
        await new Promise<void>(resolve => server!.once("listening", resolve));
        const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        async function request(path: string, status = 200, options: RequestInit = {}) {
            const response = await fetch(base + path, { ...options, headers: { "x-empresa-id": ids[0]!, "Content-Type": "application/json", ...options.headers } });
            const body = await response.json();
            assert.equal(response.status, status, JSON.stringify(body));
            return body;
        }
        const scope = `empresas=${ids.join(",")}&pagina=1&tamanho=50`;
        const first = await request(`/lancamentos?${scope}&ordem=data_vencimento&direcao=asc`);
        assert.equal(first.data.length, 50); assert.equal(first.meta.total, 140); assert.equal(first.meta.paginas, 3);
        assert.equal(typeof first.data[0].valor, "string"); assert.equal(typeof first.data[0].numero, "string");
        assert.equal(Number(first.meta.pagar), 6930); assert.equal(Number(first.meta.receber), 6975);
        assert.equal(Number(first.meta.pago), 70); assert.equal(Number(first.meta.recebido), 25);
        const second = await request(`/lancamentos?${scope.replace("pagina=1", "pagina=2")}&ordem=data_vencimento&direcao=asc`);
        assert.equal(second.data.length, 50); assert.ok(second.data.every((row: { id: string }) => !first.data.some((item: { id: string }) => item.id === row.id)));
        assert.equal(Number(second.meta.pago), 70); assert.equal(Number(second.meta.recebido), 25);
        assert.deepEqual((await request(`/lancamentos?${scope}&ordem=data_vencimento&direcao=asc`)).data, first.data);
        const last = await request(`/lancamentos?${scope.replace("pagina=1", "pagina=999")}`);
        assert.equal(last.meta.pagina, 3); assert.equal(last.data.length, 40);
        check("paginação coletiva, ordem estável, totais completos e ajuste da última página");
        const dates = await request(`/lancamentos?${scope}&data_inicial=2026-10-31&data_final=2026-10-31&mostrar_em_aberto=true&mostrar_pagos=false`);
        assert.equal(dates.meta.total, 70); assert.equal(Number(dates.meta.receber), 6975);
        assert.equal(Number(dates.meta.pago), 0); assert.equal(Number(dates.meta.recebido), 25);
        assert.equal((await request(`/lancamentos?${scope}&mostrar_em_aberto=false&mostrar_pagos=false`)).meta.total, 0);
        assert.equal((await request(`/lancamentos?${scope}&busca=Pessoa%20001`)).meta.total, 140);
        assert.equal((await request(`/lancamentos?${scope}&busca=inexistente`)).meta.total, 0);
        assert.equal((await request(`/lancamentos?${scope}&busca=%25`)).meta.total, 0);
        assert.equal((await request(`/lancamentos?${scope}&forma_pagamento_id=${form}`)).meta.total, 2);
        check("período inclusivo, busca por pessoa/descrição, status e forma antes da paginação");
        await transactionQuery("SAVEPOINT summary_adjustments");
        await transactionQuery("UPDATE recebimentos SET desconto=5, acrescimo=2 WHERE empresa_id=$1 AND lancamento_id=$2", [ids[0], receiving]);
        const partialSummary = await request(`/lancamentos?${scope}`);
        assert.equal(Number(partialSummary.meta.recebido), 25);
        assert.equal(Number(partialSummary.meta.receber), 6972);
        await transactionQuery("UPDATE recebimentos SET valor=97 WHERE empresa_id=$1 AND lancamento_id=$2", [ids[0], receiving]);
        await transactionQuery("UPDATE lancamentos SET status='pago' WHERE empresa_id=$1 AND id=$2", [ids[0], receiving]);
        const paidSummary = await request(`/lancamentos?${scope}&mostrar_em_aberto=false&mostrar_pagos=true`);
        assert.equal(paidSummary.meta.total, 1);
        assert.equal(Number(paidSummary.meta.recebido), 97); assert.equal(Number(paidSummary.meta.receber), 0);
        await transactionQuery("UPDATE lancamentos SET status='cancelado' WHERE empresa_id=$1 AND id=$2", [ids[0], receiving]);
        const cancelledSummary = await request(`/lancamentos?${scope}`);
        assert.equal(Number(cancelledSummary.meta.recebido), 0);
        await transactionQuery("ROLLBACK TO SAVEPOINT summary_adjustments");
        check("resumo distingue dinheiro recebido de ajustes e respeita contas quitadas, canceladas e filtros");
        assert.equal((await request(`/pessoas?${scope}&mostrar_clientes=true&mostrar_fornecedores=false`)).meta.total, 80);
        assert.equal((await request(`/pessoas?${scope}&mostrar_clientes=false&mostrar_fornecedores=false`)).meta.total, 0);
        assert.equal((await request(`/pessoas?${scope}&busca=12345600100`)).meta.total, 2);
        check("filtros de pessoas e CPF com ou sem formatação");
        const unified = await request(`/movimentacoes?${scope}&unificadas=true&ordem=data_baixa`);
        assert.equal(unified.meta.total, 71); assert.equal(unified.data.length, 50);
        assert.equal((await request(`/movimentacoes?${scope}&unificadas=true&data_inicial=2026-10-31&data_final=2026-10-31`)).meta.total, 1);
        assert.equal((await request(`/movimentacoes?${scope}&unificadas=true&mostrar_pagamentos=false`)).meta.total, 1);
        assert.equal((await request(`/movimentacoes?${scope}&lancamento_id=${account}`)).meta.total, 70);
        check("baixas unificadas e detalhes por conta com filtros no SQL");
        const cashPage = await request(`/caixa?${scope}&saldo_inicial=100`);
        const cashNext = await request(`/caixa?${scope.replace("pagina=1", "pagina=2")}&saldo_inicial=100`);
        assert.equal(cashPage.meta.total, 71); assert.equal(cashPage.saldo_atual, 55);
        assert.equal(cashPage.data[49].saldo_depois, cashNext.data[0].saldo_antes);
        assert.equal(cashNext.data.at(-1).saldo_depois, 55);
        check("caixa conserva saldo acumulado entre páginas e saldo final global");
        const cashLast = await request(`/caixa?${scope}&ultima_pagina=true&saldo_inicial=100`);
        assert.equal(cashLast.meta.pagina, 2); assert.equal(cashLast.data.length, 21);
        assert.equal(cashLast.data.at(-1).data, '2026-10-31'); assert.equal(cashLast.saldo_atual, 55);
        const bank = randomUUID(), foreignBank = randomUUID();
        await client.query("INSERT INTO bancos (id,empresa_id,descricao) VALUES ($1,$2,'Banco teste'),($3,$4,'Banco outra empresa')", [bank, ids[0], foreignBank, ids[1]]);
        await client.query('UPDATE formas_pagamento SET banco_id=$1 WHERE id=$2 AND empresa_id=$3', [bank, form, ids[0]]);
        const filteredCash = await request(`/caixa?${scope}&ultima_pagina=true&saldo_inicial=100&banco_id=${bank}&forma_pagamento_id=${form}&data_inicial=2026-10-31&data_final=2026-10-31&mostrar_pagamentos=false`);
        assert.equal(filteredCash.meta.total, 1); assert.equal(filteredCash.meta.pagina, 1);
        assert.equal(filteredCash.saldo_atual, 125); assert.equal(filteredCash.data[0].saldo_antes, 100);
        const cashOut = await request(`/caixa?${scope}&ultima_pagina=true&saldo_inicial=100&banco_id=${bank}&mostrar_recebimentos=false`);
        assert.equal(cashOut.meta.total, 70); assert.equal(cashOut.meta.pagina, 2); assert.equal(cashOut.saldo_atual, 30);
        const emptyCash = await request(`/caixa?${scope}&ultima_pagina=true&banco_id=${foreignBank}`);
        assert.equal(emptyCash.meta.total, 0); assert.equal(emptyCash.meta.pagina, 1); assert.equal(emptyCash.saldo_atual, 0);
        const shrunk = await request(`/caixa?${scope.replace('pagina=1','pagina=999')}&data_inicial=2026-10-31`);
        assert.equal(shrunk.meta.pagina, 1); assert.equal(shrunk.meta.total, 1);
        await request(`/caixa?${scope}&data_inicial=2026-11-01&data_final=2026-10-01`, 400);
        check('caixa: última página, filtros combinados, limites inclusivos, saldos, período inválido e banco por empresa');
        await client.query('SAVEPOINT opening_balance_test');
        await client.query("INSERT INTO recebimentos (empresa_id,lancamento_id,forma_pagamento_id,valor,data_recebimento) VALUES ($1,$2,$3,40,'2024-12-31')", [ids[0], receiving, form]);
        await client.query("INSERT INTO movimentacoes (empresa_id,lancamento_id,forma_pagamento_id,valor,data_movimentacao) VALUES ($1,$2,$3,5,'2024-12-31')", [ids[0], account, form]);
        const carried = await request(`/caixa?${scope}&data_inicial=2026-10-31&data_final=2026-10-31&saldo_inicial=100&banco_id=${bank}&forma_pagamento_id=${form}`);
        assert.equal(carried.meta.total, 1); assert.equal(carried.saldo_anterior, -35);
        assert.equal(carried.data[0].saldo_antes, 65); assert.equal(carried.data[0].saldo_depois, 90); assert.equal(carried.saldo_atual, 90);
        for (const key of ['descricao','natureza','forma_pagamento_id','instituicao','valor','saldo_antes','saldo_depois']) {
            for (const direction of ['asc','desc']) {
                const ordered = await request(`/caixa?empresas=${ids.join(',')}&pagina=1&tamanho=100&ordem=${key}&direcao=${direction}`);
                const dates = ordered.data.map((row: { data: string }) => row.data);
                assert.deepEqual(dates, [...dates].sort());
                if (['valor','saldo_antes','saldo_depois'].includes(key)) {
                    const values = ordered.data.filter((row: { data: string }) => row.data === '2024-12-31').map((row: Record<string, number>) => row[key]);
                    assert.deepEqual(values, [...values].sort((a,b) => direction === 'asc' ? a-b : b-a));
                }
            }
        }
        const emptyPeriod = await request(`/caixa?${scope}&data_inicial=2027-01-01&saldo_inicial=100`);
        assert.equal(emptyPeriod.meta.total, 0); assert.equal(emptyPeriod.saldo_atual, 90);
        await client.query('ROLLBACK TO SAVEPOINT opening_balance_test');
        check('saldo anterior inclui anos anteriores, ajuste manual e período vazio; ordenação por coluna preserva data primeiro');
        await client.query("UPDATE empresas SET caixa_data_inicio='2026-10-31T00:00:00Z' WHERE id=$1", [ids[0]]);
        const fromDate = await request(`/caixa?${scope}`);
        assert.equal(fromDate.meta.total, 1); assert.equal(fromDate.saldo_atual, 25);
        assert.equal(fromDate.data[0].data, "2026-10-31"); assert.equal(fromDate.data[0].saldo_antes, 0);
        assert.equal((await request(`/movimentacoes?${scope}&unificadas=true`)).meta.total, 71);
        await client.query("UPDATE empresas SET caixa_data_inicio='2026-01-01T00:00:00Z' WHERE id=$1", [ids[0]]);
        assert.equal((await request(`/caixa?${scope}`)).meta.total, 71);
        await client.query("UPDATE empresas SET caixa_data_inicio='2099-01-01T00:00:00Z' WHERE id=$1", [ids[1]]);
        assert.equal((await request(`/caixa?${scope}`)).meta.total, 71);
        await client.query("UPDATE empresas SET caixa_data_inicio='2099-01-01T00:00:00Z' WHERE id=$1", [ids[0]]);
        const future = await request(`/caixa?${scope}`);
        assert.equal(future.meta.total, 0); assert.equal(future.saldo_atual, 0);
        await client.query("UPDATE empresas SET caixa_data_inicio=NULL WHERE id=ANY($1::uuid[])", [ids]);
        assert.equal((await request(`/caixa?${scope}`)).meta.total, 71);
        check("início do caixa por empresa é inclusivo, afeta saldos e preserva as demais baixas; em branco restaura o histórico");
        const summary = await request(`/lancamentos?empresas=${ids.join(",")}&resumo=dashboard`);
        assert.equal(Number(summary.data.pagar), 6930); assert.equal(Number(summary.data.receber), 6975);
        assert.equal(Number(summary.data.totalPaid), 95); assert.ok(summary.data.rows.length <= 6); assert.equal(summary.data.flowRows.length, 2);
        const alert = await request(`/lancamentos?empresas=${ids.join(",")}&resumo=alertas`);
        assert.ok(alert.data.overdueRows.length <= 5); assert.ok(!("flowRows" in alert.data));
        const suggestions = await request(`/lancamentos?${scope}&opcoes=descricoes&busca=repetida`);
        assert.equal(suggestions.meta.total, 1); assert.equal(suggestions.data.length, 1);
        check("dashboard agregado, alertas limitados e descrições sem duplicação");
        await request(`/pessoas?${scope}&pagina=0`, 400);
        await request(`/pessoas?${scope}&tamanho=1000`, 400);
        await request(`/lancamentos?${scope}&ordem=id;SELECT`, 400);
        await request(`/lancamentos?${scope}&data_inicial=invalida`, 400);
        await request(`/lancamentos?empresas=${ids[0]},${randomUUID()}&pagina=1`, 403);
        await request(`/lancamentos?empresas=invalida&pagina=1`, 400);
        assert.equal((await request(`/lancamentos?empresas=${ids[0]},${ids[0]!.toUpperCase()}&pagina=1`)).meta.total, 70);
        check("validação e autorização de todas as empresas, sem resultados parciais");
        const before = (await request(`/lancamentos?pagina=1&busca=Conta&status=pendente`)).meta.total;
        const remove = (await request(`/lancamentos?pagina=999&tamanho=1&busca=Conta&status=pendente`)).data[0];
        const deleted = await fetch(base + "/lancamentos/" + remove.id, { method: "DELETE", headers: { "x-empresa-id": ids[0]! } });
        assert.equal(deleted.status, 204);
        const adjusted = await request(`/lancamentos?pagina=${before}&tamanho=1&busca=Conta&status=pendente`);
        assert.equal(adjusted.meta.total, before - 1); assert.equal(adjusted.meta.pagina, before - 1); assert.equal(adjusted.data.length, 1);
        check("exclusão na última página mantém a listagem em uma página existente");
        if (process.env.PAGINATION_UI === "1") {
            const { auditUi } = await import("./pagination-ui.audit");
            await auditUi(base, ids, account);
            check("requests no Chromium: carga sob demanda, paginação, filtros, seletores e baixa");
        }
        if (process.env.PAGINATION_PERF === "1") {
            await queryQueue;
            const { auditPerformance } = await import("./pagination-performance.audit");
            await auditPerformance(client, ids[0]!, form);
            check("EXPLAIN ANALYZE confirma uso dos três índices com 6000 contas e 36000 baixas adicionais");
        }
        await queryQueue;
        await client.query("INSERT INTO pessoas (empresa_id,nome,cliente,fornecedor) VALUES ($1,'Legada sem vínculo',FALSE,FALSE)", [ids[0]]);
        const legacy = await request(`/pessoas?${scope}&busca=Legada&mostrar_clientes=true&mostrar_fornecedores=true`);
        assert.equal(legacy.meta.total, 1); assert.equal(legacy.meta.sem_vinculo, 1);
        assert.equal((await request(`/pessoas?${scope}&busca=Legada&mostrar_clientes=true&mostrar_fornecedores=false`)).meta.total, 0);
        check("pessoa legada permanece acessível e o indicador é calculado no conjunto filtrado");
        console.log(`TOTAL PASS: ${passed}`);
    } finally {
        if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
        pool.query = originalQuery; pool.connect = originalConnect;
        await queryQueue;
        await client.query("ROLLBACK"); client.release(); await pool.end();
    }
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
