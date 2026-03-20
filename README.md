# AC/DC Agent

Agente de ventas conversacional para **AC/DC**, empresa suplidora de materiales eléctricos y electrónicos industriales en Venezuela. Diseñado para nunca alucinar productos — solo menciona lo que existe en el catálogo.

---

## Cómo funciona

El agente carga el catálogo completo de `productos.json` (711 productos) y lo inyecta directamente en el system prompt junto con las instrucciones de `SYSTEM.md`. Cada conversación comienza con el modelo viendo todos los productos en su ventana de contexto.

### Por qué no alucina

Enfoques anteriores con RAG, embeddings y memoria fallan porque el modelo recibe resultados parciales de la búsqueda y llena los vacíos de memoria con productos inventados. Este agente usa una estrategia diferente:

**El catálogo completo vive en el system prompt de cada request.**

El catálogo compactado (~31K tokens, solo los campos esenciales) se inyecta literalmente en el contexto antes de cada conversación. El modelo ve todos los 711 productos — sin recuperación, sin aproximaciones, sin vacíos. Las reglas anti-alucinación del system prompt (`SYSTEM.md`) refuerzan que solo mencione productos visibles en el JSON que tiene encima. Si el producto no aparece en ese JSON, no existe.

No hay forma de que el modelo invente un SKU o precio: está mirando la lista completa y las reglas le dicen que solo hable de lo que ve ahí.

---

## Archivos

```
index.ts          entrada principal — CLI o servidor HTTP según args
catalog.ts        carga productos.json y genera el bloque compacto del catálogo
agent.ts          construye el system prompt, maneja llamadas al LLM
server.ts         API HTTP con Bun.serve()
cli.ts            chat interactivo en terminal con streaming
SYSTEM.md         instrucciones del agente (rol, reglas, formato)
productos.json    catálogo fuente de verdad (711 productos, 20 categorías)
.env.example      plantilla de variables de entorno
```

### `catalog.ts`

Lee `productos.json` y compacta cada producto a solo los campos que el agente necesita: `sku`, `codigo`, `nombre`, `categoria`, `bcv_g`, `mostrar`. Cachea el resultado en memoria para no releer el archivo en cada request. El campo `mostrar` permite al agente saber qué productos están activos (1) sin exponer el campo interno al cliente.

### `agent.ts`

Lee `SYSTEM.md`, le agrega el bloque JSON del catálogo al final, y lo usa como system prompt en cada llamada al LLM. Exporta dos funciones:

- `chat(messages)` — respuesta completa, retorna string
- `chatStream(messages)` — respuesta en streaming, retorna `AsyncGenerator<string>`

El cliente OpenAI se configura con `OPENAI_API_KEY`, `OPENAI_BASE_URL` y `OPENAI_MODEL`. Al ser OpenAI-compatible, funciona con cualquier proveedor que use ese protocolo.

### `server.ts`

Servidor HTTP con `Bun.serve()`. Rutas disponibles:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/health` | Verificación de estado |
| `POST` | `/chat` | Respuesta completa en JSON |
| `POST` | `/chat/stream` | Respuesta por streaming SSE |

Body esperado en `/chat` y `/chat/stream`:

```json
{
  "messages": [
    { "role": "user", "content": "necesito un breaker de 20 amperios" }
  ]
}
```

Respuesta de `/chat`:

```json
{ "reply": "..." }
```

`/chat/stream` retorna eventos SSE con tokens individuales (`data: "token"`) y termina con `data: [DONE]`.

### `cli.ts`

Chat interactivo en terminal con historial de conversación en memoria. Muestra las respuestas token por token a medida que llegan. Comandos disponibles:

- `/clear` — reinicia el historial de conversación
- `/exit` — cierra el chat

---

## Variables de entorno

Copia `.env.example` a `.env` y completa los valores:

```bash
cp .env.example .env
```

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `OPENAI_API_KEY` | Sí | API key del proveedor |
| `OPENAI_BASE_URL` | No | Base URL del endpoint (default: OpenAI) |
| `OPENAI_MODEL` | No | Modelo a usar (default: `gpt-4o`) |
| `PORT` | No | Puerto del servidor HTTP (default: `3000`) |

`OPENAI_BASE_URL` permite apuntar a cualquier endpoint compatible con la API de OpenAI: Groq, Together AI, llama.cpp local, etc.

---

## Uso

```bash
bun install
```

### CLI interactivo

```bash
bun run dev
# o
bun index.ts
```

### Servidor HTTP

```bash
bun run serve
# o
bun index.ts serve
```

### Ejemplos con curl

```bash
# Chat normal
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "qué protectores digitales tienen?"}]}'

# Streaming SSE
curl -X POST http://localhost:3000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "necesito un breaker trifásico"}]}'

# Health check
curl http://localhost:3000/health
```

---

## Catálogo

`productos.json` es la única fuente de verdad. Contiene 711 productos en 20 categorías:

- Protectores y Supervisores
- Termomagnetico AC / DC
- Disyuntores Diferenciales
- Contactores
- Tableros de Riel y Doble Fondo
- Transferencias Automáticas y Manuales
- Supresores de Picos
- Accesorios de Conexión y Panel Solar
- Pilotos y Botonería 22mm
- Relés y Temporizadores
- Fuentes, Control de Temperatura
- Variadores de Frecuencia y PLC
- Herramientas, y más

El campo `Mostrar` del JSON original controla visibilidad: el agente presenta proactivamente solo productos activos (`mostrar=1`, 467 productos) pero conoce todos los 711 por si un cliente consulta específicamente por uno inactivo.
