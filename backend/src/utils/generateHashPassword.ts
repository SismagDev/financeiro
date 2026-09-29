import { hashPassword, verifyPassword } from "./passwords";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = readline.createInterface({ input, output });

async function run() {
    const passwordTest = await rl.question("Digite a senha: ");

    const hash = await hashPassword(passwordTest);
    if (await verifyPassword(hash, passwordTest)) {
        console.log(hash);
    } else {
        console.log("Erro ao gerar hash de senha");
    }

    return;
}

run();
