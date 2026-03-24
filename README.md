# AC/DC Agent

Agente de ventas conversacional para **AC/DC**, empresa suplidora de materiales eléctricos y electrónicos industriales en Venezuela. Diseñado para nunca alucinar productos — solo menciona lo que existe en el catálogo.

---

## Requisitos

- **[Bun](https://bun.sh) >= 1.0** — runtime y gestor de paquetes
- **Redis >= 6** — almacenamiento de sesiones y memoria por usuario

---

## Cómo funciona

El agente usa **Anthropic Claude** con **tool calling** para buscar productos. El catálogo NO está en el system prompt — en su lugar, el modelo debe llamar la herramienta `buscar_productos` antes de mencionar cualquier producto. La herramienta hace la búsqueda en `productos.json` y retorna solo resultados reales.

### Por qué no alucina

Enfoques anteriores (RAG, memoria, catálogo en el system prompt) fallan porque el modelo genera productos de su memoria de entrenamiento sin importar las instrucciones. Este agente lo resuelve arquitectónicamente:

**El catálogo no está en el contexto. El modelo no tiene de dónde inventar.**

El flujo es:

1. El cliente pide un producto
2. El modelo llama `buscar_productos("query")` — **obligatorio por instrucciones en `SYSTEM.md`**
3. La herramienta busca en `productos.json` y retorna coincidencias reales
4. El modelo formatea únicamente lo que la herramienta le devolvió

Si la herramienta retorna vacío, el producto no existe. El modelo no tiene acceso a ninguna otra fuente de productos.

---

## Archivos

```
index.ts          entrada principal — CLI (default) o servidor HTTP ("serve")
catalog.ts        carga productos.json, búsqueda fuzzy con mapa de sinónimos
agent.ts          system prompt, herramienta buscar_productos, loop Anthropic
server.ts         API HTTP con Bun.serve() y UI web
redis.ts          cliente Redis — sesiones y memoria persistente por usuario
memory.ts         extracción de memoria del cliente con Claude
cli.ts            chat interactivo en terminal con spinner y streaming
SYSTEM.md         instrucciones del agente (rol, reglas anti-alucinación, formato)
productos.json    catálogo fuente de verdad (711 productos, 20 categorías)
.env.example      plantilla de variables de entorno
```

### `catalog.ts`

Carga `productos.json` y compacta cada producto a los campos esenciales: `sku`, `codigo`, `nombre`, `categoria`, `bcv_g`, `mostrar`. Cachea en memoria.

Exporta `searchProducts(query, limit)` que:

- Normaliza texto (minúsculas, sin acentos)
- Expande tokens con un mapa de sinónimos (`breaker` ↔ `termomagnetico` ↔ `interruptor`, `protector` ↔ `supervisor`, `rele` ↔ `relay`, etc.)
- Puntúa cada producto por coincidencia de tokens contra `nombre + categoria`
- Retorna los top N resultados ordenados por score, luego por `mostrar` (activos primero)

### `agent.ts`

Lee `SYSTEM.md` una vez y lo usa como system prompt en cada llamada. El catálogo **no** se inyecta en el prompt.

Registra la herramienta `buscar_productos` en Anthropic con su `input_schema`. Exporta:

- `chat(messages, memory?)` — respuesta completa, corre el loop de tool use hasta que `stop_reason !== "tool_use"`
- `chatStream(messages, memory?)` — streaming con `client.messages.stream()`, hace loop en tool use antes de continuar el stream

### `server.ts`

Servidor HTTP con `Bun.serve()`. Sirve una UI web en `/` y expone las siguientes rutas:

| Método | Ruta            | Descripción                            |
| ------ | --------------- | -------------------------------------- |
| `GET`  | `/`             | UI web                                 |
| `GET`  | `/health`       | Verificación de estado                 |
| `GET`  | `/sessions`     | Lista de sesiones del usuario (cookie) |
| `GET`  | `/sessions/:id` | Mensajes de una sesión específica      |
| `POST` | `/chat`         | Respuesta completa en JSON             |
| `POST` | `/chat/stream`  | Respuesta por streaming SSE            |

Body esperado en `/chat` y `/chat/stream`:

```json
{
  "messages": [
    { "role": "user", "content": "necesito un breaker de 20 amperios" }
  ],
  "sessionId": "uuid-opcional"
}
```

Respuesta de `/chat`:

```json
{ "reply": "...", "sessionId": "uuid" }
```

`/chat/stream` retorna eventos SSE con tokens (`data: "token"`), un evento final con `{ "sessionId": "uuid" }` y termina con `data: [DONE]`.

La identidad del usuario se mantiene mediante una cookie `acdc_uid` (UUID generado automáticamente). Las sesiones y la memoria se persisten en Redis.

### `redis.ts`

Cliente Redis compartido. Maneja la conexión lazy y exporta:

- `saveSession` / `loadSession` / `listSessions` — historial de conversación por usuario y sesión
- `saveMemory` / `loadMemory` — memoria acumulada del cliente (JSON con nombre, empresa, proyectos, etc.)

TTL de sesiones configurable con `SESSION_TTL_DAYS` (default: 7 días).

### `memory.ts`

Usa Claude para extraer y consolidar hechos clave del cliente a partir del historial de conversación (nombre, empresa, ubicación, proyectos, intereses). La memoria se fusiona con la existente y se inyecta en el system prompt de las siguientes conversaciones. La extracción ocurre cada `MEMORY_EXTRACT_INTERVAL` turnos del usuario (default: 3).

### `cli.ts`

Chat interactivo en terminal con historial de conversación en memoria. Muestra un spinner animado mientras espera el primer token, luego hace streaming inline. Comandos:

- `/clear` — reinicia el historial
- `/exit` — cierra el chat

### `SYSTEM.md`

Instrucciones del agente sin datos de productos. Contiene:

- **REGLA #0**: siempre llamar `buscar_productos` antes de cualquier mención de producto
- **REGLA #1**: si la herramienta retorna vacío → el producto no existe, nunca inventar
- **REGLA #2**: búsqueda silenciosa — nunca revelar al cliente que existe una herramienta o sistema
- **REGLA #3**: productos primero, preguntas después
- Rol, personalidad, formato de precios, formato de cotizaciones, asesoría técnica

---

## Variables de entorno

```bash
cp .env.example .env
```

| Variable                  | Requerida | Default                  | Descripción                                      |
| ------------------------- | --------- | ------------------------ | ------------------------------------------------ |
| `ANTHROPIC_API_KEY`       | Sí        | —                        | API key de Anthropic                             |
| `ANTHROPIC_MODEL`         | No        | `claude-haiku-4-5`       | Modelo a usar                                    |
| `PORT`                    | No        | `3000`                   | Puerto del servidor HTTP                         |
| `REDIS_URL`               | No        | `redis://localhost:6379` | URL de conexión a Redis                          |
| `SESSION_TTL_DAYS`        | No        | `7`                      | Días de retención de sesiones en Redis           |
| `MEMORY_EXTRACT_INTERVAL` | No        | `3`                      | Cada cuántos turnos de usuario se extrae memoria |

---

## Uso

```bash
bun install
```

### CLI interactivo

```bash
bun run dev
```

### Servidor HTTP

```bash
bun run serve
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

## Docker Compose

### 1. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env` y agrega tu API key de Anthropic:

```
ANTHROPIC_API_KEY=sk-ant-tu-key-aqui
```

Las demás variables son opcionales (ver tabla en [Variables de entorno](#variables-de-entorno)). `REDIS_URL` se configura automáticamente para apuntar al contenedor de Redis.

### 2. Levantar los servicios

```bash
docker compose up -d
```

Esto levanta el agente y una instancia de Redis automáticamente. La app estará disponible en `http://localhost:3000`.

### 3. Ver logs

```bash
docker compose logs -f acdc-agent
```

### 4. Detener

```bash
docker compose down
```

---

## Catálogo

`productos.json` es la única fuente de verdad. 711 productos en 20 categorías:

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

El campo `Mostrar` controla visibilidad: `mostrar=1` (467 productos activos) se presentan proactivamente. Los `mostrar=0` (244) son conocidos por el agente por si el cliente los consulta específicamente.
