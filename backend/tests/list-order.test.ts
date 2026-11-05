import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../src/db";
import { buildList, listRecords } from "../src/resources/list.service";
import { listUsers } from "../src/admin/admin.service";

const company = "11111111-1111-4111-8111-111111111111";
const forms = { table: "formas_pagamento", fields: ["descricao", "tipo", "banco_id", "ativo"] };
const originalQuery = pool.query;
after(() => { pool.query = originalQuery; });

test("contas priorizam tipo e mantêm desempates ao ordenar outra coluna antes da paginação", async () => {
    const config = { table: "lancamentos", fields: ["tipo", "data_vencimento", "pessoa_id", "descricao", "num_doc", "valor"] };
    const defaults = buildList(config, {}, [company]);
    assert.ok(defaults.order.startsWith("tipo asc NULLS LAST, data_vencimento asc NULLS LAST, translate(lower(btrim(pessoa_nome))"));
    assert.ok(defaults.order.indexOf("btrim(descricao)") < defaults.order.indexOf("btrim(num_doc)"));
    assert.ok(defaults.order.indexOf("btrim(num_doc)") < defaults.order.indexOf("(valor -"));
    const name = buildList(config, { ordem: "pessoa_id", direcao: "desc" }, [company]);
    assert.ok(name.order.startsWith("translate(lower(btrim(pessoa_nome))"));
    assert.match(name.order, /DESC NULLS LAST, tipo asc NULLS LAST, data_vencimento asc NULLS LAST/i);
    assert.equal(name.order.split("btrim(pessoa_nome)").length, 2);
    const value = buildList(config, { ordem: "valor", direcao: "desc" }, [company]);
    assert.ok(value.order.startsWith("(valor - COALESCE(desconto,0) + COALESCE(acrescimo,0)) desc NULLS LAST, tipo asc"));
    assert.ok(buildList(config, { ordem: "tipo", direcao: "desc" }, [company]).order.startsWith("tipo desc"));
    assert.throws(() => buildList(config, { ordem: "tipo; SELECT 1" }, [company]), /Ordenação inválida/);
    let sql = "";
    pool.query = (async (statement: string) => { sql = statement; return { rows: [{ data: [], meta: {} }] }; }) as typeof pool.query;
    await listRecords(config, { pagina: 2, tamanho: 50, ordem: "valor", direcao: "desc" }, [company]);
    assert.ok(sql.includes(`FROM filtered ORDER BY ${value.order} LIMIT 50 OFFSET`));
});

test("opções de usuários ordenam pelo nome e email sem alterar a listagem administrativa", async () => {
    let statement = "";
    let parameters: unknown;
    pool.query = (async (sql: string, values: unknown) => { statement = sql; parameters = values; return { rows: [] }; }) as typeof pool.query;
    await listUsers(true, "Ana");
    assert.match(statement, /WHERE concat_ws\(' · ', nome, email\) ILIKE \$1/);
    assert.match(statement, /ORDER BY translate\(lower\(btrim\(concat_ws/);
    assert.deepEqual(parameters, ["%Ana%"]);
    await listUsers();
    assert.match(statement, /ORDER BY nome$/);
    assert.doesNotMatch(statement, /WHERE|translate/);
});

test("formas mantêm ativas primeiro, nome e instituição antes do recorte de cada página", async () => {
    const statements: string[] = [];
    pool.query = (async (sql: string) => {
        statements.push(sql);
        return { rows: [{ data: [], meta: { total: 120, pagina: 1, paginas: 3 } }] };
    }) as typeof pool.query;
    for (const pagina of [1, 2, 3]) {
        await listRecords(forms, { pagina, tamanho: 50, ordem: "created_at", direcao: "desc", busca: "Pix" }, [company]);
    }
    for (const sql of statements) {
        assert.match(sql, /to_jsonb\(base\)::text ILIKE \$\d+/);
        assert.match(sql, /FROM filtered ORDER BY ativo DESC NULLS LAST, lower\(descricao\) ASC, lower\(banco_descricao\) ASC NULLS LAST, id ASC, empresa_id ASC LIMIT 50 OFFSET/);
    }
    // Opções A–Z mantêm o filtro de ativas, sem alterar a ordem da tabela.
    const options = buildList(forms, { opcoes: "true" }, [company], { ativo: true });
    assert.match(options.order, /^translate\(lower\(btrim\(descricao\)\)/);
    assert.match(options.order, /COLLATE "C" ASC NULLS LAST, id ASC, empresa_id ASC$/);
    assert.match(options.where, /ativo = \$\d+/);
});

test("opções usam o rótulo exibido em A–Z antes de paginar, inclusive na busca e com direção desc", async () => {
    for (const [table, opcoes, label] of [
        ["pessoas", "true", "nome"], ["bancos", "true", "descricao"], ["planos_contas", "true", "descricao"],
        ["lancamentos", "descricoes", "descricao"], ["lancamentos", "true", "concat_ws"],
    ] as const) {
        const config = { table, fields: ["descricao", "nome", "tipo"] };
        const query = { opcoes, direcao: "desc" as const, busca: "a", pagina: 2, tamanho: 50 };
        const built = buildList(config, query, [company]);
        assert.ok(built.order.startsWith(`translate(lower(btrim(${label}`));
        assert.match(built.order, /'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'/);
        assert.doesNotMatch(built.order, /\sDESC\b/i);
        assert.match(built.source, /empresa_id = ANY\(\$1::uuid\[\]\)/);
        let statement = "";
        pool.query = (async (sql: string) => { statement = sql; return { rows: [{ data: [], meta: {} }] }; }) as typeof pool.query;
        await listRecords(config, query, [company]);
        assert.ok(statement.includes(`FROM filtered ORDER BY ${built.order} LIMIT 50 OFFSET`));
        assert.match(statement, /ILIKE/);
    }
});

test("consulta da conta por ID mantém a empresa e não depende de busca, período ou página da listagem", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const built = buildList({ table: "lancamentos", fields: ["descricao", "status", "tipo"] },
        { pagina: 1, tamanho: 1 }, [company], { id });
    assert.match(built.source, /l\.empresa_id = ANY\(\$1::uuid\[\]\)/);
    assert.match(built.where, /^id = \$2$/);
    assert.deepEqual(built.values, [[company], id]);
    assert.doesNotMatch(built.where, /ILIKE|data_vencimento|status/);
});

test("sugestões de descrição filtram plano e empresa antes da deduplicação e preservam a busca", () => {
    const plan = "22222222-2222-4222-8222-222222222222";
    const config = { table: "lancamentos", fields: ["descricao", "plano_conta_id"] };
    const built = buildList(config, { opcoes: "descricoes", busca: "Aluguel", pagina: 2 }, [company], { plano_conta_id: plan });
    assert.match(built.source, /SELECT DISTINCT ON \(lower\(btrim\(l.descricao\)\)\)/);
    assert.match(built.source, /WHERE l.empresa_id = ANY\(\$1::uuid\[\]\) AND l.plano_conta_id = \$2 ORDER BY/);
    assert.doesNotMatch(built.where, /plano_conta_id/);
    assert.match(built.where, /descricao ILIKE \$3/);
    assert.deepEqual(built.values, [[company], plan, "%Aluguel%"]);
    const all = buildList(config, { opcoes: "descricoes" }, [company]);
    assert.doesNotMatch(all.source, /AND l.plano_conta_id/);
    assert.deepEqual(all.values, [[company]]);
    // O filtro normal de contas permanece no fluxo de filtros existente.
    assert.match(buildList(config, {}, [company], { plano_conta_id: plan }).where, /plano_conta_id = \$2/);
});
