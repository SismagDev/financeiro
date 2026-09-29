import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "../db";

async function run() {
    const directory = resolve(process.cwd(), "migrations");
    const files = (await readdir(directory)).filter(file => /^\d+_.+\.sql$/.test(file)).sort();
    for (const file of files) {
        await pool.query(await readFile(resolve(directory, file), "utf8"));
        console.log(`Migração aplicada: ${file}`);
    }
    await pool.end();
    console.log("Migrações aplicadas.");
}

run().catch(async error => {
    console.error(error instanceof Error ? error.message : "Erro ao aplicar migrações.");
    await pool.end();
    process.exitCode = 1;
});
