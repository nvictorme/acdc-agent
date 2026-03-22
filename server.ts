import path from "node:path";
import crypto from "node:crypto";
import { chat, chatStream, type Message } from "./agent.ts";
import { saveSession, loadSession, listSessions, saveMemory, loadMemory } from "./redis.ts";
import { extractMemory } from "./memory.ts";

const port = parseInt(process.env.PORT || "3000", 10);
const indexHtml = Bun.file(path.join(import.meta.dir, "public", "index.html"));
const MEMORY_INTERVAL = parseInt(process.env.MEMORY_EXTRACT_INTERVAL || "3", 10);

function getOrSetUuid(req: Request, headers: Headers): string {
  const cookies = req.headers.get("cookie") || "";
  const match = cookies.match(/acdc_uid=([a-f0-9-]+)/);
  if (match) return match[1]!;
  const uuid = crypto.randomUUID();
  headers.append("Set-Cookie", `acdc_uid=${uuid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  return uuid;
}

function extractUuid(req: Request): string | null {
  const cookies = req.headers.get("cookie") || "";
  const match = cookies.match(/acdc_uid=([a-f0-9-]+)/);
  return match ? match[1]! : null;
}

export function startServer() {
  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const respHeaders = new Headers({ "Content-Type": "text/html; charset=utf-8" });
        getOrSetUuid(req, respHeaders);
        return new Response(indexHtml, { headers: respHeaders });
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return Response.json({ ok: true });
      }

      if (req.method === "GET" && url.pathname === "/sessions") {
        const uuid = extractUuid(req);
        if (!uuid) return Response.json({ sessions: [] });
        const sessions = await listSessions(uuid);
        return Response.json({ sessions });
      }

      if (req.method === "GET" && url.pathname.startsWith("/sessions/")) {
        const uuid = extractUuid(req);
        if (!uuid) return Response.json({ messages: [] });
        const sessionId = url.pathname.slice("/sessions/".length);
        const messages = await loadSession(uuid, sessionId);
        return Response.json({ messages });
      }

      if (req.method === "POST" && url.pathname === "/chat") {
        try {
          const respHeaders = new Headers({ "Content-Type": "application/json" });
          const uuid = getOrSetUuid(req, respHeaders);
          const body = await req.json() as { messages?: Message[]; sessionId?: string };
          if (!body.messages?.length) {
            return Response.json({ error: "messages array required" }, { status: 400, headers: respHeaders });
          }
          const sessionId = body.sessionId || crypto.randomUUID();
          const existing = await loadSession(uuid, sessionId);
          const messages = existing.length ? [...existing, ...body.messages.slice(existing.length)] : body.messages;
          const memory = await loadMemory(uuid);
          const reply = await chat(messages, memory);
          messages.push({ role: "assistant", content: reply });
          await saveSession(uuid, sessionId, messages);
          const userTurns = messages.filter((m) => m.role === "user").length;
          if (userTurns % MEMORY_INTERVAL === 0) {
            extractMemory(messages, memory).then((facts) => saveMemory(uuid, facts)).catch(() => {});
          }
          return Response.json({ reply, sessionId }, { headers: respHeaders });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      }

      if (req.method === "POST" && url.pathname === "/chat/stream") {
        try {
          const respHeaders = new Headers({
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          const uuid = getOrSetUuid(req, respHeaders);
          const body = await req.json() as { messages?: Message[]; sessionId?: string };
          if (!body.messages?.length) {
            return Response.json({ error: "messages array required" }, { status: 400 });
          }
          const sessionId = body.sessionId || crypto.randomUUID();
          const existing = await loadSession(uuid, sessionId);
          const messages = existing.length ? [...existing, ...body.messages.slice(existing.length)] : body.messages;
          const memory = await loadMemory(uuid);

          const stream = new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();
              let full = "";
              try {
                for await (const token of chatStream(messages, memory)) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(token)}\n\n`));
                  full += token;
                }
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sessionId })}\n\n`));
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                messages.push({ role: "assistant", content: full });
                await saveSession(uuid, sessionId, messages);
                const userTurns = messages.filter((m) => m.role === "user").length;
                if (userTurns % MEMORY_INTERVAL === 0) {
                  extractMemory(messages, memory).then((facts) => saveMemory(uuid, facts)).catch(() => {});
                }
              } catch (e: any) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: e.message })}\n\n`));
              } finally {
                controller.close();
              }
            },
          });
          return new Response(stream, { headers: respHeaders });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
  console.log(`AC/DC Agent API running on http://localhost:${port}`);
}
