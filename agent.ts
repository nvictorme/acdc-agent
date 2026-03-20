import path from "node:path";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { buildCatalogBlock } from "./catalog.ts";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || undefined,
});

const model = process.env.OPENAI_MODEL || "gpt-4o";

let _systemPrompt: string | null = null;

async function getSystemPrompt(): Promise<string> {
  if (_systemPrompt) return _systemPrompt;
  const systemMd = await Bun.file(path.join(import.meta.dir, "SYSTEM.md")).text();
  const catalog = await buildCatalogBlock();
  _systemPrompt = `${systemMd}\n\n## CATÁLOGO COMPLETO (JSON)\n\nA continuación tienes el catálogo completo de productos. El campo "mostrar" indica si el producto está activo (1) o no (0). Solo presenta proactivamente productos con mostrar=1, pero si un cliente pregunta específicamente por uno con mostrar=0, puedes mencionarlo indicando que consulte disponibilidad.\n\n\`\`\`json\n${catalog}\n\`\`\``;
  return _systemPrompt;
}

export type Message = { role: "user" | "assistant"; content: string };

export async function chat(messages: Message[]): Promise<string> {
  const systemPrompt = await getSystemPrompt();
  const apiMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];
  const response = await client.chat.completions.create({
    model,
    messages: apiMessages,
    temperature: 0.3,
  });
  return response.choices[0]?.message?.content ?? "";
}

export async function* chatStream(messages: Message[]): AsyncGenerator<string> {
  const systemPrompt = await getSystemPrompt();
  const apiMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];
  const stream = await client.chat.completions.create({
    model,
    messages: apiMessages,
    temperature: 0.3,
    stream: true,
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
