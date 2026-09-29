import "dotenv/config";
import { pool } from "../db";
import { hashPassword } from "./passwords";

const demoEmail = "demo@fluxo.local";
const demoPassword = "Fluxo@2026";

async function run() {
    if (process.env.NODE_ENV === "production") throw new Error("A demonstração não pode ser criada em produção.");
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não está configurada.");

    const databaseHost = new URL(process.env.DATABASE_URL).hostname;
    if (!new Set(["localhost", "127.0.0.1", "::1"]).has(databaseHost)) {
        throw new Error("O seed de demonstração só pode ser executado em um banco local.");
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const schema = await client.query<{ users: string | null; empresas: string | null }>(
            "SELECT to_regclass('public.users') AS users, to_regclass('public.empresas') AS empresas",
        );
        if (!schema.rows[0]?.users || !schema.rows[0]?.empresas) {
            throw new Error("As tabelas do sistema não existem. Aplique primeiro o SQL do banco.");
        }

        const passwordHash = await hashPassword(demoPassword);
        const userResult = await client.query<{ id: string }>(
            `INSERT INTO users (nome, email, password_hash, role, ativo)
             VALUES ('Conta de demonstração', $1, $2, 'comum', TRUE)
             ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome, password_hash = EXCLUDED.password_hash,
                role = 'comum', ativo = TRUE
             RETURNING id`,
            [demoEmail, passwordHash],
        );
        const companyResult = await client.query<{ id: string }>(
            `INSERT INTO empresas (nome, cnpj, ativo)
             VALUES ('Aurora Studio · Demonstração', '99999999000199', TRUE)
             ON CONFLICT (cnpj) DO UPDATE SET nome = EXCLUDED.nome, ativo = TRUE
             RETURNING id`,
        );
        const userId = userResult.rows[0].id;
        const empresaId = companyResult.rows[0].id;
        await client.query(
            `INSERT INTO users_empresas (user_id, empresa_id, perfil) VALUES ($1, $2, 'admin')
             ON CONFLICT (user_id, empresa_id) DO UPDATE SET perfil = 'admin'`,
            [userId, empresaId],
        );

        const insertPerson = async (nome: string, documento: string, cliente: boolean, fornecedor: boolean) => {
            const found = await client.query<{ id: string }>(
                "SELECT id FROM pessoas WHERE empresa_id = $1 AND documento = $2 LIMIT 1", [empresaId, documento],
            );
            if (found.rows[0]) return found.rows[0].id;
            const result = await client.query<{ id: string }>(
                `INSERT INTO pessoas (empresa_id, nome, documento, celular, cliente, fornecedor)
                 VALUES ($1, $2, $3, '(11) 98888-1234', $4, $5) RETURNING id`,
                [empresaId, nome, documento, cliente, fornecedor],
            );
            return result.rows[0].id;
        };
        const clienteId = await insertPerson("Marina Costa", "DEMO-CLIENTE-001", true, false);
        const fornecedorId = await insertPerson("Café do Centro", "DEMO-FORNECEDOR-001", false, true);

        const bank = await client.query<{ id: string }>(
            `INSERT INTO bancos (empresa_id, descricao) SELECT $1, 'Banco Horizonte'
             WHERE NOT EXISTS (SELECT 1 FROM bancos WHERE empresa_id = $1 AND descricao = 'Banco Horizonte')
             RETURNING id`, [empresaId],
        );
        let bancoId = bank.rows[0]?.id;
        if (!bancoId) bancoId = (await client.query<{ id: string }>(
            "SELECT id FROM bancos WHERE empresa_id = $1 AND descricao = 'Banco Horizonte' LIMIT 1", [empresaId],
        )).rows[0].id;

        const payment = await client.query<{ id: string }>(
            `INSERT INTO formas_pagamento (empresa_id, descricao, tipo, banco_id)
             SELECT $1, 'Pix · Banco Horizonte', 'pix', $2
             WHERE NOT EXISTS (SELECT 1 FROM formas_pagamento WHERE empresa_id = $1 AND descricao = 'Pix · Banco Horizonte')
             RETURNING id`, [empresaId, bancoId],
        );
        let formaId = payment.rows[0]?.id;
        if (!formaId) formaId = (await client.query<{ id: string }>(
            "SELECT id FROM formas_pagamento WHERE empresa_id = $1 AND descricao = 'Pix · Banco Horizonte' LIMIT 1", [empresaId],
        )).rows[0].id;

        const today = new Date();
        const dateAfter = (days: number) => {
            const date = new Date(today);
            date.setDate(date.getDate() + days);
            return date.toISOString().slice(0, 10);
        };
        const createLaunch = async (descricao: string, valor: number, tipo: "pagar" | "receber", pessoaId: string, dueInDays: number) => {
            const dueDate = dateAfter(dueInDays);
            const found = await client.query<{ id: string }>(
                "SELECT id FROM lancamentos WHERE empresa_id = $1 AND descricao = $2 AND data_vencimento = $3 LIMIT 1",
                [empresaId, descricao, dueDate],
            );
            if (found.rows[0]) return found.rows[0].id;
            const result = await client.query<{ id: string }>(
                 `INSERT INTO lancamentos (empresa_id, descricao, valor, tipo, status, data_vencimento, pessoa_id, banco_id)
                  VALUES ($1, $2, $3, $4, 'pendente', $5, $6, $7) RETURNING id`,
                 [empresaId, descricao, valor, tipo, dueDate, pessoaId, bancoId],
            );
            return result.rows[0].id;
        };
        const receivingId = await createLaunch("Projeto de identidade visual", 4850, "receber", clienteId, 8);
        const payableId = await createLaunch("Fornecimento de café", 680, "pagar", fornecedorId, 4);
        await createLaunch("Consultoria mensal", 2200, "receber", clienteId, 17);
        await createLaunch("Assinatura de ferramentas", 249.9, "pagar", fornecedorId, 12);

        const movementExists = await client.query(
            "SELECT 1 FROM movimentacoes WHERE empresa_id = $1 AND lancamento_id = $2 LIMIT 1", [empresaId, payableId],
        );
        if (!movementExists.rowCount) await client.query(
            `INSERT INTO movimentacoes (empresa_id, lancamento_id, forma_pagamento_id, valor)
             VALUES ($1, $2, $3, 125)`, [empresaId, payableId, formaId],
        );
        const receiptExists = await client.query(
            "SELECT 1 FROM recebimentos WHERE empresa_id = $1 AND lancamento_id = $2 LIMIT 1", [empresaId, receivingId],
        );
        if (!receiptExists.rowCount) await client.query(
            `INSERT INTO recebimentos (empresa_id, lancamento_id, forma_pagamento_id, valor)
             VALUES ($1, $2, $3, 1800)`, [empresaId, receivingId, formaId],
        );

        await client.query("COMMIT");
        console.log("Demonstração pronta.");
        console.log(`E-mail: ${demoEmail}`);
        console.log(`Senha: ${demoPassword}`);
        console.log("Empresa: Aurora Studio · Demonstração");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(error => {
    console.error(error instanceof Error ? error.message : "Erro ao criar demonstração.");
    process.exitCode = 1;
});
