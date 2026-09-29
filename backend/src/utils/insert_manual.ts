import argon2 from "argon2";
import crypto from "crypto";
import { pool } from "../db";

const inserirProfessores = async () => {
    const client = await pool.connect();

    const logins = [
        "Amanda_Paula",
        "Anamaria_Carvalho",
        "Andressa_Pires",
        "Anny_Cletia",
        "Daniele_Duarte",
        "Daysi_Ribeiro",
        "Elani_Silva",
        "Hanna_Jose",
        "Ismael_Ribeiro",
        "Julia_Fonseca",
        "Leandro_Nascimento",
        "Leidiniz_Cerqueira",
        "Mariane_Brazilino",
        "Melissa_Silva",
        "Michelle_Aparecida",
        "Neeilman_Cassimiro",
        "Otamar_Oliveira",
        "Raiana_Silva",
        "Rejane_Soares",
        "Silvanete_Oliveira",
        "Silvania_Mello",
        "Simone_Matos",
        "Vitoria_Caricia",
        "Viviana_Conceicao",
    ];

    for (const user of logins) {
        const nome = user.replace(/_/g, " ");
        const email = user.replace(/_/g, "").toLowerCase() + "@ipe.com";

        const primeiroNome = nome.split(" ")[0];

        const numero = crypto.randomInt(1000, 10000);

        const senha = `${primeiroNome}${numero}*#`;

        const hash = await argon2.hash(senha);

        await client.query(
            `
        INSERT INTO users (
            nome, email, password_hash, role
        ) VALUES (
            $1,
            $2,
            $3,
            'professor'
        )
    `,
            [nome, email, hash],
        );

        console.log(`${user} -> ${senha}`);
    }

    client.release();
};

inserirProfessores();
