import { chat, chatStream, type Message } from "./agent.ts";

const port = parseInt(process.env.PORT || "3000", 10);

export function startServer() {
  Bun.serve({
    port,
    routes: {
      "GET /health": () => Response.json({ ok: true }),

      "POST /chat": async (req) => {
        try {
          const body = await req.json() as { messages?: Message[] };
          if (!body.messages?.length) {
            return Response.json({ error: "messages array required" }, { status: 400 });
          }
          const reply = await chat(body.messages);
          return Response.json({ reply });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      },

      "POST /chat/stream": async (req) => {
        try {
          const body = await req.json() as { messages?: Message[] };
          if (!body.messages?.length) {
            return Response.json({ error: "messages array required" }, { status: 400 });
          }
          const stream = new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();
              try {
                for await (const token of chatStream(body.messages!)) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(token)}\n\n`));
                }
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              } catch (e: any) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: e.message })}\n\n`));
              } finally {
                controller.close();
              }
            },
          });
          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      },
    },
  });
  console.log(`AC/DC Agent API running on http://localhost:${port}`);
}
