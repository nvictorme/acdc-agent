import * as readline from "node:readline";
import { chatStream, type Message } from "./agent.ts";

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

      process.stdout.write("\nACDC Bot: ");
      let full = "";
      try {
        for await (const token of chatStream(history)) {
          process.stdout.write(token);
          full += token;
        }
      } catch (e: any) {
        console.error(`\n[Error: ${e.message}]`);
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
