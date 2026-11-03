import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../src/db";
import { buildList, listRecords } from "../src/resources/list.service";

const company = "11111111-1111-4111-8111-111111111111";
const forms = { table: "formas_pagamento", fields: ["descricao", "tipo", "banco_id", "ativo"] };
const originalQuery = pool.query;
after(() => { pool.query = originalQuery; });

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
    // Os comboboxes continuam usando a ordenação anterior e seu filtro de ativas.
    const options = buildList(forms, { opcoes: "true" }, [company], { ativo: true });
    assert.match(options.order, /^created_at desc/);
    assert.match(options.where, /ativo = \$\d+/);
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
