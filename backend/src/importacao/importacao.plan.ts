import { z } from "zod";
import { personCreateSchema } from "../pessoas/pessoas.service";
import type { LaunchInput } from "../lancamentos/lancamentos.service";
import { liquidValue, validateLaunchAmounts } from "../lancamentos/launch-values";
import { SettlementError } from "../lancamentos/settlement.service";
import { accessDate, accessMoney, parseAccessText, type AccessRow } from "./access-text";
import { historicalRecordId, importId } from "../utils/access-import";
export { importId } from "../utils/access-import";

const filenames = ["pessoas.txt", "bancos.txt", "forma_pagamento.txt", "plano_contas.txt", "contas_a_pagar.txt", "contas_a_receber.txt", "recebimentos.txt"] as const;
type Filename = typeof filenames[number];
export const importSchema = z.object({
    filiais: z.object({ "1": z.string().uuid(), "2": z.string().uuid(), "3": z.string().uuid().optional() }).strict()
        .refine(value => new Set(Object.values(value).filter(Boolean)).size === Object.values(value).filter(Boolean).length, "Informe UUIDs diferentes para cada filial"),
    arquivos: z.object(Object.fromEntries(filenames.map(name => [name, z.string().min(1)])) as Record<Filename, z.ZodString>).strict(),
    simular: z.boolean().default(true),
}).strict();
export type ImportInput = z.infer<typeof importSchema>;
export type ImportIssue = { arquivo: string; codigo: string; motivo: string };
type RecordInput = { id: string; empresaId: string; values: Record<string, string | boolean | null> };
type Payment = { formaId: string; valor: number; data: string; codigo: string; historica?: boolean };
type Launch = { id: string; empresaId: string; codigo: string; input: LaunchInput; payments: Payment[]; clienteSemNome?: string };
export type ImportPlan = {
    pessoas: RecordInput[]; bancos: RecordInput[]; formas: RecordInput[]; planos: RecordInput[]; contas: Launch[];
    ignorados: ImportIssue[]; pendencias: ImportIssue[]; avisos: ImportIssue[]; filiaisEncontradas: string[];
};

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
function formType(name: string) {
    const nameKey = normalize(name);
    if (nameKey === "dinheiro") return "dinheiro";
    if (nameKey === "pix") return "pix";
    if (nameKey.includes("debito")) return "debito";
    if (nameKey.includes("credito")) return "credito";
    if (nameKey === "boleto") return "boleto";
    if (["ted", "contacorrente", "transfbancaria", "transferenciabancaria"].includes(nameKey)) return "transferencia";
    return "outro";
}

export function prepareImport(input: ImportInput): ImportPlan {
    const plan: ImportPlan = { pessoas: [], bancos: [], formas: [], planos: [], contas: [], ignorados: [], pendencias: [], avisos: [], filiaisEncontradas: [] };
    const rows = Object.fromEntries(filenames.map(file => [file, parseAccessText(input.arquivos[file], file)])) as Record<Filename, AccessRow[]>;
    const requireColumns = (file: Filename, columns: string[]) => {
        parseAccessText(input.arquivos[file], file, columns);
    };
    requireColumns("pessoas.txt", ["Ident", "Cliente", "CNPJ_CPF", "Ativo"]);
    requireColumns("bancos.txt", ["Cod", "Identificacao", "Ativo"]);
    requireColumns("forma_pagamento.txt", ["Cod", "Cod_Banco", "Forma", "Ativo"]);
    requireColumns("plano_contas.txt", ["Cód_Plano", "Plano_de_Contas"]);
    for (const file of ["contas_a_pagar.txt", "contas_a_receber.txt"] as const)
        requireColumns(file, ["Cod", "Filial", "Cód_Plano", "Conta_Descrição", "Conta_Vecto", "Conta_Valor", "Desconto", "Acréscimo", "Pagto_Valor", "Pagto_Data", "Forma_Pagto", "Competência"]);
    requireColumns("contas_a_receber.txt", ["Ident_Cliente"]);
    requireColumns("recebimentos.txt", ["Cod_Pagto", "Cod_Conta", "Data_Pagto", "Filial", "Cod_Forma_Pagto", "Cod_Banco", "Valor_Pagto", "Tipo"]);
    function index(file: Filename, field: string) {
        const result = new Map<string, AccessRow>();
        for (const row of rows[file]) {
            const code = row[field];
            if (!/^\d+$/.test(code) || result.has(code)) throw new SettlementError(`${file}: identificador inválido ou duplicado (${code})`);
            result.set(code, row);
        }
        return result;
    }
    const people = index("pessoas.txt", "Ident"), banks = index("bancos.txt", "Cod"), forms = index("forma_pagamento.txt", "Cod"), plans = index("plano_contas.txt", "Cód_Plano");
    const personInputs = new Map<string, z.infer<typeof personCreateSchema>>();
    const namelessPeople = new Set<string>();
    for (const [code, row] of people) {
        if (!row.Cliente.trim()) namelessPeople.add(code);
        const parsed = personCreateSchema.safeParse({ nome: row.Cliente, documento: row.CNPJ_CPF || null, cliente: true, fornecedor: false, ativo: row.Ativo === "1",
            razao_social: row["Razão_Social"] || null, endereco: row.Endereco || null, responsavel_nome: row.Resp_Nome || null, responsavel_cpf: row.Resp_CPF || null, observacoes: row.Obs || null });
        if (parsed.success) personInputs.set(code, parsed.data);
        else plan.pendencias.push({ arquivo: "pessoas.txt", codigo: code, motivo: parsed.error.issues.map(issue => issue.path[0] === "nome" && issue.code === "too_small"
            ? "Nome do cliente vazio" : `${issue.path.join(".")}: ${issue.message}`).join("; ") });
    }
    index("recebimentos.txt", "Cod_Pagto");
    const accountRows = new Map<string, { row: AccessRow; file: Filename; tipo: "pagar" | "receber" }>();
    for (const [file, tipo, prefix] of [["contas_a_pagar.txt", "pagar", "0"], ["contas_a_receber.txt", "receber", "1"]] as const)
        for (const [code, row] of index(file, "Cod")) accountRows.set(`${prefix}:${code}`, { row, file, tipo });
    const companyFor = (filial: string) => {
        if (!filial || filial === "0") return undefined;
        if (!["1", "2", "3"].includes(filial)) throw new SettlementError(`Filial legada desconhecida: ${filial}`);
        if (!plan.filiaisEncontradas.includes(filial)) plan.filiaisEncontradas.push(filial);
        const company = input.filiais[filial as keyof ImportInput["filiais"]];
        if (!company) throw new SettlementError(`Informe o UUID da filial ${filial}`);
        return company;
    };
    const usedBanks = new Map<string, RecordInput>(), usedForms = new Map<string, RecordInput>(), usedPlans = new Map<string, RecordInput>();
    function bankFor(company: string, code: string): string | null {
        if (!code) return null;
        const row = banks.get(code);
        if (!row) throw new SettlementError(`Banco legado não encontrado: ${code}`);
        const id = importId(company, "bancos", code);
        usedBanks.set(id, { id, empresaId: company, values: { descricao: z.string().trim().min(1).max(200).parse(row.Identificacao), ativo: row.Ativo === "1" } });
        return id;
    }
    function formFor(company: string, code: string): string {
        const row = forms.get(code);
        if (!row) throw new SettlementError(`Forma de pagamento legada não encontrada: ${code}`);
        const bank = bankFor(company, row.Cod_Banco);
        const id = importId(company, "formas_pagamento", code);
        usedForms.set(id, { id, empresaId: company, values: { descricao: row.Forma, tipo: formType(row.Forma), banco_id: bank, ativo: row.Ativo === "1" } });
        return id;
    }
    function historicalFormFor(company: string): string {
        const bankId = historicalRecordId(company, "bancos")!;
        const formId = historicalRecordId(company, "formas_pagamento")!;
        usedBanks.set(bankId, { id: bankId, empresaId: company, values: { descricao: "Baixa histórica", ativo: false } });
        usedForms.set(formId, { id: formId, empresaId: company, values: { descricao: "Baixa histórica", tipo: "outro", banco_id: bankId, ativo: false } });
        return formId;
    }
    const grouped = new Map<string, AccessRow[]>();
    for (const row of rows["recebimentos.txt"]) {
        const issue = { arquivo: "recebimentos.txt", codigo: row.Cod_Pagto, motivo: "" };
        if (!["0", "1"].includes(row.Tipo)) throw new SettlementError(`Baixa ${row.Cod_Pagto}: Tipo deve ser 0=Pagar ou 1=Receber`);
        if (!companyFor(row.Filial)) { plan.ignorados.push({ ...issue, motivo: `Filial ${row.Filial || "vazia"}; conta ${row.Cod_Conta}` }); continue; }
        const key = `${row.Tipo}:${row.Cod_Conta}`;
        if (!accountRows.has(key)) { plan.ignorados.push({ ...issue, motivo: `Conta ${row.Tipo === "0" ? "a pagar" : "a receber"} ${row.Cod_Conta} ausente` }); continue; }
        grouped.set(key, [...grouped.get(key) || [], row]);
    }
    const personCompanies = new Map<string, Set<string>>();
    for (const [key, { row, file, tipo }] of accountRows) {
        const company = companyFor(row.Filial);
        const issue = { arquivo: file, codigo: row.Cod, motivo: "" };
        if (!company) { plan.ignorados.push({ ...issue, motivo: `Filial ${row.Filial || "vazia"}` }); continue; }
        if (tipo === "receber" && row.Ident_Cliente && row.Ident_Cliente !== "0") {
            const companies = personCompanies.get(row.Ident_Cliente) || new Set<string>();
            companies.add(company); personCompanies.set(row.Ident_Cliente, companies);
        }
        try {
            const amounts = validateLaunchAmounts({ valor: accessMoney(row.Conta_Valor, row.Cod), desconto: accessMoney(row.Desconto, row.Cod), acrescimo: accessMoney(row["Acréscimo"], row.Cod) });
            const due = accessDate(row.Conta_Vecto, row.Cod);
            const competence = row["Competência"] ? /^(\d{4})-(\d{1,2})-/.exec(row["Competência"]) : null;
            if (row["Competência"] && (!competence || Number(competence[2]) < 1 || Number(competence[2]) > 12)) throw new SettlementError("Competência inválida");
            const accountId = importId(company, "lancamentos", key);
            let personId: string | null = null;
            let clienteSemNome: string | undefined;
            if (tipo === "receber" && row.Ident_Cliente && row.Ident_Cliente !== "0") {
                if (namelessPeople.has(row.Ident_Cliente)) clienteSemNome = row.Ident_Cliente;
                else {
                    if (!personInputs.has(row.Ident_Cliente)) throw new SettlementError(`Cliente ${row.Ident_Cliente} ausente ou inválido`);
                    personId = importId(company, "pessoas", row.Ident_Cliente);
                }
            }
            let planId: string | null = null;
            if (row["Cód_Plano"]) {
                const sourcePlan = plans.get(row["Cód_Plano"]);
                if (!sourcePlan) throw new SettlementError(`Plano ${row["Cód_Plano"]} ausente`);
                planId = importId(company, "planos_contas", row["Cód_Plano"]);
                usedPlans.set(planId, { id: planId, empresaId: company, values: { descricao: sourcePlan.Plano_de_Contas } });
            }
            const payments: Payment[] = [];
            const sourcePayments = grouped.get(key) || [];
            for (const payment of sourcePayments) {
                if (payment.Filial !== row.Filial) throw new SettlementError(`Baixa ${payment.Cod_Pagto} pertence à filial ${payment.Filial}, diferente da conta (${row.Filial})`);
                const amount = accessMoney(payment.Valor_Pagto, payment.Cod_Pagto);
                if (amount <= 0) {
                    plan.pendencias.push({ arquivo: "recebimentos.txt", codigo: payment.Cod_Pagto, motivo: `Valor da baixa não positivo; conta ${row.Cod}` });
                    continue;
                }
                const sourceForm = forms.get(payment.Cod_Forma_Pagto);
                if (!sourceForm || sourceForm.Cod_Banco !== payment.Cod_Banco) throw new SettlementError(`Banco/forma da baixa ${payment.Cod_Pagto} não corresponde ao cadastro`);
                payments.push({ codigo: payment.Cod_Pagto, formaId: formFor(company, payment.Cod_Forma_Pagto), valor: amount, data: accessDate(payment.Data_Pagto, payment.Cod_Pagto) });
            }
            const settled = Math.round(payments.reduce((sum, payment) => sum + payment.valor, 0) * 100) / 100;
            const paid = accessMoney(row.Pagto_Valor, row.Cod);
            if (paid < 0) throw new SettlementError("Resumo de pagamento negativo");
            if (settled > liquidValue(amounts) + 0.009 || paid > liquidValue(amounts) + 0.009) throw new SettlementError("Pagamento maior que o valor líquido da conta");
            if (paid > settled + 0.009) {
                if (!row.Pagto_Data) throw new SettlementError("Pagamento histórico sem Pagto_Data; conta e baixas não importadas");
                const date = accessDate(row.Pagto_Data, "Pagto_Data da baixa histórica");
                payments.push({ codigo: `historica:${key}`, formaId: historicalFormFor(company), valor: Math.round((paid - settled) * 100) / 100, data: date, historica: true });
            }
            if (settled > paid + 0.009) plan.avisos.push({ ...issue, motivo: "Total das baixas supera Pagto_Valor; preservadas as baixas detalhadas" });
            const bankIds = new Set(payments.map(payment => usedForms.get(payment.formaId)?.values.banco_id).filter((id): id is string => typeof id === "string"));
            if (bankIds.size > 1) plan.avisos.push({ ...issue, motivo: "Baixas em múltiplos bancos: banco preservado em cada forma; conta sem banco único" });
            const launchInput: LaunchInput = {
                descricao: z.string().trim().min(1).max(200).parse(row["Conta_Descrição"]), ...amounts, tipo,
                data_vencimento: due, competencia: competence ? `${competence[1]}-${competence[2].padStart(2, "0")}-01` : due.slice(0, 7) + "-01",
                pessoa_id: personId, banco_id: bankIds.size === 1 ? [...bankIds][0] : null, plano_conta_id: planId,
                num_doc: z.string().max(100).nullable().parse(row.Num_DOC || row.Num_Nota || null), observacoes: row.Obs || null,
            };
            plan.contas.push({ id: accountId, empresaId: company, codigo: row.Cod, input: launchInput, payments, clienteSemNome });
            if (clienteSemNome) plan.avisos.push({ ...issue, motivo: `Cliente ${clienteSemNome} sem nome; conta importada sem vínculo de pessoa` });
        } catch (error) {
            if (!(error instanceof z.ZodError) && !(error instanceof SettlementError)) throw error;
            plan.pendencias.push({ ...issue, motivo: error instanceof z.ZodError ? error.issues.map(item => `${item.path.join(".")}: ${item.message}`).join("; ") : error.message });
            for (const payment of grouped.get(key) || []) plan.pendencias.push({ arquivo: "recebimentos.txt", codigo: payment.Cod_Pagto, motivo: `Conta ${tipo} ${row.Cod} com pendência; baixa não planejada` });
        }
    }
    for (const [code, person] of personInputs) {
        const companies = personCompanies.get(code) || new Set([input.filiais["1"]]);
        for (const company of companies) plan.pessoas.push({ id: importId(company, "pessoas", code), empresaId: company, values: person as Record<string, string | boolean | null> });
    }
    const plannedFormIds = new Set(plan.contas.flatMap(account => account.payments.map(payment => payment.formaId)));
    const plannedPlanIds = new Set(plan.contas.map(account => account.input.plano_conta_id));
    plan.formas = [...usedForms.values()].filter(form => plannedFormIds.has(form.id));
    const plannedBankIds = new Set(plan.formas.map(form => form.values.banco_id));
    plan.bancos = [...usedBanks.values()].filter(bank => plannedBankIds.has(bank.id));
    plan.planos = [...usedPlans.values()].filter(accountPlan => plannedPlanIds.has(accountPlan.id));
    plan.filiaisEncontradas.sort();
    return plan;
}

export function importReport(plan: ImportPlan) {
    const payments = plan.contas.flatMap(account => account.payments);
    return { filiais_encontradas: plan.filiaisEncontradas, totais: {
        pessoas: plan.pessoas.length, bancos: plan.bancos.length, formas_pagamento: plan.formas.length, planos_contas: plan.planos.length,
        contas_a_pagar: plan.contas.filter(account => account.input.tipo === "pagar").length,
        contas_a_receber: plan.contas.filter(account => account.input.tipo === "receber").length,
        baixas: payments.length,
        baixas_historicas: payments.filter(payment => payment.historica).length,
        valor_baixas_historicas: Math.round(payments.filter(payment => payment.historica).reduce((sum, payment) => sum + payment.valor, 0) * 100) / 100,
        contas_sem_cliente: plan.contas.filter(account => account.clienteSemNome).length,
        valor_liquido: Math.round(plan.contas.reduce((sum, account) => sum + liquidValue(account.input), 0) * 100) / 100,
    }, ignorados: plan.ignorados, pendencias: plan.pendencias, avisos: plan.avisos };
}
