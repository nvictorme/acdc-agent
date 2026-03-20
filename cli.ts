import * as readline from "node:readline";
import { chatStream, type Message } from "./agent.ts";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export async function startCli() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const history: Message[] = [];

  console.log("AC/DC Agent — CLI Mode");
  console.log("Escribe tu mensaje. /clear para reiniciar, /exit para salir.\n");

  const prompt = () => {
    rl.question("Tú: ", async (input) => {
      const trimmed = input.trim();
      if (!trimmed) return prompt();

      if (trimmed === "/exit") {
        console.log("¡Hasta luego!");
        rl.close();
        process.exit(0);
      }

      if (trimmed === "/clear") {
        history.length = 0;
        console.log("— Historial limpiado —\n");
        return prompt();
      }

      history.push({ role: "user", content: trimmed });

      let frame = 0;
      process.stdout.write("\n");
      const spinner = setInterval(() => {
        process.stdout.write(`\r${SPINNER[frame++ % SPINNER.length]} Procesando...`);
      }, 80);

      let full = "";
      let firstToken = true;
      try {
        for await (const token of chatStream(history)) {
          if (firstToken) {
            clearInterval(spinner);
            process.stdout.write("\rACDC Bot: " + " ".repeat(14) + "\rACDC Bot: ");
            firstToken = false;
          }
          process.stdout.write(token);
          full += token;
        }
      } catch (e: any) {
        clearInterval(spinner);
        process.stdout.write("\r" + " ".repeat(20) + "\r");
        console.error(`[Error: ${e.message}]`);
        history.pop();
        return prompt();
      }
      console.log("\n");

      history.push({ role: "assistant", content: full });
      prompt();
    });
  };

  prompt();
}
