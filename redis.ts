import { createClient } from "redis";
import type { Message } from "./agent.ts";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const SESSION_TTL = parseInt(process.env.SESSION_TTL_DAYS || "7", 10) * 86400;

const client = createClient({ url: REDIS_URL });
client.on("error", (err) => console.error("Redis error:", err));

let connected = false;

async function ensureConnected() {
  if (!connected) {
    await client.connect();
    connected = true;
  }
}

function sessionKey(uuid: string, sessionId: string) {
  return `session:${uuid}:${sessionId}`;
}

function sessionIndexKey(uuid: string) {
  return `sessions:${uuid}`;
}

function memoryKey(uuid: string) {
  return `memory:${uuid}`;
}

export async function saveSession(uuid: string, sessionId: string, messages: Message[]) {
  await ensureConnected();
  const key = sessionKey(uuid, sessionId);
  await client.set(key, JSON.stringify(messages), { EX: SESSION_TTL });
  await client.zAdd(sessionIndexKey(uuid), {
    score: Date.now(),
    value: sessionId,
  });
}

export async function loadSession(uuid: string, sessionId: string): Promise<Message[]> {
  await ensureConnected();
  const data = await client.get(sessionKey(uuid, sessionId));
  if (!data) return [];
  return JSON.parse(data) as Message[];
}

export async function listSessions(uuid: string): Promise<string[]> {
  await ensureConnected();
  return client.zRange(sessionIndexKey(uuid), 0, -1, { REV: true });
}

export async function saveMemory(uuid: string, facts: string) {
  await ensureConnected();
  await client.set(memoryKey(uuid), facts);
}

export async function loadMemory(uuid: string): Promise<string | null> {
  await ensureConnected();
  return client.get(memoryKey(uuid));
}
