import path from "node:path";
import crypto from "node:crypto";
import { chat, chatStream, type Message } from "./agent.ts";
import { saveSession, loadSession, listSessions, saveMemory, loadMemory } from "./redis.ts";
import { extractMemory } from "./memory.ts";

const port = parseInt(process.env.PORT || "3000", 10);
const indexHtml = Bun.file(path.join(import.meta.dir, "public", "index.html"));
const MEMORY_INTERVAL = parseInt(process.env.MEMORY_EXTRACT_INTERVAL || "3", 10);

// ── Logging ──────────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const DIM   = "\x1b[2m";
const colors = { green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", cyan: "\x1b[36m" };

function statusColor(status: number): string {
  if (status >= 500) return colors.red;
  if (status >= 400) return colors.yellow;
  if (status >= 300) return colors.cyan;
  return colors.green;
}

function logRequest(method: string, pathname: string, status: number, ms: number, ip: string) {
  const timestamp = new Date().toISOString();
  const col = statusColor(status);
  console.log(
    `${DIM}${timestamp}${RESET} ${method.padEnd(6)} ${pathname.padEnd(24)} ${col}${status}${RESET} ${DIM}${ms}ms  ${ip}${RESET}`,
  );
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

const RATE_LIMIT_MAX    = parseInt(process.env.RATE_LIMIT_MAX    || "20",    10);
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);

interface RateEntry { count: number; resetAt: number }
const rateLimitStore = new Map<string, RateEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAt <= now) rateLimitStore.delete(key);
  }
}, RATE_LIMIT_WINDOW);

function checkRateLimit(key: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let entry = rateLimitStore.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    rateLimitStore.set(key, entry);
  }
  entry.count++;
  const remaining = Math.max(0, RATE_LIMIT_MAX - entry.count);
  return { allowed: entry.count <= RATE_LIMIT_MAX, remaining, resetAt: entry.resetAt };
}

function rateLimitHeaders(remaining: number, resetAt: number): Record<string, string> {
  return {
    "X-RateLimit-Limit":     String(RATE_LIMIT_MAX),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset":     String(Math.ceil(resetAt / 1000)),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function getIp(req: Request, server: ReturnType<typeof Bun.serve> | null): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    server?.requestIP(req)?.address ||
    "unknown"
  );
}

// ── Server ────────────────────────────────────────────────────────────────────

export function startServer() {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const start    = performance.now();
      const url      = new URL(req.url);
      const ip       = getIp(req, server);
      let response: Response;

      try {
        response = await handle(req, url, ip);
      } catch (e: any) {
        response = Response.json({ error: e.message }, { status: 500 });
      }

      const ms = Math.round(performance.now() - start);
      logRequest(req.method, url.pathname, response.status, ms, ip);
      return response;
    },
  });
  console.log(`AC/DC Agent API running on http://localhost:${port}`);
}

async function handle(req: Request, url: URL, ip: string): Promise<Response> {
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
    const respHeaders = new Headers({ "Content-Type": "application/json" });
    const uuid = getOrSetUuid(req, respHeaders);

    const rl = checkRateLimit(uuid || ip);
    Object.entries(rateLimitHeaders(rl.remaining, rl.resetAt)).forEach(([k, v]) => respHeaders.set(k, v));
    if (!rl.allowed) {
      return Response.json({ error: "Too many requests" }, { status: 429, headers: respHeaders });
    }

    try {
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
      return Response.json({ error: e.message }, { status: 500, headers: respHeaders });
    }
  }

  if (req.method === "POST" && url.pathname === "/chat/stream") {
    const respHeaders = new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const uuid = getOrSetUuid(req, respHeaders);

    const rl = checkRateLimit(uuid || ip);
    Object.entries(rateLimitHeaders(rl.remaining, rl.resetAt)).forEach(([k, v]) => respHeaders.set(k, v));
    if (!rl.allowed) {
      return Response.json({ error: "Too many requests" }, { status: 429 });
    }

    try {
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
}
