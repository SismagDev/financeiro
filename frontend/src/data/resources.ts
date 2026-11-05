import type { Resource } from "../types";

export const resources: Resource[] = [
    {
        key: "lancamentos",
        title: "Contas",
        endpoint: "/lancamentos",
        singular: "conta",
        icon: "arrows",
        fields: [
            { name: "pessoa_id", label: "Cliente", type: "select", source: "pessoas", wide: true },
            { name: "descricao", label: "Descrição", required: true, wide: true },
            { name: "num_doc", label: "Num DOC", maxLength: 100 },
            { name: "plano_conta_id", label: "Plano de contas", type: "select", source: "planos", wide: true },
            { name: "valor", label: "Valor", type: "number", required: true },
            {
                name: "tipo",
                label: "Tipo",
                type: "select",
                required: true,
                options: [
                    ["pagar", "A pagar"],
                    ["receber", "A receber"],
                ],
            },
            { name: "data_vencimento", label: "Vencimento", type: "date", required: true },
            { name: "competencia", label: "Competência", required: true },
            { name: "banco_id", label: "Instituição", type: "select", source: "bancos" },
            { name: "parcelas", label: "Número de parcelas", type: "number", required: true, wide: true },
            { name: "observacoes", label: "Observações", type: "textarea", wide: true },
        ],
        columns: [
            ["numero", "Nº"],
            ["pessoa_id", "Cliente"],
            ["descricao", "Descrição"],
            ["tipo", "Tipo"],
            ["data_vencimento", "Vencimento"],
            ["plano_conta_id", "Plano de contas"],
            ["valor", "Valor líquido"],
            ["saldo", "Saldo para quitação"],
        ],
    },
    {
        key: "pessoas",
        title: "Pessoas",
        endpoint: "/pessoas",
        singular: "pessoa",
        icon: "users",
        fields: [
            { name: "nome", label: "Nome / nome fantasia", required: true, wide: true },
            { name: "razao_social", label: "Razão social", wide: true },
            { name: "documento", label: "CPF ou CNPJ" },
            { name: "celular", label: "Celular" },
            { name: "endereco", label: "Endereço", wide: true, maxLength: 500 },
            { name: "responsavel_nome", label: "Nome do responsável" },
            { name: "responsavel_cpf", label: "CPF do responsável", maxLength: 14 },
            { name: "cliente", label: "É cliente", type: "checkbox" },
            { name: "fornecedor", label: "É fornecedor", type: "checkbox" },
            { name: "observacoes", label: "Observações", type: "textarea", wide: true },
        ],
        columns: [
            ["nome", "Nome / fantasia"],
            ["razao_social", "Razão social"],
            ["responsavel_nome", "Responsável"],
            ["responsavel_cpf", "CPF do Resp."],
            ["documento", "Documento"],
            ["celular", "Celular"],
            ["cliente", "Cliente"],
            ["fornecedor", "Fornecedor"],
            ["observacoes", "Observações"],
            ["endereco", "Endereço"],
        ],
    },
    {
        key: "formas",
        title: "Formas de pagamento",
        endpoint: "/formas-pagamento",
        singular: "forma de pagamento",
        icon: "card",
        fields: [
            { name: "descricao", label: "Nome", required: true, wide: true },
            {
                name: "tipo",
                label: "Tipo",
                type: "select",
                required: true,
                options: [
                    ["boleto", "Boleto"],
                    ["credito", "Cartão de crédito"],
                    ["debito", "Cartão de débito"],
                    ["dinheiro", "Dinheiro"],
                    ["outro", "Outro"],
                    ["pix", "Pix"],
                    ["transferencia", "Transferência"],
                ],
            },
            { name: "banco_id", label: "Instituição", type: "select", source: "bancos" },
        ],
        columns: [
            ["descricao", "Forma"],
            ["tipo", "Tipo"],
            ["banco_id", "Instituição"],
            ["ativo", "Ativa"],
        ],
    },
    {
        key: "bancos",
        title: "Bancos",
        endpoint: "/bancos",
        singular: "banco",
        icon: "bank",
        fields: [{ name: "descricao", label: "Nome do banco", required: true, wide: true }],
        columns: [
            ["descricao", "Banco"],
            ["ativo", "Ativo"],
        ],
    },
    {
        key: "planos",
        title: "Planos de contas",
        endpoint: "/planos-contas",
        singular: "plano de contas",
        icon: "grid",
        fields: [{ name: "descricao", label: "Nome", required: true, wide: true },
            { name: "tipo", label: "Classificação", type: "select", required: true, options: [["pagar", "Pagar"], ["receber", "Receber"], ["ambos", "Receber/Pagar"]] }],
        columns: [["descricao", "Plano de contas"], ["tipo", "Classificação"]],
    },
    {
        key: "movimentacoes",
        title: "Movimentações",
        endpoint: "/movimentacoes",
        singular: "movimentação",
        icon: "arrowDown",
        fields: [
            {
                name: "lancamento_id",
                label: "Conta",
                type: "select",
                source: "lancamentos",
                required: true,
                wide: true,
            },
            {
                name: "forma_pagamento_id",
                label: "Forma de pagamento",
                type: "select",
                source: "formas",
                required: true,
            },
            { name: "valor", label: "Valor", type: "number", required: true },
            { name: "data_movimentacao", label: "Data", type: "date" },
        ],
        columns: [
            ["lancamento_id", "Conta"],
            ["forma_pagamento_id", "Forma"],
            ["data_movimentacao", "Data"],
            ["valor", "Valor"],
        ],
    },
    {
        key: "recebimentos",
        title: "Recebimentos",
        endpoint: "/recebimentos",
        singular: "recebimento",
        icon: "arrowUp",
        fields: [
            {
                name: "lancamento_id",
                label: "Conta",
                type: "select",
                source: "lancamentos",
                required: true,
                wide: true,
            },
            {
                name: "forma_pagamento_id",
                label: "Forma de pagamento",
                type: "select",
                source: "formas",
                required: true,
            },
            { name: "valor", label: "Valor", type: "number", required: true },
            { name: "data_recebimento", label: "Data", type: "date" },
        ],
        columns: [
            ["lancamento_id", "Conta"],
            ["forma_pagamento_id", "Forma"],
            ["data_recebimento", "Data"],
            ["valor", "Valor"],
        ],
    },
];

// A tela unificada continua usando os dois recursos de baixa existentes.
export const baixasResource: Resource = {
    key: "baixas", title: "Baixas", endpoint: "", singular: "baixa", icon: "arrows",
    fields: resources.find(resource => resource.key === "movimentacoes")!.fields.map(field =>
        field.name === "lancamento_id" ? { ...field, label: "Cliente ou descrição da conta" } :
        field.name === "data_movimentacao" ? { ...field, name: "data_baixa" } : field),
    columns: [["pessoa_id", "Cliente"], ["descricao", "Descrição"], ["natureza", "Tipo"],
        ["forma_pagamento_id", "Forma de pagamento"], ["data_baixa", "Data"], ["valor", "Valor"]],
};

export const pagePaths: Record<string, string> = {
    dashboard: "/",
    caixa: "/caixa",
    lancamentos: "/lancamentos",
    pessoas: "/pessoas",
    formas: "/formas-pagamento",
    bancos: "/bancos",
    planos: "/planos-contas",
    baixas: "/baixas",
};

export function pageFromPath(path: string) {
    if (path === "/movimentacoes" || path === "/recebimentos") return "baixas";
    return Object.entries(pagePaths).find(([, value]) => value === path)?.[0] || "dashboard";
}
