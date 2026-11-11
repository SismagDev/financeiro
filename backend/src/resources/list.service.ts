import { z } from "zod";
import { pool } from "../db";
import { historicalRecordId } from "../utils/access-import";
import { alphabeticalOrder } from "../utils/alphabetical-order";

const bool = z.enum(["true", "false"]).transform(value => value === "true").optional();
export const listShape = {
    ultima_pagina: z.literal("true").optional(),
    ano: z.coerce.number().int().min(1).max(9998).optional(),
    tipo_conta: z.enum(["receber", "pagar"]).optional(),
    pagina: z.coerce.number().int().min(1).max(1000000).optional(),
    tamanho: z.coerce.number().int().min(1).max(100).optional(),
    busca: z.string().trim().max(200).optional(),
    ordem: z.string().max(60).optional(), direcao: z.enum(["asc", "desc"]).optional(),
    data_inicial: z.string().date().optional(), data_final: z.string().date().optional(),
    empresas: z.string().optional(),
    mostrar_clientes: bool, mostrar_fornecedores: bool,
    mostrar_em_aberto: bool, mostrar_pagos: bool,
    mostrar_recebimentos: bool, mostrar_pagamentos: bool,
    forma_pagamento_id: z.string().uuid().optional(),
    unificadas: z.literal("true").optional(), resumo: z.enum(["dashboard", "alertas"]).optional(),
    opcoes: z.enum(["true", "descricoes"]).optional(),
};
export const listSchema = z.object(listShape);
export type ListQuery = z.infer<typeof listSchema>;
type Config = { table: string; fields: string[]; searchFields?: string[] };

// As duas origens mantêm identidade e data próprias mesmo na listagem unificada.
export const settlementsSql = (scope = "$1", cash = false) => ["movimentacoes", "recebimentos"].map(table => {
    const receiving = table === "recebimentos";
    const date = receiving ? "data_recebimento" : "data_movimentacao";
    return `SELECT s.id, s.empresa_id, s.lancamento_id, s.forma_pagamento_id, s.valor, s.desconto, s.acrescimo, s.created_at,
        '${table}'::text AS origem, '${receiving ? "Recebimento" : "Pagamento"}'::text AS natureza,
        '${receiving ? "receber" : "pagar"}'::text AS tipo, ${cash ? `COALESCE(s.${date}, s.created_at::date)` : `s.${date}`} AS data_baixa,
        ${receiving ? "s.data_recebimento" : "NULL::date"} AS data_recebimento,
        ${receiving ? "NULL::date" : "s.data_movimentacao"} AS data_movimentacao,
        l.pessoa_id, l.descricao, l.tipo AS categoria, p.nome AS pessoa_nome, fp.descricao AS forma_pagamento_descricao,
        ${cash ? "COALESCE(fp.banco_id, l.banco_id)" : "fp.banco_id"} AS banco_id, b.descricao AS banco_descricao, b.descricao AS instituicao
        FROM ${table} s JOIN lancamentos l ON l.id = s.lancamento_id AND l.empresa_id = s.empresa_id
        ${cash ? "JOIN empresas e ON e.id = s.empresa_id" : ""}
        LEFT JOIN pessoas p ON p.id = l.pessoa_id AND p.empresa_id = l.empresa_id
        LEFT JOIN formas_pagamento fp ON fp.id = s.forma_pagamento_id AND fp.empresa_id = s.empresa_id
        LEFT JOIN bancos b ON b.id = COALESCE(fp.banco_id, l.banco_id) AND b.empresa_id = l.empresa_id
        WHERE s.empresa_id = ANY(${scope}::uuid[])
        ${cash ? `AND (e.caixa_data_inicio IS NULL OR COALESCE(s.${date}, s.created_at::date) >= (e.caixa_data_inicio AT TIME ZONE 'UTC')::date)` : ""}`;
}).join(" UNION ALL ");

const launchColumns = `SELECT l.*, p.nome AS pessoa_nome, pc.descricao AS plano_conta_descricao,
    GREATEST(0, l.valor - COALESCE(l.desconto, 0) + COALESCE(l.acrescimo, 0) - COALESCE(s.total, 0)) AS saldo,
    COALESCE(s.total, 0) AS total_baixado, COALESCE(s.total_liquido, 0) AS total_baixado_liquido,
    COALESCE(s.quantidade, 0) AS quantidade_baixas, s.data_ultima_baixa
    FROM lancamentos l LEFT JOIN pessoas p ON p.id = l.pessoa_id AND p.empresa_id = l.empresa_id
    LEFT JOIN planos_contas pc ON pc.id = l.plano_conta_id AND pc.empresa_id = l.empresa_id`;
const launchesSql = `${launchColumns}
    LEFT JOIN (SELECT empresa_id, lancamento_id, SUM(valor) AS total, SUM(valor_liquido) AS total_liquido, COUNT(*) AS quantidade, MAX(data) AS data_ultima_baixa
        FROM (SELECT empresa_id, lancamento_id, valor + desconto - acrescimo AS valor, valor AS valor_liquido, data_movimentacao AS data FROM movimentacoes WHERE empresa_id = ANY($1::uuid[])
              UNION ALL SELECT empresa_id, lancamento_id, valor + desconto - acrescimo, valor, data_recebimento FROM recebimentos WHERE empresa_id = ANY($1::uuid[])) s
        GROUP BY empresa_id, lancamento_id) s ON s.empresa_id = l.empresa_id AND s.lancamento_id = l.id
    WHERE l.empresa_id = ANY($1::uuid[])`;

// Nas listagens os filtros de conta reduzem os lançamentos antes de consultar suas baixas.
// O dashboard mantém a agregação por empresa para consultar todo o conjunto uma única vez.
const launchesListSql = `${launchColumns} LEFT JOIN LATERAL (
    SELECT SUM(valor) AS total, SUM(valor_liquido) AS total_liquido, COUNT(*) AS quantidade, MAX(data) AS data_ultima_baixa FROM (
        SELECT valor + desconto - acrescimo AS valor, valor AS valor_liquido, data_movimentacao AS data FROM movimentacoes WHERE empresa_id = l.empresa_id AND lancamento_id = l.id
        UNION ALL SELECT valor + desconto - acrescimo, valor, data_recebimento FROM recebimentos WHERE empresa_id = l.empresa_id AND lancamento_id = l.id
    ) s) s ON TRUE WHERE l.empresa_id = ANY($1::uuid[])`;

export function buildList(config: Config, query: ListQuery, ids: string[], exact: Record<string, unknown> = {}) {
    const launches = config.table === "lancamentos";
    const cash = config.table === "caixa";
    const settlements = cash || config.table === "movimentacoes" || config.table === "recebimentos";
    const people = config.table === "pessoas";
    const values: unknown[] = [ids];
    const clauses: string[] = [];
    const param = (value: unknown) => { values.push(value); return `$${values.length}`; };
    if (config.table === "planos_contas" && query.tipo_conta) clauses.push(`tipo IN ('ambos', ${param(query.tipo_conta)})`);
    const descriptionPlan = launches && query.opcoes === "descricoes" && exact.plano_conta_id !== undefined
        ? ` AND l.plano_conta_id = ${param(exact.plano_conta_id)}` : "";
    const launchOptions = `SELECT ${query.opcoes === "descricoes" ? "DISTINCT ON (lower(btrim(l.descricao)))" : ""} l.*, p.nome AS pessoa_nome, pc.descricao AS plano_conta_descricao
        FROM lancamentos l LEFT JOIN pessoas p ON p.id = l.pessoa_id AND p.empresa_id = l.empresa_id
        LEFT JOIN planos_contas pc ON pc.id = l.plano_conta_id AND pc.empresa_id = l.empresa_id
        WHERE l.empresa_id = ANY($1::uuid[])${descriptionPlan} ${query.opcoes === "descricoes" ? "ORDER BY lower(btrim(l.descricao)), l.id" : ""}`;
    const source = launches ? query.opcoes ? launchOptions : launchesListSql : settlements ? settlementsSql("$1", cash) : `SELECT t.*${config.table === "formas_pagamento" ? ", b.descricao AS banco_descricao" : ""}
        FROM ${config.table} t ${config.table === "formas_pagamento" ? "LEFT JOIN bancos b ON b.id = t.banco_id AND b.empresa_id = t.empresa_id" : ""}
        WHERE t.empresa_id = ANY($1::uuid[])`;
    if (!settlements) {
        const reserved = ids.map(id => historicalRecordId(id, config.table)).filter(Boolean);
        if (reserved.length) clauses.push(`id <> ALL(${param(reserved)}::uuid[])`);
    }
    for (const [key, value] of Object.entries(exact)) {
        if (value === undefined) continue;
        if (descriptionPlan && key === "plano_conta_id") continue;
        // Os nomes provêm exclusivamente dos schemas dos recursos.
        clauses.push(`${key} ${config.searchFields?.includes(key) ? "ILIKE" : "="} ${param(config.searchFields?.includes(key) ? `%${value}%` : value)}`);
    }
    if (settlements && !cash && !query.unificadas) clauses.push(`origem = ${param(config.table)}`);
    if (query.busca) {
        const term = param(`%${query.busca.replace(/[\\%_]/g, "\\$&")}%`);
        if (people) {
            const digits = query.busca.replace(/\D/g, "");
            const numeric = digits && /^[\d\s().+/-]+$/.test(query.busca)
                ? ` OR regexp_replace(COALESCE(documento, ''), '\\D', '', 'g') LIKE ${param(`%${digits}%`)}
                    OR regexp_replace(COALESCE(responsavel_cpf, ''), '\\D', '', 'g') LIKE $${values.length}
                    OR regexp_replace(COALESCE(celular, ''), '\\D', '', 'g') LIKE $${values.length}` : "";
            clauses.push(`(nome ILIKE ${term} OR documento ILIKE ${term} OR responsavel_cpf ILIKE ${term} OR celular ILIKE ${term}${numeric})`);
        } else if (query.opcoes === "descricoes") clauses.push(`descricao ILIKE ${term}`);
        else if (launches || settlements) clauses.push(`(descricao ILIKE ${term} OR pessoa_nome ILIKE ${term})`);
        else clauses.push(`to_jsonb(base)::text ILIKE ${term}`);
    }
    if (people && (query.mostrar_clientes !== undefined || query.mostrar_fornecedores !== undefined)) {
        const client = query.mostrar_clientes !== false, supplier = query.mostrar_fornecedores !== false;
        if (!client || !supplier) clauses.push(client ? "cliente = TRUE" : supplier ? "fornecedor = TRUE" : "FALSE");
    }
    if (launches && (query.mostrar_em_aberto !== undefined || query.mostrar_pagos !== undefined)) {
        const statuses = [...(query.mostrar_em_aberto ? ["pendente", "parcial"] : []), ...(query.mostrar_pagos ? ["pago"] : [])];
        clauses.push(`status = ANY(${param(statuses)}::text[])`);
    }
    if (settlements) {
        if (query.mostrar_recebimentos === false) clauses.push("origem <> 'recebimentos'");
        if (query.mostrar_pagamentos === false) clauses.push("origem <> 'movimentacoes'");
    }
    if (query.forma_pagamento_id) clauses.push(launches
        ? `EXISTS (SELECT 1 FROM (${settlementsSql()}) s WHERE s.lancamento_id = base.id AND s.empresa_id = base.empresa_id AND s.forma_pagamento_id = ${param(query.forma_pagamento_id)})`
        : `forma_pagamento_id = ${param(query.forma_pagamento_id)}`);
    const dateColumn = launches ? "data_vencimento" : "data_baixa";
    if (launches || settlements) {
        // As datas financeiras são dias civis. Inclui integralmente ambos os limites.
        if (query.data_inicial) clauses.push(`${dateColumn} >= ${param(query.data_inicial)}::date`);
        if (query.data_final) clauses.push(`${dateColumn} < (${param(query.data_final)}::date + 1)`);
    }
    const allowed = ["id", "created_at", "empresa_identificador", ...config.fields,
        ...(cash ? ["valor", "instituicao", "saldo_antes", "saldo_depois"] : []),
        ...(launches ? ["pessoa_nome", "plano_conta_descricao", ...(!query.opcoes ? ["saldo"] : [])] : []),
        ...(settlements ? ["data_baixa", "pessoa_id", "descricao", "natureza", "forma_pagamento_id"] : [])];
    if (query.ordem && !allowed.includes(query.ordem)) throw new Error("Ordenação inválida");
    const key = query.ordem || (query.opcoes ? "created_at" : cash ? "data_baixa" : launches ? "data_vencimento" : settlements ? "data_baixa" : "created_at");
    const mapped = key === "pessoa_id" && (launches || settlements) ? "pessoa_nome" : key === "plano_conta_id" && launches ? "plano_conta_descricao"
        : key === "forma_pagamento_id" && settlements ? "forma_pagamento_descricao" : key;
    const direction = query.direcao || (launches || cash ? "asc" : "desc");
    // Usa o mesmo texto exibido no seletor de contas; descrições livres têm rótulo próprio.
    const optionLabel = launches && query.opcoes !== "descricoes"
        ? "concat_ws(' · ', NULLIF(pessoa_nome, ''), NULLIF(descricao, ''), CASE WHEN tipo = 'receber' THEN 'Recebimento' ELSE 'Pagamento' END)"
        : people ? "nome" : "descricao";
    const accountOrder = [mapped, ...["tipo", "data_vencimento", "pessoa_nome", "descricao", "num_doc", "valor"].filter(column => column !== mapped)]
        .map((column, index) => {
            const expression = column === "valor" ? "(valor - COALESCE(desconto,0) + COALESCE(acrescimo,0))"
                : ["pessoa_nome", "descricao", "num_doc"].includes(column) ? alphabeticalOrder(column) : column;
            return `${expression} ${index === 0 ? direction : "asc"} NULLS LAST`;
        }).join(", ");
    const cashExpression = mapped === "valor" ? "CASE WHEN origem = 'recebimentos' THEN valor ELSE -valor END" : mapped;
    const cashOrder = `data_baixa asc NULLS LAST, ${mapped === "data_baixa" ? "" : cashExpression + " " + direction + " NULLS LAST, "}id asc, empresa_id asc, origem asc`;
    const order = query.opcoes
        ? `${alphabeticalOrder(optionLabel)} ASC NULLS LAST, id ASC, empresa_id ASC`
        : config.table === "formas_pagamento"
        ? "ativo DESC NULLS LAST, lower(descricao) ASC, lower(banco_descricao) ASC NULLS LAST, id ASC, empresa_id ASC"
        : cash ? cashOrder : launches ? `${accountOrder}, id ASC, empresa_id ASC`
        : `${mapped === "valor" && launches ? "(valor - COALESCE(desconto,0) + COALESCE(acrescimo,0))" : mapped} ${direction} NULLS LAST, id ${direction}, empresa_id ${direction}${settlements ? `, origem ${direction}` : ""}`;
    return { source, where: clauses.length ? clauses.join(" AND ") : "TRUE", values, order, launches, cash };
}

export async function listRecords(config: Config, query: ListQuery, ids: string[], exact: Record<string, unknown> = {}) {
    const built = buildList(config, query, ids, exact);
    const { source, where, values, order, launches, cash } = built;
    const size = query.tamanho ?? 50;
    const paginated = query.pagina !== undefined || query.tamanho !== undefined || (cash && query.ultima_pagina !== undefined);
    const limit = paginated ? `LIMIT ${size} OFFSET ((SELECT pagina FROM meta) - 1) * ${size}` : "";
    const summary = launches && !query.opcoes ? `, COALESCE(SUM(saldo) FILTER (WHERE tipo = 'pagar' AND status NOT IN ('pago','cancelado')),0) AS pagar,
        COALESCE(SUM(saldo) FILTER (WHERE tipo = 'receber' AND status NOT IN ('pago','cancelado')),0) AS receber,
        COALESCE(SUM(total_baixado_liquido) FILTER (WHERE tipo = 'pagar' AND status <> 'cancelado'),0) AS pago,
        COALESCE(SUM(total_baixado_liquido) FILTER (WHERE tipo = 'receber' AND status <> 'cancelado'),0) AS recebido`
        : config.table === "pessoas" ? ", COUNT(*) FILTER (WHERE NOT COALESCE(cliente,FALSE) AND NOT COALESCE(fornecedor,FALSE))::int AS sem_vinculo" : "";
    let opening = "";
    if (cash) {
        let priorWhere = "FALSE";
        if (query.data_inicial) {
            const prior = buildList(config, { ...query, data_inicial: undefined, data_final: undefined }, ids, exact);
            const offset = values.length - 1;
            priorWhere = prior.where.replace(/\$(\d+)/g, (_, index: string) => "$" + (Number(index) === 1 ? 1 : Number(index) + offset));
            values.push(...prior.values.slice(1), query.data_inicial);
            priorWhere += ` AND data_baixa < $${values.length}::date`;
        }
        opening = `, opening AS (SELECT COALESCE(SUM(CASE WHEN origem = 'recebimentos' THEN valor ELSE -valor END),0) AS saldo_anterior FROM base WHERE ${priorWhere})`;
    }
    const cashSummary = cash ? ", COALESCE(SUM(CASE WHEN origem = 'recebimentos' THEN valor ELSE -valor END),0) AS movimento, (SELECT saldo_anterior FROM opening) AS saldo_anterior" : "";
    const balanceSort = cash && ["saldo_antes", "saldo_depois"].includes(query.ordem || "");
    const balanceOrder = balanceSort ? "data_baixa asc NULLS LAST, id asc, empresa_id asc, origem asc" : order;
    const ledgerColumns = cash ? `, data_baixa::text AS data, CASE WHEN origem = 'recebimentos' THEN 'Entrada' ELSE 'Saída' END AS tipo_caixa,
        CASE WHEN origem = 'recebimentos' THEN valor ELSE -valor END AS valor_caixa,
        COALESCE(SUM(CASE WHEN origem = 'recebimentos' THEN valor ELSE -valor END) OVER (ORDER BY ${balanceOrder} ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) + (SELECT saldo_anterior FROM opening) AS saldo_antes,
        SUM(CASE WHEN origem = 'recebimentos' THEN valor ELSE -valor END) OVER (ORDER BY ${balanceOrder} ROWS UNBOUNDED PRECEDING) + (SELECT saldo_anterior FROM opening) AS saldo_depois` : "";
    const cashColumns = balanceSort ? "" : ledgerColumns;
    // Preserva os tipos textuais que o driver pg já retornava para NUMERIC e BIGINT.
    const textNumbers = launches ? ["valor", "desconto", "acrescimo", "numero"]
        : cash || config.table === "recebimentos" || config.table === "movimentacoes" ? ["valor"] : [];
    const pageJson = textNumbers.length ? `to_jsonb(page) || jsonb_build_object(${textNumbers.map(key => `'${key}', page.${key}::text`).join(", ")})` : "row_to_json(page)";
    const result = await pool.query(`WITH base AS NOT MATERIALIZED (${source})${opening}, filtered AS NOT MATERIALIZED (
        SELECT base.*, (SELECT e.identificador FROM empresas e WHERE e.id = base.empresa_id) AS empresa_identificador FROM base WHERE ${where}
    ), totals AS (SELECT COUNT(*)::int AS total${summary}${cashSummary} FROM filtered),
    meta AS (SELECT *, ${cash && query.ultima_pagina ? "GREATEST(1, CEIL(total::numeric / " + size + ")::int)" : `LEAST(${query.pagina ?? 1}, GREATEST(1, CEIL(total::numeric / ${size})::int))`} AS pagina,
        GREATEST(1, CEIL(total::numeric / ${size})::int) AS paginas FROM totals),
    ${balanceSort ? "ledger AS (SELECT *" + ledgerColumns + " FROM filtered)," : ""}
    page AS (SELECT *${cashColumns} FROM ${balanceSort ? "ledger" : "filtered"} ORDER BY ${order} ${limit})
    SELECT COALESCE((SELECT json_agg(${pageJson}) FROM page), '[]'::json) AS data, row_to_json(meta) AS meta FROM meta`, values);
    const response = result.rows[0];
    for (const row of response.data) {
        for (const key of ["created_at", "competencia", "data_vencimento", "data_movimentacao", "data_recebimento"]) {
            if (!row[key]) continue;
            const value = String(row[key]);
            row[key] = new Date(value.length === 10 ? value + "T00:00:00" : value).toISOString();
        }
    }
    return response;
}

export async function dashboardSummary(ids: string[], day: string, year?: number) {
    const result = await pool.query(`WITH accounts AS (${launchesSql}), settlements AS (
        SELECT * FROM (${settlementsSql()}) s ${year ? "WHERE data_baixa >= $3::date AND data_baixa < $4::date" : ""}),
        overdue AS (SELECT * FROM accounts WHERE status IN ('pendente', 'parcial') AND saldo > 0 AND data_vencimento < $2::date)
        SELECT json_build_object(
            'pagar', COALESCE((SELECT SUM(saldo) FROM accounts WHERE tipo = 'pagar' AND status NOT IN ('pago','cancelado')),0),
            'receber', COALESCE((SELECT SUM(saldo) FROM accounts WHERE tipo = 'receber' AND status NOT IN ('pago','cancelado')),0),
            'totalPaid', COALESCE((SELECT SUM(valor) FROM settlements),0),
            'overdue', (SELECT COUNT(*) FROM overdue),
            'automaticOverdue', (SELECT COUNT(*) FROM overdue o JOIN empresas e ON e.id = o.empresa_id WHERE e.avisar_contas_vencidas),
            'overdueRows', COALESCE((SELECT json_agg(a) FROM (SELECT * FROM overdue ORDER BY data_vencimento, id LIMIT 5) a),'[]'::json),
            'rows', COALESCE((SELECT json_agg(a) FROM (SELECT * FROM accounts ORDER BY created_at DESC, id DESC LIMIT 6) a),'[]'::json),
            'flowRows', COALESCE((SELECT json_agg(f) FROM (SELECT tipo, date_trunc('month', data_baixa)::date::text AS data_fluxo,
                SUM(valor) AS valor FROM settlements GROUP BY tipo, date_trunc('month', data_baixa)) f),'[]'::json)
        ) AS data`, year ? [ids, day, `${String(year).padStart(4, "0")}-01-01`, `${String(year + 1).padStart(4, "0")}-01-01`] : [ids, day]);
    return result.rows[0];
}

export async function alertsSummary(ids: string[], day: string) {
    const result = await pool.query(`SELECT json_build_object(
        'overdue', (SELECT COUNT(*) FROM lancamentos WHERE empresa_id = ANY($1::uuid[]) AND status IN ('pendente', 'parcial') AND data_vencimento < $2::date),
        'automaticOverdue', (SELECT COUNT(*) FROM lancamentos l JOIN empresas e ON e.id = l.empresa_id
            WHERE l.empresa_id = ANY($1::uuid[]) AND l.status IN ('pendente', 'parcial') AND l.data_vencimento < $2::date AND e.avisar_contas_vencidas),
        'overdueRows', COALESCE((SELECT json_agg(a) FROM (
            SELECT l.*, GREATEST(0, l.valor - COALESCE(l.desconto,0) + COALESCE(l.acrescimo,0) - COALESCE((
                SELECT SUM(valor) FROM (SELECT valor + desconto - acrescimo AS valor FROM movimentacoes m WHERE m.empresa_id = l.empresa_id AND m.lancamento_id = l.id
                    UNION ALL SELECT valor + desconto - acrescimo FROM recebimentos r WHERE r.empresa_id = l.empresa_id AND r.lancamento_id = l.id) s),0)) AS saldo
            FROM (SELECT * FROM lancamentos WHERE empresa_id = ANY($1::uuid[]) AND status IN ('pendente', 'parcial') AND data_vencimento < $2::date
                ORDER BY data_vencimento, id LIMIT 5) l
        ) a), '[]'::json)) AS data`, [ids, day]);
    return result.rows[0];
}
