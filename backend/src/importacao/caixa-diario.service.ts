import { historicalRecordId } from "../utils/access-import";
import type { PoolClient } from "pg";
import { pool } from "../db";
import { createDailyCash, dailyCashImportId, dailyCashSchema, resolveDailyCashPlan, legacyDailyCashImportId } from "../caixa/caixa-diario.service";
import { SettlementError } from "../lancamentos/settlement.service";
import { analyzeCash, cashColumns, prepareCash, type CashDay, type CashImportInput, type MappedCashInput } from "./caixa-diario.plan";

async function validateMappings(client: PoolClient, userId: string, input: MappedCashInput, normalFiliais: Set<string>) {
    const companies = [...new Set(Object.values(input.filiais).map(mapping => mapping.empresa_id))].sort();
    // Ordem fixa evita deadlocks entre cargas que abrangem mais de uma empresa.
    for (const company of companies) {
        const access = await client.query(`SELECT e.id FROM empresas e JOIN users_empresas ue ON ue.empresa_id = e.id
            JOIN users u ON u.id = ue.user_id
            WHERE ue.user_id = $1 AND e.id = $2 AND e.ativo = TRUE AND u.ativo = TRUE
            AND (u.role = 'admin' OR e.licenca_expira_em > CURRENT_TIMESTAMP) FOR UPDATE OF e`, [userId, company]);
        if (!access.rowCount) throw new SettlementError("Você não tem acesso a todas as empresas de destino", 403);
    }
    const banks = new Map<string, string>();
    for (const [filial, mapping] of Object.entries(input.filiais)) {
        const type = await client.query("SELECT 1 FROM tipos_caixa_diario WHERE empresa_id = $1 AND id = $2 FOR SHARE", [mapping.empresa_id, mapping.tipo_caixa_diario_id]);
        if (!type.rowCount) throw new SettlementError("Tipo de caixa não encontrado nesta empresa");
        const selected = Object.values(mapping.formas).filter((id): id is string => Boolean(id));
        if (normalFiliais.has(filial) && selected.length !== 4) throw new SettlementError(`Selecione as quatro formas da filial ${filial}`);
        if (!selected.length) continue;
        const forms = await client.query<{ id: string; banco_id: string }>(`SELECT f.id, f.banco_id FROM formas_pagamento f
            JOIN bancos b ON b.id = f.banco_id AND b.empresa_id = f.empresa_id
            WHERE f.empresa_id = $1 AND f.id = ANY($2::uuid[]) AND f.ativo = TRUE FOR SHARE OF f, b`, [mapping.empresa_id, selected]);
        if (forms.rows.length !== selected.length) throw new SettlementError("Escolha quatro formas distintas, ativas e com banco na empresa de destino");
        for (const form of forms.rows) banks.set(form.id, form.banco_id);
    }
    return banks;
}

export async function importDailyCash(userId: string, input: CashImportInput) {
    if (input.acao === "analisar") return analyzeCash(input);
    const plan = prepareCash(input);
    const system = input.sistema || plan.sistemas[0]!;
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const banks = await validateMappings(client, userId, input, new Set(plan.dias.filter(day => !day.historico).map(day => day.filial)));
        const plans = new Map<string, string>();
        for (const company of [...new Set(Object.values(input.filiais).map(mapping => mapping.empresa_id))].sort()) plans.set(company, (await resolveDailyCashPlan(client, company, system)).id);
        const conflitos: { filial: string; data: string }[] = [];
        const resolved = new Set(input.resolvidos);
        const checkedDays = plan.dias.filter(day => input.acao !== "manual" || day.chave === input.chave);
        const existingDays = new Map<string, { id: string; data: string; plano_conta_id?: string; observacoes?: string; tipo_descricao?: string }[]>();
        for (const company of new Set(checkedDays.map(day => input.filiais[day.filial]!.empresa_id))) {
            const dates = checkedDays.filter(day => input.filiais[day.filial]!.empresa_id === company).map(day => day.data);
            const existing = await client.query<{ id: string; data: string; plano_conta_id?: string; observacoes?: string; tipo_descricao?: string }>(`SELECT l.id, to_char(l.data_vencimento, 'YYYY-MM-DD') AS data, l.plano_conta_id, l.observacoes, t.descricao AS tipo_descricao
                FROM lancamentos l LEFT JOIN tipos_caixa_diario t ON t.empresa_id=l.empresa_id AND t.id=l.tipo_caixa_diario_id WHERE l.empresa_id=$1 AND (l.id=ANY($3::uuid[]) OR l.data_vencimento=ANY($2::date[]))`,
                [company, dates, dates.flatMap(date => [dailyCashImportId(company, date, plans.get(company)), legacyDailyCashImportId(company, date), legacyDailyCashImportId(company, date, system)])]);
            existingDays.set(company, existing.rows);
        }
        for (const day of checkedDays) {
            const company = input.filiais[day.filial]!.empresa_id;
            const expectedId = dailyCashImportId(company, day.data, plans.get(company));
            const legacyId = legacyDailyCashImportId(company, day.data, system);
            const existing = existingDays.get(company)!.filter(row => row.id === expectedId || row.id === legacyId || (row.data === day.data && (row.plano_conta_id === plans.get(company) || (row.observacoes?.startsWith("Importação Caixa Diário • Filial ") && row.observacoes.split(" • ")[2] === system) || (row.id === legacyDailyCashImportId(company, day.data) && row.tipo_descricao === system))));
            if (resolved.has(day.chave)) {
                if (existing.length !== 1 || ![expectedId, legacyId, legacyDailyCashImportId(company, day.data)].includes(existing[0]!.id)) throw new SettlementError(`Resolução manual não encontrada ou conflitante: ${day.data}`);
            } else if (existing.length) conflitos.push({ filial: day.filial, data: day.data });
        }
        if (input.acao === "manual" && conflitos.length) throw new SettlementError(`Caixas já existentes: ${conflitos.map(item => `filial ${item.filial}: ${item.data}`).join("; ")}`, 409);
        const valuesFor = (day: CashDay) => {
            const mapping = input.filiais[day.filial]!;
            const values = { data: day.data, tipo_caixa_diario_id: mapping.tipo_caixa_diario_id, valor: day.total,
                observacoes: `Importação Caixa Diário • Filial ${day.filial} • ${day.sistemas.join(", ")}`,
                baixas: day.historico ? [] : cashColumns.filter(column => day.valores[column] > 0).map(column => ({
                    banco_id: banks.get(mapping.formas[column]!)!, forma_pagamento_id: mapping.formas[column]!, valor: day.valores[column],
                })) };
            return day.total > 0 ? dailyCashSchema.parse(values) : values;
        };
        if (input.acao === "manual") {
            const day = plan.dias.find(item => item.chave === input.chave);
            if (!day?.pendencias.length || resolved.has(day.chave)) throw new SettlementError("Dia não está pendente");
            const mapping = input.filiais[day.filial]!;
            if (input.valores.data !== day.data || input.valores.tipo_caixa_diario_id !== mapping.tipo_caixa_diario_id)
                throw new SettlementError("A data e o tipo devem corresponder ao dia pendente");
            const result = await createDailyCash(mapping.empresa_id, input.valores, client, true, false, plans.get(mapping.empresa_id));
            await client.query("COMMIT");
            return { id: result.id, chave: day.chave };
        }
        const existingKeys = new Set(conflitos.map(day => `${day.filial}:${day.data}`));
        const ignored = plan.dias.filter(day => existingKeys.has(day.chave));
        const ready = plan.dias.filter(day => !existingKeys.has(day.chave) && !day.pendencias.length && day.total > 0);
        // Valida também a resposta/prévia inteira antes de qualquer commit.
        const dias = plan.dias.map(day => ({ ...day, empresa_id: input.filiais[day.filial]!.empresa_id,
            status: resolved.has(day.chave) ? "resolvido" : existingKeys.has(day.chave) ? "existente" : day.pendencias.length ? "pendente" : day.total > 0 ? "pronto" : "zero", valores_formulario: valuesFor(day) }));
        if (input.acao === "importar") {
            for (const day of ready) {
                const company = input.filiais[day.filial]!.empresa_id;
                const values = valuesFor(day);
                if (day.historico) {
                    const banco = historicalRecordId(company, "bancos")!, forma = historicalRecordId(company, "formas_pagamento")!;
                    await client.query("INSERT INTO bancos (id, empresa_id, descricao, ativo) VALUES ($1,$2,'Baixa histórica',FALSE) ON CONFLICT DO NOTHING", [banco, company]);
                    await client.query("INSERT INTO formas_pagamento (id, empresa_id, descricao, tipo, banco_id, ativo) VALUES ($1,$2,'Baixa histórica','outro',$3,FALSE) ON CONFLICT DO NOTHING", [forma, company, banco]);
                    values.baixas = [{ banco_id: banco, forma_pagamento_id: forma, valor: day.total }];
                }
                await createDailyCash(company, values, client, true, Boolean(day.historico), plans.get(company));
            }
            await client.query("COMMIT");
        } else await client.query("ROLLBACK");
        return { ...plan, dias,
            planos: Object.fromEntries(plans),
            avisos: ignored.filter(day => existingDays.get(input.filiais[day.filial]!.empresa_id)?.some(row => row.data === day.data && row.plano_conta_id !== plans.get(input.filiais[day.filial]!.empresa_id))).map(day => `Filial ${day.filial}, ${day.data}: carga anterior reconhecida; plano original preservado`),
            conflitos, ignorados: ignored.length, total_ignorado: ignored.reduce((sum, day) => sum + Math.round(day.total * 100), 0) / 100,
            dias_importados: input.acao === "importar" ? ready.map(day => ({ filial: day.filial, data: day.data })) : [],
            importados: input.acao === "importar" ? ready.length : 0,
            total: ready.reduce((sum, day) => sum + Math.round(day.total * 100), 0) / 100,
            quantidade: ready.length };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
}
