import assert from "node:assert/strict";
import { test } from "node:test";
import { companyRows, loadCompanyResources, toggleCompany } from "../../frontend/src/utils/companies";
import type { Company } from "../../frontend/src/types";

const companies: Company[] = [
    { id: "pf", nome: "Pessoa física", perfil: "comum", identificador: "1" },
    { id: "pj", nome: "Pessoa jurídica", perfil: "comum", identificador: "1" },
    { id: "filial", nome: "Filial", perfil: "comum", identificador: null },
];

test("seleção mantém ao menos uma empresa e permite todas sem duplicação", () => {
    assert.deepEqual(toggleCompany(["pf"], "pf"), ["pf"]);
    const all = companies.reduce((ids, company) => ids.includes(company.id) ? ids : toggleCompany(ids, company.id), ["pf"]);
    assert.deepEqual(all, ["pf", "pj", "filial"]);
    assert.deepEqual(toggleCompany(all, "pj"), ["pf", "filial"]);
});

test("Todos reúne somente empresas marcadas e o filtro também restringe os cadastros dependentes", () => {
    const data = { pessoas: [{ id: "a", empresa_id: "pf" }, { id: "b", empresa_id: "pj" }, { id: "c", empresa_id: "filial" }],
        formas: [{ id: "d", empresa_id: "pf" }, { id: "e", empresa_id: "pj" }],
        planos: [{ id: "f", empresa_id: "pj" }], lancamentos: [{ id: "g", empresa_id: "pf", descricao: "PF" }] };
    assert.equal(companyRows(data, ["pf", "pj"]).pessoas.length, 2);
    assert.deepEqual(companyRows(data, ["pf", "pj"], "pj"), { pessoas: [data.pessoas[1]], formas: [data.formas[1]], planos: data.planos, lancamentos: [] });
    assert.deepEqual(companyRows(data, ["pf"], "pj").pessoas, []);
});

test("consultas usam a empresa no cabeçalho por endpoint e preservam identificadores repetidos e nulos", async () => {
    const requests: string[] = [];
    const data = await loadCompanyResources(companies, [{ key: "pessoas", endpoint: "/pessoas" }], async (path, _options, id) => {
        requests.push(`${path}:${id}`);
        return { data: [{ id: `${id}-pessoa`, empresa_id: "ignorar" }] };
    });
    assert.deepEqual(requests.sort(), ["/pessoas:filial", "/pessoas:pf", "/pessoas:pj"]);
    assert.deepEqual(data.pessoas.map(row => row.empresa_id), ["pf", "pj", "filial"]);
    assert.deepEqual(data.pessoas.map(row => row.empresa_identificador), ["1", "1", null]);
});

test("falha em uma consulta não apresenta totais parciais como se fossem completos", async () => {
    await assert.rejects(loadCompanyResources(companies, [{ key: "pessoas", endpoint: "/pessoas" }], async (_path, _options, id) => {
        if (id === "pj") throw new Error("Sem acesso");
        return { data: [] };
    }), /Sem acesso/);
});
