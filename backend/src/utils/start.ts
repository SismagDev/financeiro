import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pool } from "../db";
import { PoolClient } from "pg";
import { hashPassword } from "./passwords";

/* 
    Inicialização padrão do sistema
        limpa todo o banco de dados
        cadastra turmas do ed infantil e fund 1 ao 9 ano
        cadastra todas as 14 matérias + Dias Letivos (para frequência de Fund I (FUND I) e Ed. Infantil (ED. INFANTIL)) {
            Artes,
            Português,
            Matemática,
            Ciências,
            Geografia,
            História,
            Inglês,
            Espanhol,
            Música/Teatro,
            Ensino Religioso,
            Educação Financeira,
            Educação Física,
            Informática,
            Redação,
            Dias Letivos,
        }
        cadastra usuário administrador. role admin com senha admin
        cadastra usuário coordenador. role coordenador com senha coordenador
        
*/

const sufixoEmail = "ipe.com";
const anoLetivo = 2026; //new Date().getFullYear();

const turmasEdInfantil = [
    { curso: "Educação Infantil", nome: "MATERNAL (I)" },
    { curso: "Educação Infantil", nome: "MATERNAL (II)" },
    { curso: "Educação Infantil", nome: "PRÉ-ESCOLA (I)" },
    { curso: "Educação Infantil", nome: "PRÉ-ESCOLA (II)" },
];
// Adiciona no 1º ANO ao 9º ANO
let turmasFund = [];
for (let i = 1; i <= 9; i++) {
    turmasFund.push({ curso: "Ensino Fundamental " + (i <= 5 ? "I" : "II"), nome: i + "º ANO" });
}

const turmas = [...turmasEdInfantil, ...turmasFund];

const materias = [
    { curso: "", nome: "Artes" },
    { curso: "", nome: "Português" },
    { curso: "", nome: "Matemática" },
    { curso: "", nome: "Ciências" },
    { curso: "", nome: "Geografia" },
    { curso: "", nome: "História" },
    { curso: "", nome: "Inglês" },
    { curso: "Ensino Fundamental II", nome: "Música/Teatro" },
    { curso: "", nome: "Ensino Religioso" },
    { curso: "Ensino Fundamental II", nome: "Educação Financeira" },
    { curso: "", nome: "Educação Física" },
    { curso: "Ensino Fundamental II", nome: "Informática" },
    { curso: "Ensino Fundamental II", nome: "Redação" },
    { curso: "", nome: "Dias Letivos" },
];

async function confirmacao() {
    // Pede que tenha passado --force como argumento
    // Depois, exige que escreve "CONFIRMAR" para continuar
    const force = process.argv.includes("--force");

    if (!force) {
        console.log("Use --force para confirmar.");
        process.exit(1);
    }

    const rl = readline.createInterface({ input, output });
    const textoConfirmacao = await rl.question(
        'ATENÇÃO: ESTA AÇÃO APAGARÁ TODOS OS DADOS.\nDIGITE "REINICIAR" PARA CONTINUAR: ',
    );
    rl.close();

    if (textoConfirmacao !== "REINICIAR") {
        process.exit(0);
    }
}

async function limpaDB(client: PoolClient) {
    // Limpa TODAS as tabelas

    client.query(`
        DO $$
        DECLARE
            r RECORD;
        BEGIN
            FOR r IN (
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = 'public'
            )
            LOOP
                EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
            END LOOP;
        END $$;
    `);
}

async function cadastraTurmas(client: PoolClient) {
    const values =
        "(" +
        turmas
            .map((t) => {
                return `${anoLetivo}, '${t.curso}', '${t.nome}'`;
            })
            .join("), (") +
        ")";

    await client.query(`
        INSERT INTO turmas (ano_letivo, curso, nome) 
        VALUES ${values};
    `);
}

async function cadastraMaterias(client: PoolClient) {
    const values =
        "(" +
        materias
            .map((m) => (m.curso === "" ? "null" : "'" + m.curso + "'") + ", '" + m.nome + "'")
            .join("), (") +
        ")";

    await client.query(`INSERT INTO materias (curso, nome) VALUES ${values}`);
}

async function cadastraUsuarios(client: PoolClient) {
    // cadastra user administrador, coordenador e professor
    for (const r of ["administrador", "coordenador"]) {
        const passwordHashed = await hashPassword(r);

        await client.query(
            `
            INSERT INTO users (nome, email, role, password_hash)
            VALUES ($1, $2, $3, $4) 
        `,
            [r, `${r}@${sufixoEmail}`, r, passwordHashed],
        );
    }
}

async function reinicializaSistema() {
    // dentro do confirmacao, já existe process.exit(0|1) caso não possa continuar
    await confirmacao();

    // gera um client e passa ele para as funções
    const client = await pool.connect();

    // limpa todas as tabelas do sistema
    try {
        await client.query("BEGIN");

        await limpaDB(client);
        console.log("✓ Banco limpo");

        await cadastraTurmas(client);
        console.log("✓ Turmas cadastradas");

        await cadastraMaterias(client);
        console.log("✓ Materias cadastradas");

        await cadastraUsuarios(client);
        console.log("✓ Usuários cadastrados");

        await client.query("COMMIT");
        console.log("✓ Sistema Reinicializado");
    } catch (e) {
        await client.query("ROLLBACK");
        console.log("Erro: " + e);
    } finally {
        client.release();
    }

    return;
}

reinicializaSistema();
