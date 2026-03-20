import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { searchProducts } from "./catalog.ts";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

let _systemPrompt: string | null = null;

async function getSystemPrompt(): Promise<string> {
  if (_systemPrompt) return _systemPrompt;
  _systemPrompt = await Bun.file(path.join(import.meta.dir, "SYSTEM.md")).text();
  return _systemPrompt;
}

const tools: Anthropic.Tool[] = [
  {
    name: "buscar_productos",
    description:
      "Busca productos reales en el catálogo de AC/DC. DEBES llamar esta función antes de mencionar cualquier producto, SKU o precio. Los únicos productos que puedes mostrar son los que retorna esta función.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Texto de búsqueda. Incluye nombre, tipo, amperaje, polos, voltaje u otras especificaciones que mencionó el cliente.",
        },
        limite: {
          type: "number",
          description: "Máximo de resultados a retornar. Default: 10.",
        },
      },
      required: ["query"],
    },
  },
];

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name === "buscar_productos") {
    const query = String(input.query ?? "");
    const limite = typeof input.limite === "number" ? input.limite : 10;
    const results = await searchProducts(query, limite);
    if (results.length === 0) {
      return JSON.stringify({ resultados: [], mensaje: "No se encontraron productos que coincidan con esa búsqueda." });
    }
    return JSON.stringify({ resultados: results });
  }
  return JSON.stringify({ error: "Herramienta desconocida" });
}

export type Message = { role: "user" | "assistant"; content: string };

export async function chat(messages: Message[]): Promise<string> {
  const system = await getSystemPrompt();
  const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  while (true) {
    const response = await client.messages.create({
      model,
      system,
      messages: apiMessages,
      tools,
      max_tokens: 4096,
    });

    apiMessages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      return textBlock?.text ?? "";
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const result = await executeTool(block.name, block.input as Record<string, unknown>);
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }
    apiMessages.push({ role: "user", content: toolResults });
  }
}

export async function* chatStream(messages: Message[]): AsyncGenerator<string> {
  const system = await getSystemPrompt();
  const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  while (true) {
    const stream = client.messages.stream({
      model,
      system,
      messages: apiMessages,
      tools,
      max_tokens: 4096,
    });

    let stopReason: string | null = null;

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
      if (event.type === "message_delta") {
        stopReason = event.delta.stop_reason ?? stopReason;
      }
    }

    const finalMsg = await stream.finalMessage();
    apiMessages.push({ role: "assistant", content: finalMsg.content });

    if (stopReason !== "tool_use") break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of finalMsg.content) {
      if (block.type !== "tool_use") continue;
      const result = await executeTool(block.name, block.input as Record<string, unknown>);
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }
    apiMessages.push({ role: "user", content: toolResults });
  }
}
