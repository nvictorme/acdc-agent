import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "./agent.ts";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXTRACTION_PROMPT = `You are a memory extraction system. Given a conversation between a customer and a sales assistant, extract key facts about the customer. Merge with any existing memory provided.

Return ONLY a JSON object with these fields (omit fields with no data):
{
  "name": "customer name if mentioned",
  "company": "company name if mentioned",
  "location": "city/state/region if mentioned",
  "phone": "phone number if mentioned",
  "projects": ["brief descriptions of projects discussed"],
  "product_interests": ["types of products they've asked about"],
  "preferences": ["any stated preferences (brands, specs, budget)"],
  "notes": ["other relevant facts"]
}

Rules:
- Keep values concise
- Merge new info with existing memory, don't duplicate
- If conflicting info, prefer the newer conversation
- Output valid JSON only, no markdown fences`;

export async function extractMemory(
  messages: Message[],
  existingMemory: string | null,
): Promise<string> {
  const conversation = messages
    .map((m) => `${m.role === "user" ? "Customer" : "Assistant"}: ${m.content}`)
    .join("\n");

  let prompt = `Conversation:\n${conversation}`;
  if (existingMemory) {
    prompt = `Existing memory:\n${existingMemory}\n\n${prompt}`;
  }

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: EXTRACTION_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  return text?.text ?? existingMemory ?? "{}";
}
