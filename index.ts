import { startServer } from "./server.ts";
import { startCli } from "./cli.ts";

const command = process.argv[2];

if (command === "serve") {
  startServer();
} else {
  await startCli();
}
