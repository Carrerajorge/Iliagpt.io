# Editor de Presentaciones (PPT) con IA en Streaming — Arquitectura + Código de Referencia (Monorepo)

> Documento único (copiable) para implementación rápida por el equipo de software.  
> Incluye: **frontend (React/TS)** + **backend (Node/TS)**, streaming WS/SSE, canvas (Konva), ribbon/tabs, modelo tipo **Delta (Quill)**, export a **PPTX/PDF/PNG**, y colaboración opcional con **CRDT (Yjs)**.

---

## 0) Alcance y notas importantes (léase antes)

Este documento trae un **“reference implementation”**: compila y funciona para el flujo base (UI + canvas + selección + streaming de texto + export PPTX básico).  
Algunos objetivos “enterprise” (por ejemplo **embebido real de fuentes dentro del PPTX**, o render 100% vectorial de rich-text en el canvas) requieren trabajo adicional y decisiones de producto/licenciamiento. En el código encontrarás secciones marcadas como:

- `// TODO(PROD): ...` → hardening/producción.
- `// TODO(VECTOR): ...` → vector/pixel-perfect.
- `// TODO(FONTS): ...` → fuentes y licencias.

La meta es que el equipo tenga **una base sólida**: estructura, estado, protocolos, y módulos listos para evolucionar.

---

## 1) Stack propuesto

### Frontend
- React 18 + TypeScript + Vite
- Canvas: **Konva.js** vía `react-konva`
- Rich text: **Quill** (Delta como modelo)
- State: Zustand (centralizado) + history (undo/redo)
- Charts: ECharts (renderer SVG) + export a SVG (inserción)
- Streaming: WebSocket (y alternativa SSE)

### Backend
- Node 18+ + TypeScript
- Express
- WebSocket server (`ws`) y endpoint SSE
- Adaptador a “tu API de LLM” (streaming tokens)
- Export: **PptxGenJS** (PPTX)
- PDF/PNG: (placeholder) Playwright/LibreOffice/CloudConvert o pipeline propio (ver TODO)

### Colaboración opcional
- CRDT: Yjs
- y-websocket (servidor) + binding cliente

---

## 2) Arquitectura (alto nivel)

```text
┌─────────────────────────────── Frontend (React) ────────────────────────────────┐
│ Header (title inline + Export + Close + Undo/Redo)                              │
│ Ribbon Tabs: Home | Insert | Layout | References | Review | View | AI           │
│                                                                               │
│  ┌─────────────── Split View ───────────────┐                                  │
│  │ Left: Chat Panel (LLM)                   │  Right: Editor                  │
│  │ - mensajes + comandos (/img, /chart, …)  │  - Slides list                   │
│  │ - WS/SSE streaming tokens                │  - Konva Canvas (Stage)          │
│  │ - queue+rAF -> “typed on slide”          │  - Selection/Transform/Guides    │
│  └──────────────────────────────────────────┘  - Layers + Properties panel     │
│                                                                               │
│ State Central (Zustand): slides[], activeSlideId, selection, history, aiMode  │
│ Sync bidireccional: store <-> canvas (events) + (opcional) Yjs CRDT           │
└───────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────── Backend (Node/Express) ──────────────────────────────┐
│ /api/chat/stream (SSE)  +  /ws (WebSocket)                                         │
│ /api/fonts/google (lista + CSS)                                                    │
│ /api/images/generate (DALL·E/SD) (stub)                                            │
│ /api/charts/parse (LLM -> spec JSON)                                               │
│ /api/export/pptx (PptxGenJS)                                                       │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3) Modelo de datos (slides + elements + Delta + export)

### Tipos base
- `Deck`: { title, slides[] }
- `Slide`: { id, size, background, elements[] }
- `Element`: común: { id, type, x,y,w,h, rotation, opacity, zIndex, locked }
- `TextElement`: { delta, defaultTextStyle, paragraphStyle }
- `ImageElement`: { src, mime, naturalW, naturalH }
- `ShapeElement`: { shapeType, fill, stroke, radius }
- `ChartElement`: { spec, svg, data }

### Unidades
- Canvas: px (96 DPI)
- PPTX: inches (PptxGenJS)
- Conversión: `in = px / 96`

> IMPORTANTE: Mantener un **slide size fijo** (ej. 1280×720 px) para que el export sea predecible.

---

## 4) Protocolo de streaming (WS) y render suave (queue + rAF)

### Mensajes WS (JSON)
- `client -> server`
  - `chat_start`: { requestId, prompt, context, mode: "slide_write" | "analysis" }
  - `chat_stop`: { requestId }
  - `image_generate`: { requestId, prompt, size }
  - `chart_parse`: { requestId, prompt }

- `server -> client`
  - `llm_token`: { requestId, token }
  - `llm_done`: { requestId }
  - `llm_error`: { requestId, message }
  - `image_result`: { requestId, imageUrl | b64 }
  - `chart_result`: { requestId, spec }

### Render “tipo escritura humana”
- cola de caracteres (tokens) en memoria
- `requestAnimationFrame` consume N caracteres por frame
- actualiza el **elemento activo** en el canvas
- muestra un **cursor parpadeante** mientras `streaming=true`

---

## 5) Estructura de repositorio (monorepo)

```text
ai-ppt-editor/
  package.json
  apps/
    api/
      package.json
      tsconfig.json
      src/
        index.ts
        env.ts
        ws/
          wsServer.ts
          llmStream.ts
        routes/
          chat.ts
          fonts.ts
          images.ts
          charts.ts
          export.ts
        llm/
          provider.ts
          internalSseProvider.ts
          openaiProvider.ts
          prompts.ts
        export/
          pptxBuilder.ts
          unit.ts
          svg.ts
        utils/
          sseParser.ts
          validate.ts
    web/
      package.json
      vite.config.ts
      tsconfig.json
      index.html
      src/
        main.tsx
        App.tsx
        styles.css
        api/
          wsClient.ts
          http.ts
          fonts.ts
          export.ts
        store/
          deckStore.ts
          history.ts
          types.ts
        editor/
          EditorShell.tsx
          CanvasStage.tsx
          elements/
            TextNode.tsx
            ShapeNode.tsx
            ImageNode.tsx
            ChartNode.tsx
          overlays/
            RichTextOverlay.tsx
            HyperlinkModal.tsx
          panels/
            SlidesPanel.tsx
            LayersPanel.tsx
            PropertiesPanel.tsx
          guides/
            snap.ts
            guides.ts
        ribbon/
          Ribbon.tsx
          tabs/
            HomeTab.tsx
            InsertTab.tsx
            LayoutTab.tsx
            ReferencesTab.tsx
            ReviewTab.tsx
            ViewTab.tsx
            AITab.tsx
        chat/
          ChatPanel.tsx
          commands.ts
        ai/
          typingStream.ts
          context.ts
        collab/
          yjs.ts
```

---

# PARTE A — ROOT (workspaces)

## A1) `package.json` (root)

```json
{
  "name": "ai-ppt-editor",
  "private": true,
  "workspaces": ["apps/*"],
  "scripts": {
    "dev": "npm-run-all -p dev:web dev:api",
    "dev:web": "npm --workspace apps/web run dev",
    "dev:api": "npm --workspace apps/api run dev",
    "build": "npm --workspaces run build"
  },
  "devDependencies": {
    "npm-run-all": "^4.1.5"
  }
}
```

---

# PARTE B — BACKEND (apps/api)

## B1) `apps/api/package.json`

```json
{
  "name": "@ai-ppt-editor/api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "pptxgenjs": "^3.12.0",
    "ws": "^8.18.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.10",
    "@types/ws": "^8.5.10",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
```

> Ajusta versiones según tu lockfile estándar.

---

## B2) `apps/api/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

---

## B3) `apps/api/src/env.ts`

```ts
import dotenv from "dotenv";

dotenv.config();

export const env = {
  PORT: Number(process.env.PORT ?? 3001),
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:5173",

  // Tu API interna de LLM (streaming). Ejemplo:
  // LLM_BASE_URL="http://localhost:8080"
  LLM_BASE_URL: process.env.LLM_BASE_URL ?? "",

  // Opcional: OpenAI (si quieres usarlo como provider)
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",

  // Google Fonts Webfonts API
  GOOGLE_FONTS_API_KEY: process.env.GOOGLE_FONTS_API_KEY ?? ""
} as const;
```

---

## B4) `apps/api/src/index.ts` (Express + WS + rutas)

```ts
import http from "node:http";
import express from "express";
import cors from "cors";

import { env } from "./env";
import { attachWsServer } from "./ws/wsServer";

import { chatRouter } from "./routes/chat";
import { fontsRouter } from "./routes/fonts";
import { imagesRouter } from "./routes/images";
import { chartsRouter } from "./routes/charts";
import { exportRouter } from "./routes/export";

const app = express();
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "20mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/chat", chatRouter);
app.use("/api/fonts", fontsRouter);
app.use("/api/images", imagesRouter);
app.use("/api/charts", chartsRouter);
app.use("/api/export", exportRouter);

const server = http.createServer(app);
attachWsServer(server);

server.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://localhost:${env.PORT}`);
});
```

---

## B5) WebSocket server — `apps/api/src/ws/wsServer.ts`

```ts
import type http from "node:http";
import { WebSocketServer } from "ws";
import { handleWsConnection } from "./llmStream";

export function attachWsServer(server: http.Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket) => {
    handleWsConnection(socket);
  });

  // eslint-disable-next-line no-console
  console.log("[ws] attached at /ws");
}
```

---

## B6) Streaming LLM — `apps/api/src/ws/llmStream.ts`

```ts
import type WebSocket from "ws";
import { z } from "zod";
import { streamChatCompletion } from "../llm/provider";
import { parseChartSpecViaLLM } from "../llm/prompts";

// -----------------------
// Schema mensajes
// -----------------------
const ChatStart = z.object({
  type: z.literal("chat_start"),
  requestId: z.string(),
  prompt: z.string(),
  context: z.any().optional(),
  mode: z.enum(["slide_write", "analysis"]).default("slide_write")
});

const ChatStop = z.object({
  type: z.literal("chat_stop"),
  requestId: z.string()
});

const ImageGenerate = z.object({
  type: z.literal("image_generate"),
  requestId: z.string(),
  prompt: z.string(),
  size: z.enum(["512", "1024"]).default("1024")
});

const ChartParse = z.object({
  type: z.literal("chart_parse"),
  requestId: z.string(),
  prompt: z.string()
});

const ClientMsg = z.union([ChatStart, ChatStop, ImageGenerate, ChartParse]);

type ClientMsg = z.infer<typeof ClientMsg>;

function safeSend(ws: WebSocket, data: unknown) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// -----------------------
// Handler principal
// -----------------------
export function handleWsConnection(ws: WebSocket) {
  let abortByRequest = new Map<string, AbortController>();

  ws.on("message", async (raw) => {
    let msg: ClientMsg;
    try {
      msg = ClientMsg.parse(JSON.parse(String(raw)));
    } catch (e) {
      safeSend(ws, { type: "llm_error", requestId: "unknown", message: "Invalid message schema" });
      return;
    }

    if (msg.type === "chat_stop") {
      abortByRequest.get(msg.requestId)?.abort();
      abortByRequest.delete(msg.requestId);
      return;
    }

    if (msg.type === "chart_parse") {
      const controller = new AbortController();
      abortByRequest.set(msg.requestId, controller);

      try {
        const spec = await parseChartSpecViaLLM({
          prompt: msg.prompt,
          signal: controller.signal
        });
        safeSend(ws, { type: "chart_result", requestId: msg.requestId, spec });
      } catch (err: any) {
        safeSend(ws, { type: "llm_error", requestId: msg.requestId, message: String(err?.message ?? err) });
      } finally {
        abortByRequest.delete(msg.requestId);
      }
      return;
    }

    if (msg.type === "image_generate") {
      // TODO(PROD): Integrar DALL·E / SD (según tu infraestructura).
      // Retornamos stub para no bloquear el equipo.
      safeSend(ws, {
        type: "image_result",
        requestId: msg.requestId,
        imageUrl: "data:image/svg+xml;base64," + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="#eee"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="36" fill="#555">IMAGE STUB</text></svg>`).toString("base64")
      });
      return;
    }

    if (msg.type === "chat_start") {
      const controller = new AbortController();
      abortByRequest.set(msg.requestId, controller);

      try {
        await streamChatCompletion({
          prompt: msg.prompt,
          context: msg.context,
          mode: msg.mode,
          signal: controller.signal,
          onToken: (token) => {
            safeSend(ws, { type: "llm_token", requestId: msg.requestId, token });
          }
        });

        safeSend(ws, { type: "llm_done", requestId: msg.requestId });
      } catch (err: any) {
        safeSend(ws, { type: "llm_error", requestId: msg.requestId, message: String(err?.message ?? err) });
      } finally {
        abortByRequest.delete(msg.requestId);
      }
      return;
    }
  });

  ws.on("close", () => {
    abortByRequest.forEach((c) => c.abort());
    abortByRequest.clear();
  });

  safeSend(ws, { type: "hello", server: "ai-ppt-editor-api" });
}
```

---

## B7) Provider genérico LLM — `apps/api/src/llm/provider.ts`

```ts
import { env } from "../env";
import { streamFromInternalSSE } from "./internalSseProvider";
import { streamFromOpenAI } from "./openaiProvider";

export type StreamChatArgs = {
  prompt: string;
  context?: unknown;
  mode: "slide_write" | "analysis";
  signal: AbortSignal;
  onToken: (token: string) => void;
};

export async function streamChatCompletion(args: StreamChatArgs) {
  if (env.LLM_BASE_URL) {
    return streamFromInternalSSE(args);
  }

  // Fallback opcional: OpenAI si no hay LLM_BASE_URL
  if (env.OPENAI_API_KEY) {
    return streamFromOpenAI(args);
  }

  throw new Error("No LLM provider configured. Set LLM_BASE_URL or OPENAI_API_KEY.");
}
```

---

## B8) Adaptador a tu LLM (SSE) — `apps/api/src/llm/internalSseProvider.ts`

> Asume que tu API interna expone un endpoint que hace streaming tipo SSE o chunked.
> Si tu API usa WebSocket, cambia esta implementación.

```ts
import { env } from "../env";
import type { StreamChatArgs } from "./provider";
import { parseSSEStream } from "../utils/sseParser";

/**
 * POST {LLM_BASE_URL}/chat/stream
 * body: { prompt, context, mode }
 * response: text/event-stream con tokens en `data: ...`
 */
export async function streamFromInternalSSE(args: StreamChatArgs) {
  const url = `${env.LLM_BASE_URL.replace(/\/$/, "")}/chat/stream`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
      // Authorization: `Bearer ...` (si aplica)
    },
    body: JSON.stringify({
      prompt: args.prompt,
      context: args.context ?? {},
      mode: args.mode
    }),
    signal: args.signal
  });

  if (!res.ok || !res.body) {
    throw new Error(`LLM stream failed: ${res.status} ${res.statusText}`);
  }

  await parseSSEStream(res.body, {
    signal: args.signal,
    onEvent: (evt) => {
      // Convención: evt.data contiene token o chunks
      if (evt.event === "token" || evt.event === "message" || !evt.event) {
        if (evt.data) args.onToken(evt.data);
      }
      if (evt.event === "done") {
        // noop: el caller enviará llm_done
      }
    }
  });
}
```

---

## B9) Provider OpenAI (opcional) — `apps/api/src/llm/openaiProvider.ts`

> Implementación simplificada de streaming SSE de OpenAI. Ajusta a tu SDK oficial si lo prefieres.

```ts
import type { StreamChatArgs } from "./provider";
import { env } from "../env";
import { parseSSEStream } from "../utils/sseParser";

export async function streamFromOpenAI(args: StreamChatArgs) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini", // TODO(PROD): configura modelo
      stream: true,
      messages: [
        { role: "system", content: args.mode === "slide_write" ? "Write slide-ready content." : "Analyze and suggest improvements." },
        { role: "user", content: args.prompt }
      ]
    }),
    signal: args.signal
  });

  if (!res.ok || !res.body) {
    throw new Error(`OpenAI stream failed: ${res.status} ${res.statusText}`);
  }

  await parseSSEStream(res.body, {
    signal: args.signal,
    onEvent: (evt) => {
      if (evt.data === "[DONE]") return;
      try {
        const json = JSON.parse(evt.data);
        const token = json?.choices?.[0]?.delta?.content ?? "";
        if (token) args.onToken(token);
      } catch {
        // ignore parse errors
      }
    }
  });
}
```

---

## B10) Parser SSE — `apps/api/src/utils/sseParser.ts`

```ts
export type SSEEvent = { event?: string; data: string };

export async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  opts: {
    signal: AbortSignal;
    onEvent: (evt: SSEEvent) => void;
  }
) {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");

  let buffer = "";
  let currentEvent: Partial<SSEEvent> = {};

  const flush = () => {
    if (currentEvent.data !== undefined) {
      opts.onEvent({ event: currentEvent.event, data: currentEvent.data });
    }
    currentEvent = {};
  };

  while (true) {
    if (opts.signal.aborted) throw new Error("aborted");

    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE frames separated by \n\n
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const lines = frame.split("\n");
      currentEvent = { data: "" };

      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEvent.event = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          const d = line.slice("data:".length);
          currentEvent.data = (currentEvent.data ?? "") + d.trim();
        }
      }

      flush();
    }
  }
}
```

---

## B11) Prompts/context analysis — `apps/api/src/llm/prompts.ts`

```ts
import { streamChatCompletion } from "./provider";

export async function parseChartSpecViaLLM(args: { prompt: string; signal: AbortSignal }) {
  // Minimal: usa LLM en modo analysis y luego parsea JSON.
  // En PROD: usar un esquema Zod y “JSON-only” con retries.
  let out = "";
  await streamChatCompletion({
    prompt: `Convert the following request into a valid ECharts option JSON. Return JSON only. Request: ${args.prompt}`,
    mode: "analysis",
    signal: args.signal,
    onToken: (t) => (out += t)
  });

  // Extrae JSON "best effort"
  const first = out.indexOf("{");
  const last = out.lastIndexOf("}");
  if (first === -1 || last === -1) throw new Error("Could not parse JSON from LLM output");

  const jsonStr = out.slice(first, last + 1);
  return JSON.parse(jsonStr);
}
```

---

## B12) Routes — Chat SSE (alternativa) `apps/api/src/routes/chat.ts`

```ts
import { Router } from "express";
import { z } from "zod";
import { streamChatCompletion } from "../llm/provider";

export const chatRouter = Router();

chatRouter.get("/stream", async (req, res) => {
  const schema = z.object({
    prompt: z.string().min(1),
    mode: z.enum(["slide_write", "analysis"]).optional()
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params" });
    return;
  }

  const { prompt, mode } = parsed.data;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive"
  });

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    await streamChatCompletion({
      prompt,
      mode: mode ?? "slide_write",
      signal: controller.signal,
      onToken: (token) => {
        res.write(`event: token\n`);
        res.write(`data: ${JSON.stringify(token)}\n\n`);
      }
    });

    res.write("event: done\n");
    res.write("data: ok\n\n");
    res.end();
  } catch (err: any) {
    res.write("event: error\n");
    res.write(`data: ${JSON.stringify(String(err?.message ?? err))}\n\n`);
    res.end();
  }
});
```

---

## B13) Routes — Google Fonts `apps/api/src/routes/fonts.ts`

```ts
import { Router } from "express";
import { env } from "../env";

export const fontsRouter = Router();

let cache: any = null;
let cacheAt = 0;

fontsRouter.get("/google", async (_req, res) => {
  // TODO(PROD): caching robusto + ETag.
  if (!env.GOOGLE_FONTS_API_KEY) {
    res.json({
      items: [
        { family: "Inter" },
        { family: "Roboto" },
        { family: "Open Sans" },
        { family: "Montserrat" },
        { family: "Poppins" }
      ],
      source: "fallback"
    });
    return;
  }

  const now = Date.now();
  if (cache && now - cacheAt < 1000 * 60 * 60 * 6) {
    res.json(cache);
    return;
  }

  const url = `https://www.googleapis.com/webfonts/v1/webfonts?sort=popularity&key=${env.GOOGLE_FONTS_API_KEY}`;
  const r = await fetch(url);
  if (!r.ok) {
    res.status(500).json({ error: "google fonts fetch failed" });
    return;
  }

  const json = await r.json();
  cache = json;
  cacheAt = now;
  res.json(json);
});

fontsRouter.get("/google/css", async (req, res) => {
  // Devuelve un CSS @import o @font-face para una family concreta.
  const family = String(req.query.family ?? "");
  if (!family) {
    res.status(400).send("missing family");
    return;
  }

  // Google Fonts CSS endpoint (sin key)
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@300;400;500;600;700&display=swap`;
  const css = await fetch(cssUrl).then((r) => r.text());

  res.setHeader("Content-Type", "text/css; charset=utf-8");
  res.send(css);
});
```

---

## B14) Routes — Images (stub) `apps/api/src/routes/images.ts`

```ts
import { Router } from "express";
import { z } from "zod";

export const imagesRouter = Router();

imagesRouter.post("/generate", async (req, res) => {
  const schema = z.object({
    prompt: z.string().min(1),
    size: z.enum(["512", "1024"]).default("1024")
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }

  // TODO(PROD): integrar provider real.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${parsed.data.size}" height="${parsed.data.size}"><rect width="100%" height="100%" fill="#eee"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="36" fill="#555">IMAGE STUB</text></svg>`;
  res.json({ b64: Buffer.from(svg).toString("base64"), mime: "image/svg+xml" });
});
```

---

## B15) Routes — Charts `apps/api/src/routes/charts.ts`

```ts
import { Router } from "express";
import { z } from "zod";
import { parseChartSpecViaLLM } from "../llm/prompts";

export const chartsRouter = Router();

chartsRouter.post("/parse", async (req, res) => {
  const schema = z.object({ prompt: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    const spec = await parseChartSpecViaLLM({ prompt: parsed.data.prompt, signal: controller.signal });
    res.json({ spec });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});
```

---

## B16) Export PPTX — route `apps/api/src/routes/export.ts`

```ts
import { Router } from "express";
import { z } from "zod";
import { buildPptx } from "../export/pptxBuilder";

export const exportRouter = Router();

exportRouter.post("/pptx", async (req, res) => {
  const schema = z.object({
    deck: z.any() // valida en el frontend/contrato real; en PROD usa Zod estricto.
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }

  try {
    const pptxBuffer = await buildPptx(parsed.data.deck);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    res.setHeader("Content-Disposition", "attachment; filename=\"presentation.pptx\"");
    res.send(pptxBuffer);
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});
```

---

## B17) Export builder — `apps/api/src/export/unit.ts`

```ts
export const PX_PER_IN = 96;

export function pxToIn(px: number): number {
  return px / PX_PER_IN;
}

export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
```

---

## B18) Export builder — `apps/api/src/export/svg.ts`

```ts
export function dataUriFromSvg(svg: string): string {
  const b64 = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${b64}`;
}
```

---

## B19) Export builder — `apps/api/src/export/pptxBuilder.ts`

```ts
import pptxgen from "pptxgenjs";
import { pxToIn } from "./unit";
import { dataUriFromSvg } from "./svg";

/**
 * Contrato esperado (resumen):
 * deck = { title: string, slides: Slide[] }
 * Slide = { id, size:{w,h}, background, elements: Element[] }
 */
export async function buildPptx(deck: any): Promise<Buffer> {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5

  // TODO(FONTS): embedding real de fuentes requiere OOXML + licencias.

  for (const s of deck.slides ?? []) {
    const slide = pptx.addSlide();

    // Fondo
    if (s.background?.color) {
      slide.background = { color: normalizeHex(s.background.color) };
    }

    // Elementos ordenados por zIndex
    const elements = [...(s.elements ?? [])].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

    for (const el of elements) {
      const x = pxToIn(el.x ?? 0);
      const y = pxToIn(el.y ?? 0);
      const w = pxToIn(el.w ?? 100);
      const h = pxToIn(el.h ?? 40);

      if (el.type === "text") {
        const plain = deltaToPlainText(el.delta);
        slide.addText(plain, {
          x,
          y,
          w,
          h,
          fontFace: el.defaultTextStyle?.fontFamily ?? "Arial",
          fontSize: el.defaultTextStyle?.fontSize ?? 18,
          color: normalizeHex(el.defaultTextStyle?.color ?? "#111111"),
          bold: !!el.defaultTextStyle?.bold,
          italic: !!el.defaultTextStyle?.italic,
          underline: el.defaultTextStyle?.underline ? true : false
        });

        // TODO(VECTOR): Rich text por runs: si usas PptxGenJS rich text API, construye runs desde Delta.
        continue;
      }

      if (el.type === "shape") {
        // PptxGenJS shapes: rect, ellipse, etc.
        // Simple: rect
        slide.addShape(pptx.ShapeType.rect, {
          x, y, w, h,
          fill: { color: normalizeHex(el.fill ?? "#FFFFFF") },
          line: { color: normalizeHex(el.stroke ?? "#000000"), width: el.strokeWidth ?? 1 }
        });
        continue;
      }

      if (el.type === "image") {
        // src puede ser dataURI (png/jpg/svg) o URL
        slide.addImage({
          data: el.src,
          x, y, w, h
        });
        continue;
      }

      if (el.type === "chart") {
        // Preferimos SVG si está disponible
        if (typeof el.svg === "string" && el.svg.trim().startsWith("<svg")) {
          const uri = dataUriFromSvg(el.svg);
          slide.addImage({ data: uri, x, y, w, h });
        } else if (el.src) {
          slide.addImage({ data: el.src, x, y, w, h });
        }
        continue;
      }
    }
  }

  // PptxGenJS -> write en memoria
  const out = await pptx.write("nodebuffer");
  return Buffer.from(out);
}

function normalizeHex(hex: string): string {
  const h = String(hex || "").trim();
  if (!h) return "000000";
  return h.replace("#", "").toUpperCase();
}

function deltaToPlainText(delta: any): string {
  // Delta: { ops: [{ insert: "text", attributes?: {} }, ...] }
  const ops = delta?.ops ?? [];
  let out = "";
  for (const op of ops) {
    if (typeof op.insert === "string") out += op.insert;
  }
  return out;
}
```

---

# PARTE C — FRONTEND (apps/web)

## C1) `apps/web/package.json`

```json
{
  "name": "@ai-ppt-editor/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "konva": "^9.3.18",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-konva": "^18.2.10",
    "zustand": "^4.5.5",
    "quill": "^1.3.7",
    "nanoid": "^5.0.7",
    "echarts": "^5.5.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.6.3",
    "vite": "^5.4.10"
  }
}
```

---

## C2) `apps/web/vite.config.ts`

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  }
});
```

---

## C3) `apps/web/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

---

## C4) `apps/web/src/main.tsx`

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

---

## C5) Estilos globales `apps/web/src/styles.css`

```css
:root {
  --bg: #f6f7fb;
  --panel: #ffffff;
  --line: rgba(0,0,0,0.10);
  --text: #111;
  --muted: rgba(0,0,0,0.65);
  --accent: #d83b01; /* naranja/rojo estilo Office */
  --blue: #2563eb;
  --shadow: 0 6px 18px rgba(0,0,0,0.08);
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
}

html, body, #root {
  height: 100%;
  margin: 0;
  background: var(--bg);
  color: var(--text);
}

button, input, select {
  font: inherit;
}

.app {
  height: 100%;
  display: grid;
  grid-template-columns: 380px 1fr;
}

.leftPanel {
  border-right: 1px solid var(--line);
  background: var(--panel);
  display: grid;
  grid-template-rows: 1fr auto;
}

.rightPanel {
  display: grid;
  grid-template-rows: 48px 92px 1fr;
  min-width: 0;
}

.headerBar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
}

.headerTitleInput {
  font-size: 14px;
  font-weight: 600;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  min-width: 240px;
}

.headerTitleInput:focus {
  outline: none;
  border-color: rgba(37,99,235,0.35);
  background: rgba(37,99,235,0.06);
}

.headerSpacer { flex: 1; }

.pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 999px;
  padding: 8px 12px;
  cursor: pointer;
}

.primary {
  background: var(--accent);
  color: #fff;
  border-color: transparent;
}

.iconBtn {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: #fff;
  cursor: pointer;
}

.iconBtn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ribbon {
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  display: grid;
  grid-template-rows: 32px 1fr;
}

.tabsRow {
  display: flex;
  gap: 18px;
  padding: 0 10px;
  align-items: center;
  border-bottom: 1px solid var(--line);
}

.tab {
  height: 32px;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  font-size: 13px;
  color: var(--muted);
  position: relative;
}

.tab.active {
  color: var(--text);
  font-weight: 700;
}

.tab.active::after {
  content: "";
  position: absolute;
  left: 0;
  bottom: -1px;
  height: 3px;
  width: 100%;
  background: var(--accent);
  border-radius: 3px 3px 0 0;
}

.ribbonBody {
  display: flex;
  gap: 14px;
  padding: 10px;
  overflow-x: auto;
}

.group {
  border-right: 1px solid rgba(0,0,0,0.08);
  padding-right: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 170px;
}

.group:last-child { border-right: none; }

.groupTitle {
  font-size: 11px;
  color: var(--muted);
}

.row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.select, .input {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 8px;
  background: #fff;
}

.toggleBtn {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 6px;
  padding: 6px 8px;
  cursor: pointer;
  min-width: 34px;
  text-align: center;
}

.toggleBtn.active {
  border-color: rgba(37,99,235,0.35);
  background: rgba(37,99,235,0.06);
}

.editorArea {
  display: grid;
  grid-template-columns: 190px 1fr 320px;
  gap: 10px;
  padding: 10px;
  min-height: 0;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto 1fr;
}

.panelHeader {
  padding: 10px;
  border-bottom: 1px solid var(--line);
  font-weight: 700;
  font-size: 13px;
}

.panelBody {
  padding: 10px;
  overflow: auto;
}

.canvasWrap {
  background: linear-gradient(#fff, #fff);
  border-radius: 12px;
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  display: grid;
  place-items: center;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.canvasControls {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  gap: 8px;
  z-index: 2;
}

.canvasControls .pill {
  padding: 6px 10px;
}

.chatHeader {
  padding: 10px;
  border-bottom: 1px solid var(--line);
  font-weight: 700;
}

.chatMessages {
  padding: 10px;
  overflow: auto;
}

.chatMsg {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  margin-bottom: 10px;
  background: #fff;
}

.chatMsgRole {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 6px;
}

.chatComposer {
  padding: 10px;
  border-top: 1px solid var(--line);
  display: flex;
  gap: 8px;
}

.chatInput {
  flex: 1;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px;
}

.modalBackdrop {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.28);
  display: grid;
  place-items: center;
  z-index: 50;
}

.modal {
  width: 420px;
  background: #fff;
  border-radius: 14px;
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.modalHeader {
  padding: 12px;
  border-bottom: 1px solid var(--line);
  font-weight: 800;
}

.modalBody {
  padding: 12px;
  display: grid;
  gap: 10px;
}

.modalFooter {
  padding: 12px;
  border-top: 1px solid var(--line);
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.konvaOverlayEditor {
  position: absolute;
  z-index: 30;
  border: 1px solid rgba(37,99,235,0.35);
  border-radius: 8px;
  box-shadow: var(--shadow);
  background: #fff;
}

.typingCursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  vertical-align: -0.15em;
  margin-left: 2px;
  background: rgba(0,0,0,0.85);
  animation: blink 1s steps(1) infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}
```

---

## C6) Tipos y store — `apps/web/src/store/types.ts`

```ts
export type SlideSize = { w: number; h: number };

export type TextStyle = {
  fontFamily: string;
  fontSize: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
};

export type DeltaOp = {
  insert: string;
  attributes?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    color?: string;
    link?: string;
    header?: 1 | 2 | 3; // para H1/H2/H3
    list?: "bullet" | "ordered";
  };
};

export type Delta = { ops: DeltaOp[] };

export type BaseElement = {
  id: string;
  type: "text" | "image" | "shape" | "chart";
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  locked?: boolean;
};

export type TextElement = BaseElement & {
  type: "text";
  delta: Delta;
  defaultTextStyle: TextStyle;
};

export type ImageElement = BaseElement & {
  type: "image";
  src: string; // dataURI o URL
  mime?: string;
  naturalW?: number;
  naturalH?: number;
};

export type ShapeElement = BaseElement & {
  type: "shape";
  shapeType: "rect" | "ellipse";
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius?: number;
};

export type ChartElement = BaseElement & {
  type: "chart";
  spec: any;     // ECharts option JSON
  svg?: string;  // export SVG
  src?: string;  // fallback PNG
};

export type ElementAny = TextElement | ImageElement | ShapeElement | ChartElement;

export type Slide = {
  id: string;
  size: SlideSize;
  background: { color: string };
  elements: ElementAny[];
};

export type Deck = {
  title: string;
  slides: Slide[];
};

export type Selection = { slideId: string; elementId: string } | null;
```

---

## C7) History (undo/redo) — `apps/web/src/store/history.ts`

```ts
export type HistoryState<T> = {
  past: T[];
  present: T;
  future: T[];
};

export function createHistory<T>(initial: T): HistoryState<T> {
  return { past: [], present: initial, future: [] };
}

export function pushHistory<T>(h: HistoryState<T>, next: T, limit = 80): HistoryState<T> {
  const past = [...h.past, h.present];
  if (past.length > limit) past.shift();
  return { past, present: next, future: [] };
}

export function undoHistory<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.past.length === 0) return h;
  const prev = h.past[h.past.length - 1];
  const past = h.past.slice(0, -1);
  const future = [h.present, ...h.future];
  return { past, present: prev, future };
}

export function redoHistory<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.future.length === 0) return h;
  const next = h.future[0];
  const future = h.future.slice(1);
  const past = [...h.past, h.present];
  return { past, present: next, future };
}
```

---

## C8) Store central (Zustand) — `apps/web/src/store/deckStore.ts`

```ts
import { create } from "zustand";
import { nanoid } from "nanoid";
import type { Deck, ElementAny, Slide, TextElement, TextStyle, Selection, Delta } from "./types";
import { createHistory, pushHistory, redoHistory, undoHistory, type HistoryState } from "./history";

function defaultDeck(): Deck {
  const slide: Slide = {
    id: nanoid(),
    size: { w: 1280, h: 720 },
    background: { color: "#FFFFFF" },
    elements: [
      {
        id: nanoid(),
        type: "text",
        x: 80,
        y: 80,
        w: 820,
        h: 140,
        zIndex: 1,
        delta: { ops: [{ insert: "Título de la diapositiva\n" }] },
        defaultTextStyle: {
          fontFamily: "Inter",
          fontSize: 44,
          color: "#111111",
          bold: true
        }
      } as TextElement
    ]
  };

  return {
    title: "Nueva Presentación",
    slides: [slide]
  };
}

export type EditorMode = "manual" | "ai";

type DeckState = {
  history: HistoryState<Deck>;
  selection: Selection;
  activeSlideId: string;
  activeTab:
    | "Home"
    | "Insert"
    | "Layout"
    | "References"
    | "Review"
    | "View"
    | "AI";
  editorMode: EditorMode;
  streaming: { active: boolean; requestId?: string };

  // actions
  setTitle(title: string): void;
  setActiveTab(tab: DeckState["activeTab"]): void;
  setEditorMode(mode: EditorMode): void;

  undo(): void;
  redo(): void;

  select(selection: Selection): void;
  addSlide(): void;
  setActiveSlide(slideId: string): void;

  addElement(el: ElementAny): void;
  updateElement(elementId: string, patch: Partial<ElementAny>): void;
  bringToFront(elementId: string): void;
  sendToBack(elementId: string): void;
  deleteElement(elementId: string): void;

  updateTextDelta(elementId: string, delta: Delta): void;
  applyTextStyleToDefault(elementId: string, patch: Partial<TextStyle>): void;

  setStreaming(active: boolean, requestId?: string): void;

  getDeck(): Deck;
  getActiveSlide(): Slide;
  getSelectedElement(): ElementAny | null;
};

export const useDeckStore = create<DeckState>((set, get) => {
  const initial = defaultDeck();
  const activeSlideId = initial.slides[0].id;

  return {
    history: createHistory(initial),
    selection: { slideId: activeSlideId, elementId: initial.slides[0].elements[0].id },
    activeSlideId,
    activeTab: "Home",
    editorMode: "manual",
    streaming: { active: false },

    setTitle(title) {
      const deck = get().history.present;
      set({ history: pushHistory(get().history, { ...deck, title }) });
    },

    setActiveTab(tab) {
      set({ activeTab: tab });
    },

    setEditorMode(mode) {
      set({ editorMode: mode });
    },

    undo() {
      set({ history: undoHistory(get().history) });
    },

    redo() {
      set({ history: redoHistory(get().history) });
    },

    select(selection) {
      set({ selection });
    },

    addSlide() {
      const deck = get().history.present;
      const slide: Slide = {
        id: nanoid(),
        size: { w: 1280, h: 720 },
        background: { color: "#FFFFFF" },
        elements: []
      };

      const next = { ...deck, slides: [...deck.slides, slide] };
      set({
        history: pushHistory(get().history, next),
        activeSlideId: slide.id,
        selection: null
      });
    },

    setActiveSlide(slideId) {
      set({ activeSlideId: slideId, selection: null });
    },

    addElement(el) {
      const deck = get().history.present;
      const slideId = get().activeSlideId;
      const slides = deck.slides.map((s) => (s.id === slideId ? { ...s, elements: [...s.elements, el] } : s));
      set({ history: pushHistory(get().history, { ...deck, slides }) });
      set({ selection: { slideId, elementId: el.id } });
    },

    updateElement(elementId, patch) {
      const deck = get().history.present;
      const slideId = get().activeSlideId;
      const slides = deck.slides.map((s) => {
        if (s.id !== slideId) return s;
        return {
          ...s,
          elements: s.elements.map((e) => (e.id === elementId ? { ...e, ...patch } as any : e))
        };
      });
      set({ history: pushHistory(get().history, { ...deck, slides }) });
    },

    bringToFront(elementId) {
      const deck = get().history.present;
      const slide = deck.slides.find((s) => s.id === get().activeSlideId)!;
      const maxZ = Math.max(0, ...slide.elements.map((e) => e.zIndex ?? 0));
      get().updateElement(elementId, { zIndex: maxZ + 1 });
    },

    sendToBack(elementId) {
      const deck = get().history.present;
      const slide = deck.slides.find((s) => s.id === get().activeSlideId)!;
      const minZ = Math.min(0, ...slide.elements.map((e) => e.zIndex ?? 0));
      get().updateElement(elementId, { zIndex: minZ - 1 });
    },

    deleteElement(elementId) {
      const deck = get().history.present;
      const slideId = get().activeSlideId;
      const slides = deck.slides.map((s) =>
        s.id === slideId ? { ...s, elements: s.elements.filter((e) => e.id !== elementId) } : s
      );
      set({ history: pushHistory(get().history, { ...deck, slides }), selection: null });
    },

    updateTextDelta(elementId, delta) {
      const deck = get().history.present;
      const slideId = get().activeSlideId;
      const slides = deck.slides.map((s) => {
        if (s.id !== slideId) return s;
        return {
          ...s,
          elements: s.elements.map((e) => (e.id === elementId && e.type === "text" ? ({ ...e, delta } as any) : e))
        };
      });
      set({ history: pushHistory(get().history, { ...deck, slides }) });
    },

    applyTextStyleToDefault(elementId, patch) {
      const deck = get().history.present;
      const slideId = get().activeSlideId;
      const slides = deck.slides.map((s) => {
        if (s.id !== slideId) return s;
        return {
          ...s,
          elements: s.elements.map((e) => {
            if (e.id !== elementId) return e;
            if (e.type !== "text") return e;
            return {
              ...e,
              defaultTextStyle: { ...e.defaultTextStyle, ...patch }
            };
          })
        };
      });
      set({ history: pushHistory(get().history, { ...deck, slides }) });
    },

    setStreaming(active, requestId) {
      set({ streaming: { active, requestId } });
    },

    getDeck() {
      return get().history.present;
    },

    getActiveSlide() {
      const deck = get().history.present;
      return deck.slides.find((s) => s.id === get().activeSlideId)!;
    },

    getSelectedElement() {
      const sel = get().selection;
      if (!sel) return null;
      const deck = get().history.present;
      const slide = deck.slides.find((s) => s.id === sel.slideId);
      return slide?.elements.find((e) => e.id === sel.elementId) ?? null;
    }
  };
});
```

---

## C9) API helpers — `apps/web/src/api/http.ts`

```ts
export const API_BASE = "http://localhost:3001";

export async function postJSON<T>(path: string, body: any): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

---

## C10) WS client — `apps/web/src/api/wsClient.ts`

```ts
type WSMessage =
  | { type: "hello"; server: string }
  | { type: "llm_token"; requestId: string; token: string }
  | { type: "llm_done"; requestId: string }
  | { type: "llm_error"; requestId: string; message: string }
  | { type: "image_result"; requestId: string; imageUrl: string }
  | { type: "chart_result"; requestId: string; spec: any };

export type WSHandlers = {
  onMessage(msg: WSMessage): void;
};

export class EditorWS {
  private ws: WebSocket | null = null;
  private handlers: WSHandlers;

  constructor(handlers: WSHandlers) {
    this.handlers = handlers;
  }

  connect() {
    if (this.ws) return;
    const ws = new WebSocket("ws://localhost:3001/ws");
    this.ws = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        this.handlers.onMessage(msg);
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      this.ws = null;
      // TODO(PROD): reconectar con backoff
    };
  }

  send(data: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(data));
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }
}
```

---

## C11) Fonts loader — `apps/web/src/api/fonts.ts`

```ts
import { getJSON, API_BASE } from "./http";

export type GoogleFontsResponse = { items: { family: string }[]; source?: string };

export async function fetchGoogleFonts(): Promise<string[]> {
  const json = await getJSON<GoogleFontsResponse>("/api/fonts/google");
  return (json.items ?? []).map((x) => x.family);
}

export async function injectGoogleFontCss(family: string) {
  const id = `gf-${family.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;

  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `${API_BASE}/api/fonts/google/css?family=${encodeURIComponent(family)}`;
  document.head.appendChild(link);
}
```

---

## C12) Export API — `apps/web/src/api/export.ts`

```ts
import { postJSON } from "./http";
import type { Deck } from "../store/types";

export async function exportPptx(deck: Deck): Promise<Blob> {
  const res = await fetch("http://localhost:3001/api/export/pptx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deck })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

---

## C13) App layout — `apps/web/src/App.tsx`

```tsx
import React, { useMemo } from "react";
import { useDeckStore } from "./store/deckStore";
import { Ribbon } from "./ribbon/Ribbon";
import { ChatPanel } from "./chat/ChatPanel";
import { EditorShell } from "./editor/EditorShell";
import { exportPptx, downloadBlob } from "./api/export";

export default function App() {
  const deck = useDeckStore((s) => s.history.present);
  const undo = useDeckStore((s) => s.undo);
  const redo = useDeckStore((s) => s.redo);

  const canUndo = useDeckStore((s) => s.history.past.length > 0);
  const canRedo = useDeckStore((s) => s.history.future.length > 0);

  const title = useDeckStore((s) => s.history.present.title);
  const setTitle = useDeckStore((s) => s.setTitle);

  const [exportOpen, setExportOpen] = React.useState(false);

  const onExport = async (fmt: "pptx" | "pdf" | "png") => {
    setExportOpen(false);

    if (fmt === "pptx") {
      const blob = await exportPptx(deck);
      downloadBlob(blob, `${sanitize(title) || "presentation"}.pptx`);
      return;
    }

    // TODO(PROD): Implementar PDF/PNG por slide en backend.
    alert(`Export ${fmt} aún no implementado. (TODO)`);
  };

  return (
    <div className="app">
      {/* LEFT: Chat */}
      <div className="leftPanel">
        <div className="chatHeader">Chat IA</div>
        <ChatPanel />
      </div>

      {/* RIGHT: Editor */}
      <div className="rightPanel">
        {/* HEADER BAR */}
        <div className="headerBar">
          <button className="iconBtn" onClick={undo} disabled={!canUndo} title="Undo">↶</button>
          <button className="iconBtn" onClick={redo} disabled={!canRedo} title="Redo">↷</button>

          <input
            className="headerTitleInput"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Título de la presentación"
          />

          <div className="headerSpacer" />

          <div style={{ position: "relative" }}>
            <button className="pill primary" onClick={() => setExportOpen((v) => !v)}>
              Export ▾
            </button>

            {exportOpen && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 8px)",
                  background: "#fff",
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  boxShadow: "var(--shadow)",
                  overflow: "hidden",
                  minWidth: 220,
                  zIndex: 20
                }}
              >
                <MenuItem label="Exportar PPTX" onClick={() => onExport("pptx")} />
                <MenuItem label="Exportar PDF" onClick={() => onExport("pdf")} />
                <MenuItem label="Exportar PNG (por slide)" onClick={() => onExport("png")} />
              </div>
            )}
          </div>

          <button className="pill" onClick={() => alert("Cerrar (stub).")}>Cerrar ✕</button>
        </div>

        {/* RIBBON */}
        <Ribbon />

        {/* EDITOR */}
        <EditorShell />
      </div>
    </div>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ padding: "10px 12px", cursor: "pointer", borderBottom: "1px solid rgba(0,0,0,0.06)" }}
    >
      {label}
    </div>
  );
}

function sanitize(s: string) {
  return s.replace(/[^a-z0-9\-_ ]/gi, "").trim().replace(/\s+/g, "_");
}
```

---

# C14) Ribbon (tabs + cuerpos) — `apps/web/src/ribbon/Ribbon.tsx`

```tsx
import React from "react";
import { useDeckStore } from "../store/deckStore";
import { HomeTab } from "./tabs/HomeTab";
import { InsertTab } from "./tabs/InsertTab";
import { LayoutTab } from "./tabs/LayoutTab";
import { ReferencesTab } from "./tabs/ReferencesTab";
import { ReviewTab } from "./tabs/ReviewTab";
import { ViewTab } from "./tabs/ViewTab";
import { AITab } from "./tabs/AITab";

export function Ribbon() {
  const activeTab = useDeckStore((s) => s.activeTab);
  const setActiveTab = useDeckStore((s) => s.setActiveTab);

  return (
    <div className="ribbon">
      <div className="tabsRow">
        {(["Home", "Insert", "Layout", "References", "Review", "View", "AI"] as const).map((t) => (
          <div
            key={t}
            className={"tab " + (activeTab === t ? "active" : "")}
            onClick={() => setActiveTab(t)}
          >
            {labelOf(t)}
          </div>
        ))}
      </div>

      <div className="ribbonBody">
        {activeTab === "Home" && <HomeTab />}
        {activeTab === "Insert" && <InsertTab />}
        {activeTab === "Layout" && <LayoutTab />}
        {activeTab === "References" && <ReferencesTab />}
        {activeTab === "Review" && <ReviewTab />}
        {activeTab === "View" && <ViewTab />}
        {activeTab === "AI" && <AITab />}
      </div>
    </div>
  );
}

function labelOf(t: string) {
  switch (t) {
    case "Home": return "Inicio";
    case "Insert": return "Insertar";
    case "Layout": return "Diseño";
    case "References": return "Referencias";
    case "Review": return "Revisar";
    case "View": return "Vista";
    case "AI": return "IA";
    default: return t;
  }
}
```

---

## C15) Home tab — `apps/web/src/ribbon/tabs/HomeTab.tsx`

Incluye:
- Clipboard: paste / paste-special (stub)
- Font: selector Google Fonts, size, toggles (B/I/U/S), link modal, color picker
- Paragraph: bullets, numbers, align group
- Styles: H1/H2/H3 presets

```tsx
import React, { useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { useDeckStore } from "../../store/deckStore";
import type { TextElement } from "../../store/types";
import { fetchGoogleFonts, injectGoogleFontCss } from "../../api/fonts";
import { HyperlinkModal } from "../../editor/overlays/HyperlinkModal";

// Nota: El formateo real por rango vive en RichTextOverlay (Quill).
// Aquí emitimos "comandos" a un bus sencillo basado en window events.
function emitQuillCommand(cmd: { type: string; payload?: any }) {
  window.dispatchEvent(new CustomEvent("quill-command", { detail: cmd }));
}

export function HomeTab() {
  const selected = useDeckStore((s) => s.getSelectedElement()) as any;
  const selection = useDeckStore((s) => s.selection);

  const applyDefaultTextStyle = useDeckStore((s) => s.applyTextStyleToDefault);

  const [fonts, setFonts] = useState<string[]>(["Inter", "Roboto", "Open Sans"]);
  const [linkOpen, setLinkOpen] = useState(false);

  const isText = selected?.type === "text";
  const textEl: TextElement | null = isText ? selected : null;

  useEffect(() => {
    fetchGoogleFonts().then(setFonts).catch(() => {});
  }, []);

  const fontFamily = textEl?.defaultTextStyle.fontFamily ?? "Inter";
  const fontSize = textEl?.defaultTextStyle.fontSize ?? 18;
  const color = textEl?.defaultTextStyle.color ?? "#111111";

  const toggles = {
    bold: !!textEl?.defaultTextStyle.bold,
    italic: !!textEl?.defaultTextStyle.italic,
    underline: !!textEl?.defaultTextStyle.underline,
    strike: !!textEl?.defaultTextStyle.strike
  };

  const setFontFamily = async (family: string) => {
    if (!selection || !textEl) return;
    await injectGoogleFontCss(family);
    applyDefaultTextStyle(textEl.id, { fontFamily: family });

    // para selección en Quill (rango), enviamos comando:
    emitQuillCommand({ type: "format", payload: { key: "font", value: family } });
  };

  const setFontSize = (size: number) => {
    if (!selection || !textEl) return;
    applyDefaultTextStyle(textEl.id, { fontSize: size });
    emitQuillCommand({ type: "format", payload: { key: "size", value: size } });
  };

  const toggle = (key: keyof typeof toggles) => {
    if (!selection || !textEl) return;
    const next = !toggles[key];
    applyDefaultTextStyle(textEl.id, { [key]: next } as any);
    emitQuillCommand({ type: "format", payload: { key, value: next } });
  };

  const applyHeading = (h: 1 | 2 | 3) => {
    // Quill usa 'header' para H1/H2/H3
    emitQuillCommand({ type: "format", payload: { key: "header", value: h } });
    // defaultStyle: ajusta un size sugerido
    if (textEl) {
      const preset = h === 1 ? 44 : h === 2 ? 32 : 24;
      applyDefaultTextStyle(textEl.id, { fontSize: preset, bold: true });
    }
  };

  return (
    <>
      {/* Clipboard */}
      <div className="group">
        <div className="row">
          <button className="pill" onClick={() => alert("Paste (stub)")}>Pegar ▾</button>
          <button className="pill" onClick={() => alert("Paste Special (stub)")}>Pegado especial</button>
        </div>
        <div className="groupTitle">Portapapeles</div>
      </div>

      {/* Font */}
      <div className="group">
        <div className="row">
          <select className="select" value={fontFamily} disabled={!isText} onChange={(e) => setFontFamily(e.target.value)}>
            {fonts.slice(0, 80).map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>

          <input
            className="input"
            type="number"
            value={fontSize}
            min={6}
            max={160}
            disabled={!isText}
            onChange={(e) => setFontSize(Number(e.target.value))}
            style={{ width: 86 }}
          />

          <select
            className="select"
            disabled={!isText}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
          >
            {[10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 44, 54, 64, 72].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="row">
          <button className={"toggleBtn " + (toggles.bold ? "active" : "")} disabled={!isText} onClick={() => toggle("bold")}><b>B</b></button>
          <button className={"toggleBtn " + (toggles.italic ? "active" : "")} disabled={!isText} onClick={() => toggle("italic")}><i>I</i></button>
          <button className={"toggleBtn " + (toggles.underline ? "active" : "")} disabled={!isText} onClick={() => toggle("underline")}><u>U</u></button>
          <button className={"toggleBtn " + (toggles.strike ? "active" : "")} disabled={!isText} onClick={() => toggle("strike")}><s>S</s></button>

          <button className="pill" disabled={!isText} onClick={() => setLinkOpen(true)}>Enlace</button>

          <input
            type="color"
            value={color}
            disabled={!isText}
            onChange={(e) => {
              if (!textEl) return;
              applyDefaultTextStyle(textEl.id, { color: e.target.value });
              emitQuillCommand({ type: "format", payload: { key: "color", value: e.target.value } });
            }}
            title="Color de texto"
            style={{ width: 44, height: 34, border: "none", background: "transparent" }}
          />
        </div>

        <div className="groupTitle">Fuente</div>
      </div>

      {/* Paragraph */}
      <div className="group">
        <div className="row">
          <button className="pill" disabled={!isText} onClick={() => emitQuillCommand({ type: "list", payload: "bullet" })}>• Lista</button>
          <button className="pill" disabled={!isText} onClick={() => emitQuillCommand({ type: "list", payload: "ordered" })}>1. Lista</button>
        </div>

        <div className="row">
          <button className="pill" disabled={!isText} onClick={() => emitQuillCommand({ type: "align", payload: "left" })}>⟸</button>
          <button className="pill" disabled={!isText} onClick={() => emitQuillCommand({ type: "align", payload: "center" })}>≡</button>
          <button className="pill" disabled={!isText} onClick={() => emitQuillCommand({ type: "align", payload: "right" })}>⟹</button>
          <button className="pill" disabled={!isText} onClick={() => emitQuillCommand({ type: "align", payload: "justify" })}>☰</button>
        </div>

        <div className="groupTitle">Párrafo</div>
      </div>

      {/* Styles */}
      <div className="group">
        <div className="row">
          <button className="pill" disabled={!isText} onClick={() => applyHeading(1)}>H1</button>
          <button className="pill" disabled={!isText} onClick={() => applyHeading(2)}>H2</button>
          <button className="pill" disabled={!isText} onClick={() => applyHeading(3)}>H3</button>
        </div>
        <div className="groupTitle">Estilos</div>
      </div>

      {linkOpen && <HyperlinkModal onClose={() => setLinkOpen(false)} />}
    </>
  );
}
```

---

## C16) Insert tab — `apps/web/src/ribbon/tabs/InsertTab.tsx`

Incluye: imágenes, shapes, gráficos, tablas, videos, iconos (varios stubs).

```tsx
import React from "react";
import { nanoid } from "nanoid";
import { useDeckStore } from "../../store/deckStore";
import type { ImageElement, ShapeElement, ChartElement } from "../../store/types";

export function InsertTab() {
  const addElement = useDeckStore((s) => s.addElement);

  const onInsertRect = () => {
    const el: ShapeElement = {
      id: nanoid(),
      type: "shape",
      shapeType: "rect",
      x: 120,
      y: 220,
      w: 260,
      h: 140,
      fill: "#E5E7EB",
      stroke: "#111111",
      strokeWidth: 1,
      zIndex: 10
    };
    addElement(el);
  };

  const onInsertEllipse = () => {
    const el: ShapeElement = {
      id: nanoid(),
      type: "shape",
      shapeType: "ellipse",
      x: 450,
      y: 240,
      w: 220,
      h: 140,
      fill: "#DBEAFE",
      stroke: "#111111",
      strokeWidth: 1,
      zIndex: 10
    };
    addElement(el);
  };

  const onInsertImage = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const dataUrl = await fileToDataUrl(file);

      const el: ImageElement = {
        id: nanoid(),
        type: "image",
        x: 120,
        y: 120,
        w: 420,
        h: 260,
        src: dataUrl,
        mime: file.type,
        zIndex: 20
      };
      addElement(el);
    };
    input.click();
  };

  const onInsertChartStub = () => {
    const el: ChartElement = {
      id: nanoid(),
      type: "chart",
      x: 120,
      y: 420,
      w: 520,
      h: 240,
      zIndex: 30,
      spec: {
        title: { text: "Chart (stub)" },
        xAxis: { type: "category", data: ["A", "B", "C"] },
        yAxis: { type: "value" },
        series: [{ type: "bar", data: [5, 20, 36] }]
      }
    };
    addElement(el);
  };

  return (
    <>
      <div className="group">
        <div className="row">
          <button className="pill" onClick={onInsertImage}>Imagen</button>
          <button className="pill" onClick={() => alert("Video (stub)")}>Video</button>
          <button className="pill" onClick={() => alert("Iconos (stub)")}>Iconos</button>
        </div>
        <div className="groupTitle">Medios</div>
      </div>

      <div className="group">
        <div className="row">
          <button className="pill" onClick={onInsertRect}>Rect</button>
          <button className="pill" onClick={onInsertEllipse}>Elipse</button>
        </div>
        <div className="groupTitle">Formas</div>
      </div>

      <div className="group">
        <div className="row">
          <button className="pill" onClick={onInsertChartStub}>Gráfico</button>
          <button className="pill" onClick={() => alert("Tabla (stub)")}>Tabla</button>
        </div>
        <div className="groupTitle">Datos</div>
      </div>
    </>
  );
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
```

---

## C17) Layout tab — `apps/web/src/ribbon/tabs/LayoutTab.tsx`

```tsx
import React from "react";

export function LayoutTab() {
  return (
    <>
      <div className="group">
        <div className="row">
          <button className="pill" onClick={() => alert("Master slides (stub)")}>Master Slides</button>
          <button className="pill" onClick={() => alert("Templates (stub)")}>Templates</button>
        </div>
        <div className="groupTitle">Maestros</div>
      </div>

      <div className="group">
        <div className="row">
          <button className="pill" onClick={() => alert("Grid presets (stub)")}>Grids</button>
          <button className="pill" onClick={() => alert("Guides presets (stub)")}>Guías</button>
        </div>
        <div className="groupTitle">Rejillas</div>
      </div>
    </>
  );
}
```

---

## C18) References tab — `apps/web/src/ribbon/tabs/ReferencesTab.tsx`

```tsx
import React from "react";

export function ReferencesTab() {
  return (
    <>
      <div className="group">
        <div className="row">
          <button className="pill" onClick={() => alert("Footnotes (stub)")}>Notas al pie</button>
          <button className="pill" onClick={() => alert("Bibliography (stub)")}>Bibliografía</button>
        </div>
        <div className="groupTitle">Citas</div>
      </div>

      <div className="group">
        <div className="row">
          <button className="pill" onClick={() => alert("TOC auto (stub)")}>Tabla de contenidos</button>
        </div>
        <div className="groupTitle">Índice</div>
      </div>
    </>
  );
}
```

---

## C19) Review tab — `apps/web/src/ribbon/tabs/ReviewTab.tsx`

```tsx
import React from "react";

export function ReviewTab() {
  return (
    <>
      <div className="group">
        <div className="row">
          <button className="pill" onClick={() => alert("Comentarios (stub)")}>Comentarios</button>
          <button className="pill" onClick={() => alert("Historial (stub)")}>Historial</button>
        </div>
        <div className="groupTitle">Revisión</div>
      </div>

      <div className="group">
        <div className="row">
          <button className="pill" onClick={() => alert("Modo presentador (stub)")}>Modo presentador</button>
        </div>
        <div className="groupTitle">Presentación</div>
      </div>
    </>
  );
}
```

---

## C20) View tab — `apps/web/src/ribbon/tabs/ViewTab.tsx`

```tsx
import React from "react";
import { useDeckStore } from "../../store/deckStore";

export function ViewTab() {
  // TODO: conectar con estado de zoom / grid / ruler
  return (
    <>
      <div className="group">
        <div className="row">
          <button className="pill" onClick={() => window.dispatchEvent(new CustomEvent("view-zoom", { detail: 1 }))}>Zoom 100%</button>
          <button className="pill" onClick={() => window.dispatchEvent(new CustomEvent("view-zoom", { detail: 1.25 }))}>Zoom 125%</button>
          <button className="pill" onClick={() => window.dispatchEvent(new CustomEvent("view-zoom", { detail: 0.8 }))}>Zoom 80%</button>
        </div>
        <div className="groupTitle">Zoom</div>
      </div>

      <div className="group">
        <div className="row">
          <button className="pill" onClick={() => window.dispatchEvent(new CustomEvent("view-grid-toggle"))}>Grid</button>
          <button className="pill" onClick={() => window.dispatchEvent(new CustomEvent("view-ruler-toggle"))}>Regla</button>
        </div>
        <div className="groupTitle">Guías</div>
      </div>

      <div className="group">
        <div className="row">
          <button className="pill" onClick={() => alert("Slide sorter (stub)")}>Clasificador</button>
          <button className="pill" onClick={() => alert("Outline view (stub)")}>Esquema</button>
        </div>
        <div className="groupTitle">Vistas</div>
      </div>
    </>
  );
}
```

---

## C21) AI tab — `apps/web/src/ribbon/tabs/AITab.tsx`

Incluye acciones:
- generar slide
- mejorar contenido
- generar imagen
- crear gráfico
- sugerir diseño
- toggle AI/manual

```tsx
import React from "react";
import { useDeckStore } from "../../store/deckStore";

export function AITab() {
  const mode = useDeckStore((s) => s.editorMode);
  const setMode = useDeckStore((s) => s.setEditorMode);

  const sendCommand = (cmd: string) => {
    window.dispatchEvent(new CustomEvent("ai-command", { detail: cmd }));
  };

  return (
    <>
      <div className="group">
        <div className="row">
          <button className="pill" onClick={() => sendCommand("Genera una diapositiva completa con título y 3 bullets sobre el tema actual.")}>
            Generar slide
          </button>
          <button className="pill" onClick={() => sendCommand("Mejora el texto actual: claridad, concisión y tono ejecutivo.")}>
            Mejorar contenido
          </button>
        </div>
        <div className="groupTitle">Contenido</div>
      </div>

      <div className="group">
        <div className="row">
          <button className="pill" onClick={() => sendCommand("/img Genera una imagen hero relacionada con el tema de la diapositiva.")}>
            Generar imagen
          </button>
          <button className="pill" onClick={() => sendCommand("/chart Crea un gráfico con los datos mencionados o sugiere un dataset razonable.")}>
            Crear gráfico
          </button>
        </div>
        <div className="groupTitle">Visuales</div>
      </div>

      <div className="group">
        <div className="row">
          <button className="pill" onClick={() => sendCommand("Sugiere un diseño: layout, jerarquía tipográfica y paleta.")}>
            Sugerir diseño
          </button>
        </div>
        <div className="groupTitle">Diseño</div>
      </div>

      <div className="group">
        <div className="row">
          <button className={"toggleBtn " + (mode === "ai" ? "active" : "")} onClick={() => setMode(mode === "ai" ? "manual" : "ai")}>
            Modo IA: {mode === "ai" ? "ON" : "OFF"}
          </button>
        </div>
        <div className="groupTitle">Modo</div>
      </div>
    </>
  );
}
```

---

# PARTE D — EDITOR (Canvas + Panels + RichText)

## D1) Editor shell — `apps/web/src/editor/EditorShell.tsx`

```tsx
import React from "react";
import { SlidesPanel } from "./panels/SlidesPanel";
import { LayersPanel } from "./panels/LayersPanel";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { CanvasStage } from "./CanvasStage";

export function EditorShell() {
  return (
    <div className="editorArea">
      <div className="panel">
        <div className="panelHeader">Diapositivas</div>
        <div className="panelBody">
          <SlidesPanel />
        </div>
      </div>

      <div className="canvasWrap">
        <CanvasStage />
      </div>

      <div className="panel">
        <div className="panelHeader">Capas & Propiedades</div>
        <div className="panelBody" style={{ display: "grid", gap: 12 }}>
          <PropertiesPanel />
          <div style={{ height: 1, background: "rgba(0,0,0,0.08)" }} />
          <LayersPanel />
        </div>
      </div>
    </div>
  );
}
```

---

## D2) Slides panel — `apps/web/src/editor/panels/SlidesPanel.tsx`

```tsx
import React from "react";
import { useDeckStore } from "../../store/deckStore";

export function SlidesPanel() {
  const deck = useDeckStore((s) => s.history.present);
  const activeSlideId = useDeckStore((s) => s.activeSlideId);
  const setActiveSlide = useDeckStore((s) => s.setActiveSlide);
  const addSlide = useDeckStore((s) => s.addSlide);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <button className="pill" onClick={addSlide}>+ Nueva diapositiva</button>

      {deck.slides.map((s, idx) => (
        <div
          key={s.id}
          onClick={() => setActiveSlide(s.id)}
          style={{
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: 10,
            cursor: "pointer",
            background: activeSlideId === s.id ? "rgba(37,99,235,0.06)" : "#fff"
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 12, marginBottom: 6 }}>
            {idx + 1}. Slide
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {s.elements.length} elementos
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## D3) Layers panel — `apps/web/src/editor/panels/LayersPanel.tsx`

```tsx
import React from "react";
import { useDeckStore } from "../../store/deckStore";

export function LayersPanel() {
  const slide = useDeckStore((s) => s.getActiveSlide());
  const selection = useDeckStore((s) => s.selection);
  const select = useDeckStore((s) => s.select);
  const bringToFront = useDeckStore((s) => s.bringToFront);
  const sendToBack = useDeckStore((s) => s.sendToBack);
  const del = useDeckStore((s) => s.deleteElement);

  const els = [...slide.elements].sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 800 }}>Capas</div>

      {els.map((e) => {
        const active = selection?.elementId === e.id;
        return (
          <div
            key={e.id}
            onClick={() => select({ slideId: slide.id, elementId: e.id })}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              cursor: "pointer",
              background: active ? "rgba(37,99,235,0.06)" : "#fff"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 12 }}>{e.type.toUpperCase()}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>z={e.zIndex ?? 0}</div>
            </div>

            {active && (
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button className="pill" onClick={(ev) => { ev.stopPropagation(); bringToFront(e.id); }}>Frente</button>
                <button className="pill" onClick={(ev) => { ev.stopPropagation(); sendToBack(e.id); }}>Fondo</button>
                <button className="pill" onClick={(ev) => { ev.stopPropagation(); del(e.id); }}>Eliminar</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

---

## D4) Properties panel — `apps/web/src/editor/panels/PropertiesPanel.tsx`

```tsx
import React from "react";
import { useDeckStore } from "../../store/deckStore";

export function PropertiesPanel() {
  const el = useDeckStore((s) => s.getSelectedElement());
  const update = useDeckStore((s) => s.updateElement);

  if (!el) {
    return <div style={{ color: "var(--muted)" }}>Selecciona un elemento para editar propiedades.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 800 }}>Propiedades</div>

      <Row label="X">
        <input className="input" type="number" value={el.x} onChange={(e) => update(el.id, { x: Number(e.target.value) } as any)} />
      </Row>
      <Row label="Y">
        <input className="input" type="number" value={el.y} onChange={(e) => update(el.id, { y: Number(e.target.value) } as any)} />
      </Row>
      <Row label="W">
        <input className="input" type="number" value={el.w} onChange={(e) => update(el.id, { w: Number(e.target.value) } as any)} />
      </Row>
      <Row label="H">
        <input className="input" type="number" value={el.h} onChange={(e) => update(el.id, { h: Number(e.target.value) } as any)} />
      </Row>

      {el.type === "shape" && (
        <>
          <Row label="Fill">
            <input type="color" value={el.fill} onChange={(e) => update(el.id, { fill: e.target.value } as any)} />
          </Row>
          <Row label="Stroke">
            <input type="color" value={el.stroke} onChange={(e) => update(el.id, { stroke: e.target.value } as any)} />
          </Row>
        </>
      )}

      {el.type === "text" && (
        <>
          <Row label="Font">
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{el.defaultTextStyle.fontFamily}</div>
          </Row>
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 10, alignItems: "center" }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}
```

---

## D5) Canvas stage — `apps/web/src/editor/CanvasStage.tsx`

Incluye:
- Stage Konva con zoom
- Sync store <-> canvas
- Selection + Transformer
- Snap-to-grid + guides
- RichText overlay cuando editas texto (doble click)
- Cursor animado durante streaming

```tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Rect, Transformer, Line } from "react-konva";
import Konva from "konva";
import { useDeckStore } from "../store/deckStore";
import type { ElementAny, TextElement } from "../store/types";
import { TextNode } from "./elements/TextNode";
import { ShapeNode } from "./elements/ShapeNode";
import { ImageNode } from "./elements/ImageNode";
import { ChartNode } from "./elements/ChartNode";
import { RichTextOverlay } from "./overlays/RichTextOverlay";
import { computeGuides, type GuideLine } from "./guides/guides";
import { snapToGrid } from "./guides/snap";
import { useTypingStream } from "../ai/typingStream";

export function CanvasStage() {
  const slide = useDeckStore((s) => s.getActiveSlide());
  const selection = useDeckStore((s) => s.selection);
  const select = useDeckStore((s) => s.select);
  const updateElement = useDeckStore((s) => s.updateElement);
  const streaming = useDeckStore((s) => s.streaming.active);

  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);

  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);

  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [overlayRect, setOverlayRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const [guides, setGuides] = useState<GuideLine[]>([]);

  // Streaming typing hook: inserta tokens en el elemento seleccionado (si text)
  useTypingStream();

  const selectedElement = selection ? slide.elements.find((e) => e.id === selection.elementId) ?? null : null;

  // Attach transformer to selected node
  useEffect(() => {
    const stage = stageRef.current;
    const tr = trRef.current;
    if (!stage || !tr) return;

    if (!selectedElement) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }

    const node = stage.findOne(`#el-${selectedElement.id}`);
    if (node) {
      tr.nodes([node]);
      tr.getLayer()?.batchDraw();
    }
  }, [selectedElement?.id, slide.elements.length]);

  // View events: zoom/grid toggle
  useEffect(() => {
    const onZoom = (e: any) => setZoom(Number(e.detail ?? 1));
    const onGrid = () => setShowGrid((v) => !v);
    window.addEventListener("view-zoom", onZoom as any);
    window.addEventListener("view-grid-toggle", onGrid as any);
    return () => {
      window.removeEventListener("view-zoom", onZoom as any);
      window.removeEventListener("view-grid-toggle", onGrid as any);
    };
  }, []);

  const onStageMouseDown = (e: any) => {
    // click en vacío -> deseleccionar
    if (e.target === e.target.getStage()) {
      select(null);
      return;
    }
  };

  const onSelectElement = (el: ElementAny) => {
    select({ slideId: slide.id, elementId: el.id });
  };

  const onDragMove = (el: ElementAny, ev: any) => {
    const node = ev.target as Konva.Node;
    const pos = node.position();

    const snapped = snapToGrid(pos, 8);
    node.position(snapped);

    // Guides (alineación con otros)
    const stage = stageRef.current;
    if (!stage) return;
    const gs = computeGuides({
      movingBox: node.getClientRect(),
      elements: slide.elements.filter((x) => x.id !== el.id),
      zoom
    });
    setGuides(gs);
  };

  const onDragEnd = (el: ElementAny, ev: any) => {
    const node = ev.target as Konva.Node;
    setGuides([]);
    updateElement(el.id, { x: node.x(), y: node.y() } as any);
  };

  const onTransformEnd = (el: ElementAny, ev: any) => {
    const node = ev.target as Konva.Node;

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    node.scaleX(1);
    node.scaleY(1);

    updateElement(el.id, {
      x: node.x(),
      y: node.y(),
      w: Math.max(10, node.width() * scaleX),
      h: Math.max(10, node.height() * scaleY),
      rotation: node.rotation()
    } as any);
  };

  const startEditingText = (el: TextElement) => {
    const stage = stageRef.current;
    if (!stage) return;
    const node = stage.findOne(`#el-${el.id}`);
    if (!node) return;

    const rect = node.getClientRect();
    const container = stage.container().getBoundingClientRect();

    setOverlayRect({
      left: container.left + rect.x,
      top: container.top + rect.y,
      width: rect.width,
      height: rect.height
    });

    setEditingTextId(el.id);
  };

  const stopEditingText = () => {
    setEditingTextId(null);
    setOverlayRect(null);
  };

  // Grid lines (visual)
  const gridLines = useMemo(() => {
    if (!showGrid) return null;
    const lines: React.ReactNode[] = [];
    const step = 40;
    for (let x = 0; x <= slide.size.w; x += step) {
      lines.push(<Line key={"gx" + x} points={[x, 0, x, slide.size.h]} stroke="rgba(0,0,0,0.05)" />);
    }
    for (let y = 0; y <= slide.size.h; y += step) {
      lines.push(<Line key={"gy" + y} points={[0, y, slide.size.w, y]} stroke="rgba(0,0,0,0.05)" />);
    }
    return lines;
  }, [showGrid, slide.size.w, slide.size.h]);

  // Cursor “typing” (simple): se dibuja cerca del elemento seleccionado si streaming
  const typingCursor = useMemo(() => {
    if (!streaming || !selectedElement || selectedElement.type !== "text") return null;
    const x = selectedElement.x + Math.min(selectedElement.w - 6, 14);
    const y = selectedElement.y + 14;
    return <Rect x={x} y={y} width={2} height={24} fill={"rgba(0,0,0,0.75)"} opacity={0.9} />;
  }, [streaming, selectedElement?.id]);

  const sorted = useMemo(() => [...slide.elements].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)), [slide.elements]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div className="canvasControls">
        <div className="pill">Zoom {Math.round(zoom * 100)}%</div>
        <button className="pill" onClick={() => setZoom(1)}>Reset</button>
      </div>

      <Stage
        ref={stageRef}
        width={slide.size.w * zoom}
        height={slide.size.h * zoom}
        scaleX={zoom}
        scaleY={zoom}
        onMouseDown={onStageMouseDown}
        style={{ background: "#fff" }}
      >
        <Layer>
          {/* Fondo */}
          <Rect x={0} y={0} width={slide.size.w} height={slide.size.h} fill={slide.background.color} />
          {gridLines}
        </Layer>

        <Layer>
          {sorted.map((el) => {
            const common = {
              key: el.id,
              id: `el-${el.id}`,
              el,
              isSelected: selection?.elementId === el.id,
              onSelect: () => onSelectElement(el),
              onDragMove: (ev: any) => onDragMove(el, ev),
              onDragEnd: (ev: any) => onDragEnd(el, ev),
              onTransformEnd: (ev: any) => onTransformEnd(el, ev)
            };

            if (el.type === "text") {
              return (
                <TextNode
                  {...common}
                  onDblClick={() => startEditingText(el)}
                />
              );
            }
            if (el.type === "shape") return <ShapeNode {...common} />;
            if (el.type === "image") return <ImageNode {...common} />;
            if (el.type === "chart") return <ChartNode {...common} />;
            return null;
          })}

          {typingCursor}

          <Transformer
            ref={trRef}
            rotateEnabled
            enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
            boundBoxFunc={(oldBox, newBox) => {
              // evita tamaños negativos o muy pequeños
              if (newBox.width < 10 || newBox.height < 10) return oldBox;
              return newBox;
            }}
          />
        </Layer>

        {/* Guides */}
        <Layer>
          {guides.map((g, i) => (
            <Line
              key={i}
              points={g.points}
              stroke={"rgba(37,99,235,0.55)"}
              strokeWidth={1}
              dash={[6, 4]}
            />
          ))}
        </Layer>
      </Stage>

      {/* Overlay editor para texto (Quill) */}
      {editingTextId && overlayRect && (
        <RichTextOverlay
          elementId={editingTextId}
          rect={overlayRect}
          onClose={stopEditingText}
        />
      )}
    </div>
  );
}
```

---

## D6) Guides — `apps/web/src/editor/guides/snap.ts`

```ts
export function snapToGrid(pos: { x: number; y: number }, gridSize: number) {
  return {
    x: Math.round(pos.x / gridSize) * gridSize,
    y: Math.round(pos.y / gridSize) * gridSize
  };
}
```

---

## D7) Guides — `apps/web/src/editor/guides/guides.ts`

```ts
import type { ElementAny } from "../../store/types";

export type GuideLine = { points: number[] };

// Simplificado: crea guías si el movingBox está cerca de bordes/centros de otros elementos.
// En PROD: ampliar a muchos cases + performance (spatial index).
export function computeGuides(args: {
  movingBox: { x: number; y: number; width: number; height: number };
  elements: ElementAny[];
  zoom: number;
}): GuideLine[] {
  const snapDist = 6;
  const lines: GuideLine[] = [];

  const mb = args.movingBox;
  const mLeft = mb.x;
  const mRight = mb.x + mb.width;
  const mTop = mb.y;
  const mBottom = mb.y + mb.height;
  const mCx = mb.x + mb.width / 2;
  const mCy = mb.y + mb.height / 2;

  for (const el of args.elements) {
    const left = el.x;
    const right = el.x + el.w;
    const top = el.y;
    const bottom = el.y + el.h;
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;

    if (Math.abs(mCx - cx) < snapDist) {
      lines.push({ points: [cx, 0, cx, 720] });
    }
    if (Math.abs(mCy - cy) < snapDist) {
      lines.push({ points: [0, cy, 1280, cy] });
    }
    if (Math.abs(mLeft - left) < snapDist) {
      lines.push({ points: [left, 0, left, 720] });
    }
    if (Math.abs(mRight - right) < snapDist) {
      lines.push({ points: [right, 0, right, 720] });
    }
    if (Math.abs(mTop - top) < snapDist) {
      lines.push({ points: [0, top, 1280, top] });
    }
    if (Math.abs(mBottom - bottom) < snapDist) {
      lines.push({ points: [0, bottom, 1280, bottom] });
    }
  }

  return dedupe(lines);
}

function dedupe(lines: GuideLine[]): GuideLine[] {
  const set = new Set<string>();
  const out: GuideLine[] = [];
  for (const l of lines) {
    const k = l.points.join(",");
    if (set.has(k)) continue;
    set.add(k);
    out.push(l);
  }
  return out.slice(0, 10);
}
```

---

## D8) Element: Text — `apps/web/src/editor/elements/TextNode.tsx`

```tsx
import React, { useMemo } from "react";
import { Text, Rect, Group } from "react-konva";
import type { TextElement } from "../../store/types";

export function TextNode(props: {
  id: string;
  el: TextElement;
  isSelected: boolean;
  onSelect: () => void;
  onDragMove: (ev: any) => void;
  onDragEnd: (ev: any) => void;
  onTransformEnd: (ev: any) => void;
  onDblClick: () => void;
}) {
  const { el, isSelected } = props;

  const plainText = useMemo(() => deltaToPlain(el.delta), [el.delta]);

  return (
    <Group
      id={props.id}
      x={el.x}
      y={el.y}
      draggable={!el.locked}
      rotation={el.rotation ?? 0}
      onClick={props.onSelect}
      onTap={props.onSelect}
      onDblClick={props.onDblClick}
      onDragMove={props.onDragMove}
      onDragEnd={props.onDragEnd}
      onTransformEnd={props.onTransformEnd}
    >
      {/* hitbox */}
      <Rect width={el.w} height={el.h} fill="rgba(0,0,0,0.001)" />

      <Text
        text={plainText}
        width={el.w}
        height={el.h}
        fontFamily={el.defaultTextStyle.fontFamily}
        fontSize={el.defaultTextStyle.fontSize}
        fill={el.defaultTextStyle.color}
        fontStyle={styleToFontStyle(el.defaultTextStyle)}
        textDecoration={styleToDecoration(el.defaultTextStyle)}
      />

      {isSelected && (
        <Rect
          width={el.w}
          height={el.h}
          stroke="rgba(37,99,235,0.8)"
          strokeWidth={1}
          dash={[6, 4]}
        />
      )}
    </Group>
  );
}

function deltaToPlain(delta: any): string {
  let out = "";
  for (const op of delta?.ops ?? []) {
    if (typeof op.insert === "string") out += op.insert;
  }
  return out;
}

function styleToFontStyle(s: any): string {
  const b = s.bold ? "bold" : "normal";
  const i = s.italic ? "italic" : "normal";
  // Konva usa string: "bold italic" etc.
  if (b === "bold" && i === "italic") return "bold italic";
  if (b === "bold") return "bold";
  if (i === "italic") return "italic";
  return "normal";
}

function styleToDecoration(s: any): string {
  const u = s.underline ? "underline" : "";
  const st = s.strike ? "line-through" : "";
  return [u, st].filter(Boolean).join(" ");
}
```

---

## D9) Element: Shape — `apps/web/src/editor/elements/ShapeNode.tsx`

```tsx
import React from "react";
import { Rect, Ellipse } from "react-konva";
import type { ShapeElement } from "../../store/types";

export function ShapeNode(props: {
  id: string;
  el: ShapeElement;
  isSelected: boolean;
  onSelect: () => void;
  onDragMove: (ev: any) => void;
  onDragEnd: (ev: any) => void;
  onTransformEnd: (ev: any) => void;
}) {
  const { el, isSelected } = props;

  const common = {
    id: props.id,
    x: el.x,
    y: el.y,
    width: el.w,
    height: el.h,
    draggable: !el.locked,
    rotation: el.rotation ?? 0,
    onClick: props.onSelect,
    onTap: props.onSelect,
    onDragMove: props.onDragMove,
    onDragEnd: props.onDragEnd,
    onTransformEnd: props.onTransformEnd,
    stroke: isSelected ? "rgba(37,99,235,0.8)" : el.stroke,
    strokeWidth: el.strokeWidth,
    fill: el.fill
  };

  if (el.shapeType === "ellipse") {
    return (
      <Ellipse
        {...common as any}
        radiusX={el.w / 2}
        radiusY={el.h / 2}
      />
    );
  }

  return <Rect {...common as any} cornerRadius={el.radius ?? 10} />;
}
```

---

## D10) Element: Image — `apps/web/src/editor/elements/ImageNode.tsx`

```tsx
import React, { useEffect, useState } from "react";
import { Image as KImage, Rect, Group } from "react-konva";
import type { ImageElement } from "../../store/types";

// Nota: react-konva recomienda use-image; pero aquí usamos un hook minimal.
// Si no quieres deps extra, implementa tu loader. Para simplicidad aquí lo incluimos inline.
function useImageLocal(src: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImage(img);
    img.src = src;
    return () => setImage(null);
  }, [src]);
  return image;
}

export function ImageNode(props: {
  id: string;
  el: ImageElement;
  isSelected: boolean;
  onSelect: () => void;
  onDragMove: (ev: any) => void;
  onDragEnd: (ev: any) => void;
  onTransformEnd: (ev: any) => void;
}) {
  const { el, isSelected } = props;
  const img = useImageLocal(el.src);

  return (
    <Group
      id={props.id}
      x={el.x}
      y={el.y}
      draggable={!el.locked}
      rotation={el.rotation ?? 0}
      onClick={props.onSelect}
      onTap={props.onSelect}
      onDragMove={props.onDragMove}
      onDragEnd={props.onDragEnd}
      onTransformEnd={props.onTransformEnd}
    >
      <Rect width={el.w} height={el.h} fill="rgba(0,0,0,0.02)" />
      {img && <KImage image={img} width={el.w} height={el.h} />}
      {isSelected && <Rect width={el.w} height={el.h} stroke="rgba(37,99,235,0.8)" dash={[6,4]} />}
    </Group>
  );
}
```

> Si tu build falla por `use-image`, elimina el import.

---

## D11) Element: Chart — `apps/web/src/editor/elements/ChartNode.tsx`

Renderiza un chart con ECharts -> SVG y lo inserta como imagen en Konva.

```tsx
import React, { useEffect, useState } from "react";
import { Group, Rect, Image as KImage } from "react-konva";
import type { ChartElement } from "../../store/types";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { TitleComponent, TooltipComponent, GridComponent, LegendComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

echarts.use([BarChart, LineChart, PieChart, TitleComponent, TooltipComponent, GridComponent, LegendComponent, SVGRenderer]);

function svgToDataUri(svg: string) {
  return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
}

function useImageLocal(src: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImage(img);
    img.src = src;
    return () => setImage(null);
  }, [src]);
  return image;
}

export function ChartNode(props: {
  id: string;
  el: ChartElement;
  isSelected: boolean;
  onSelect: () => void;
  onDragMove: (ev: any) => void;
  onDragEnd: (ev: any) => void;
  onTransformEnd: (ev: any) => void;
}) {
  const { el, isSelected } = props;
  const [uri, setUri] = useState<string>("");

  useEffect(() => {
    // render fuera de pantalla a SVG
    const div = document.createElement("div");
    div.style.width = el.w + "px";
    div.style.height = el.h + "px";
    div.style.position = "absolute";
    div.style.left = "-99999px";
    div.style.top = "-99999px";
    document.body.appendChild(div);

    const chart = echarts.init(div, undefined, { renderer: "svg" });
    chart.setOption(el.spec ?? {}, true);

    // ECharts SVG export
    const svg = chart.renderToSVGString();

    setUri(svgToDataUri(svg));

    chart.dispose();
    document.body.removeChild(div);
  }, [JSON.stringify(el.spec), el.w, el.h]);

  const img = useImageLocal(uri);

  return (
    <Group
      id={props.id}
      x={el.x}
      y={el.y}
      draggable={!el.locked}
      rotation={el.rotation ?? 0}
      onClick={props.onSelect}
      onTap={props.onSelect}
      onDragMove={props.onDragMove}
      onDragEnd={props.onDragEnd}
      onTransformEnd={props.onTransformEnd}
    >
      <Rect width={el.w} height={el.h} fill="rgba(0,0,0,0.02)" />
      {img && <KImage image={img} width={el.w} height={el.h} />}
      {isSelected && <Rect width={el.w} height={el.h} stroke="rgba(37,99,235,0.8)" dash={[6,4]} />}
    </Group>
  );
}
```

---

## D12) Overlay de edición rich text (Quill) — `apps/web/src/editor/overlays/RichTextOverlay.tsx`

- Se posiciona sobre el elemento de texto seleccionado (bounding rect del canvas)
- Mantiene Delta en el store
- Escucha comandos del ribbon (`quill-command`) para aplicar formatos a rango seleccionado
- Al cerrar, sincroniza a store y el canvas muestra texto plano (por ahora)

```tsx
import React, { useEffect, useMemo, useRef } from "react";
import Quill from "quill";
import "quill/dist/quill.snow.css";
import { useDeckStore } from "../../store/deckStore";
import type { Delta } from "../../store/types";

export function RichTextOverlay(props: {
  elementId: string;
  rect: { left: number; top: number; width: number; height: number };
  onClose: () => void;
}) {
  const el = useDeckStore((s) => s.getSelectedElement());
  const updateDelta = useDeckStore((s) => s.updateTextDelta);

  const rootRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);

  useEffect(() => {
    if (!rootRef.current) return;
    if (!el || el.type !== "text") return;

    const q = new Quill(rootRef.current, {
      theme: "snow",
      modules: {
        toolbar: false
      }
    });

    quillRef.current = q;

    // Inicializar con Delta
    q.setContents(el.delta as any);

    // Sync on changes (throttle simple)
    const onTextChange = () => {
      const delta = q.getContents() as any;
      updateDelta(props.elementId, delta);
    };

    q.on("text-change", onTextChange);

    // Comandos desde ribbon
    const onCmd = (ev: any) => {
      const cmd = ev.detail;
      if (!cmd || !quillRef.current) return;
      const quill = quillRef.current;

      if (cmd.type === "format") {
        const { key, value } = cmd.payload ?? {};
        const range = quill.getSelection(true);
        if (!range) return;
        quill.format(key, value);
        return;
      }

      if (cmd.type === "list") {
        const range = quill.getSelection(true);
        if (!range) return;
        quill.format("list", cmd.payload); // 'bullet' | 'ordered'
        return;
      }

      if (cmd.type === "align") {
        const range = quill.getSelection(true);
        if (!range) return;
        quill.format("align", cmd.payload);
        return;
      }
    };

    window.addEventListener("quill-command", onCmd as any);

    // ESC para cerrar
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);

    // Focus
    setTimeout(() => q.focus(), 0);

    return () => {
      window.removeEventListener("quill-command", onCmd as any);
      window.removeEventListener("keydown", onKey);
      q.off("text-change", onTextChange);
      q.disable();
      quillRef.current = null;
    };
  }, [props.elementId]);

  return (
    <div
      className="konvaOverlayEditor"
      style={{
        left: props.rect.left,
        top: props.rect.top,
        width: props.rect.width,
        height: props.rect.height
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", padding: 8, borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
        <div style={{ fontWeight: 800, fontSize: 12 }}>Editar texto</div>
        <button className="pill" onClick={props.onClose}>Listo</button>
      </div>
      <div ref={rootRef} style={{ height: `calc(100% - 44px)` }} />
    </div>
  );
}
```

---

## D13) Modal de hyperlink — `apps/web/src/editor/overlays/HyperlinkModal.tsx`

```tsx
import React, { useState } from "react";

function emitQuillCommand(cmd: { type: string; payload?: any }) {
  window.dispatchEvent(new CustomEvent("quill-command", { detail: cmd }));
}

export function HyperlinkModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("https://");

  const apply = () => {
    emitQuillCommand({ type: "format", payload: { key: "link", value: url } });
    onClose();
  };

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">Insertar enlace</div>
        <div className="modalBody">
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Aplica al texto seleccionado en el editor de texto.
          </div>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="modalFooter">
          <button className="pill" onClick={onClose}>Cancelar</button>
          <button className="pill primary" onClick={apply}>Aplicar</button>
        </div>
      </div>
    </div>
  );
}
```

---

# PARTE E — CHAT + STREAMING TYPING

## E1) Commands parser — `apps/web/src/chat/commands.ts`

Soporta:
- `/img ...` → image_generate
- `/chart ...` → chart_parse
- texto normal → chat_start

```ts
export type ParsedCommand =
  | { kind: "image"; prompt: string }
  | { kind: "chart"; prompt: string }
  | { kind: "chat"; prompt: string };

export function parseCommand(input: string): ParsedCommand {
  const t = input.trim();
  if (t.startsWith("/img ")) return { kind: "image", prompt: t.slice(5).trim() };
  if (t.startsWith("/chart ")) return { kind: "chart", prompt: t.slice(7).trim() };
  return { kind: "chat", prompt: t };
}
```

---

## E2) Chat panel — `apps/web/src/chat/ChatPanel.tsx`

- conecta WS
- renderiza mensajes
- envía comandos
- cuando llegan tokens: los agrega a la cola (typingStream) para insertarlos en el slide

```tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { EditorWS } from "../api/wsClient";
import { parseCommand } from "./commands";
import { useDeckStore } from "../store/deckStore";
import { enqueueLLMToken, resetTypingTarget } from "../ai/typingStream";
import type { ChartElement, ImageElement, TextElement } from "../store/types";

type ChatMsg = { id: string; role: "user" | "assistant" | "system"; text: string };

export function ChatPanel() {
  const deck = useDeckStore((s) => s.history.present);
  const slide = useDeckStore((s) => s.getActiveSlide());
  const selection = useDeckStore((s) => s.selection);
  const addElement = useDeckStore((s) => s.addElement);
  const setStreaming = useDeckStore((s) => s.setStreaming);

  const [msgs, setMsgs] = useState<ChatMsg[]>([
    {
      id: nanoid(),
      role: "system",
      text: "Tip: usa /img para generar imágenes o /chart para crear gráficos."
    }
  ]);

  const [input, setInput] = useState("");

  const wsRef = useRef<EditorWS | null>(null);
  const assistantMsgIdRef = useRef<string | null>(null);
  const requestIdRef = useRef<string | null>(null);

  useEffect(() => {
    const ws = new EditorWS({
      onMessage: (msg) => {
        if (msg.type === "llm_token") {
          // actualizar chat UI
          if (!assistantMsgIdRef.current) return;
          setMsgs((prev) =>
            prev.map((m) => (m.id === assistantMsgIdRef.current ? { ...m, text: m.text + msg.token } : m))
          );

          // streaming to slide
          enqueueLLMToken(msg.token);
          return;
        }

        if (msg.type === "llm_done") {
          setStreaming(false);
          requestIdRef.current = null;
          assistantMsgIdRef.current = null;
          return;
        }

        if (msg.type === "llm_error") {
          setStreaming(false);
          setMsgs((prev) => [...prev, { id: nanoid(), role: "system", text: `Error: ${msg.message}` }]);
          requestIdRef.current = null;
          assistantMsgIdRef.current = null;
          return;
        }

        if (msg.type === "image_result") {
          setStreaming(false);

          const el: ImageElement = {
            id: nanoid(),
            type: "image",
            x: 680,
            y: 150,
            w: 520,
            h: 320,
            zIndex: 50,
            src: msg.imageUrl
          };
          addElement(el);

          setMsgs((prev) => [...prev, { id: nanoid(), role: "assistant", text: "Imagen insertada en el slide." }]);
          return;
        }

        if (msg.type === "chart_result") {
          setStreaming(false);

          const el: ChartElement = {
            id: nanoid(),
            type: "chart",
            x: 680,
            y: 500,
            w: 520,
            h: 200,
            zIndex: 60,
            spec: msg.spec
          };
          addElement(el);

          setMsgs((prev) => [...prev, { id: nanoid(), role: "assistant", text: "Gráfico insertado en el slide." }]);
          return;
        }
      }
    });

    ws.connect();
    wsRef.current = ws;

    // Recibe comandos desde tab IA
    const onAiCmd = (ev: any) => {
      const text = String(ev.detail ?? "");
      if (!text) return;
      setInput(text);
      setTimeout(() => send(text), 0);
    };
    window.addEventListener("ai-command", onAiCmd as any);

    return () => {
      window.removeEventListener("ai-command", onAiCmd as any);
      ws.close();
      wsRef.current = null;
    };
  }, []);

  const send = (text?: string) => {
    const t = (text ?? input).trim();
    if (!t) return;

    const cmd = parseCommand(t);

    setMsgs((prev) => [...prev, { id: nanoid(), role: "user", text: t }]);
    setInput("");

    const requestId = nanoid();
    requestIdRef.current = requestId;

    // Reset target: elemento activo del canvas (si no hay, crea uno)
    ensureTextTarget();

    setStreaming(true, requestId);

    if (cmd.kind === "image") {
      wsRef.current?.send({
        type: "image_generate",
        requestId,
        prompt: cmd.prompt,
        size: "1024"
      });
      return;
    }

    if (cmd.kind === "chart") {
      wsRef.current?.send({
        type: "chart_parse",
        requestId,
        prompt: cmd.prompt
      });
      return;
    }

    // Chat normal (stream tokens)
    const assistantMsgId = nanoid();
    assistantMsgIdRef.current = assistantMsgId;
    setMsgs((prev) => [...prev, { id: assistantMsgId, role: "assistant", text: "" }]);

    wsRef.current?.send({
      type: "chat_start",
      requestId,
      prompt: cmd.prompt,
      context: {
        deckTitle: deck.title,
        activeSlide: slide,
        selection
      },
      mode: "slide_write"
    });
  };

  const ensureTextTarget = () => {
    // Si hay selección y es texto, apuntamos a ese.
    // Si no, creamos un textbox y lo seleccionamos.
    const store = useDeckStore.getState();
    const selected = store.getSelectedElement();

    if (selected && selected.type === "text") {
      resetTypingTarget({ slideId: slide.id, elementId: selected.id });
      return;
    }

    const el: TextElement = {
      id: nanoid(),
      type: "text",
      x: 80,
      y: 260,
      w: 560,
      h: 340,
      zIndex: 40,
      delta: { ops: [{ insert: "" }] },
      defaultTextStyle: {
        fontFamily: "Inter",
        fontSize: 22,
        color: "#111111"
      }
    };

    store.addElement(el);
    resetTypingTarget({ slideId: slide.id, elementId: el.id });
  };

  return (
    <>
      <div className="chatMessages">
        {msgs.map((m) => (
          <div key={m.id} className="chatMsg">
            <div className="chatMsgRole">{m.role}</div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{m.text}</div>
          </div>
        ))}
      </div>

      <div className="chatComposer">
        <input
          className="chatInput"
          placeholder='Escribe... (ej: "Resume el proyecto" o "/img portada minimalista")'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button className="pill primary" onClick={() => send()}>Enviar</button>
      </div>
    </>
  );
}
```

---

## E3) Streaming typing (cola + rAF) — `apps/web/src/ai/typingStream.ts`

Esto implementa la parte crítica: **tokens del LLM aparecen en el slide como si alguien tipeara**.

- `enqueueLLMToken(token)` agrega al buffer
- `useTypingStream()` consume con `requestAnimationFrame`
- Inserta texto en el `TextElement.delta` activo

```ts
import { useEffect, useRef } from "react";
import { useDeckStore } from "../store/deckStore";
import type { Selection, Delta } from "../store/types";

let tokenQueue: string[] = [];
let target: Selection = null;

export function resetTypingTarget(sel: Selection) {
  target = sel;
  tokenQueue = [];
}

export function enqueueLLMToken(token: string) {
  if (!token) return;
  tokenQueue.push(token);
}

function appendTextToDelta(delta: Delta, text: string): Delta {
  const ops = [...(delta.ops ?? [])];

  // Simplificado: concatenar al último insert string si existe
  const last = ops[ops.length - 1];
  if (last && typeof last.insert === "string" && !last.attributes) {
    ops[ops.length - 1] = { insert: last.insert + text };
  } else {
    ops.push({ insert: text });
  }

  return { ops };
}

export function useTypingStream() {
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const store = useDeckStore.getState();
      const streaming = store.streaming.active;

      if (!streaming) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (!target) {
        // si no hay target, no insertamos
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const selected = store.getSelectedElement();
      if (!selected || selected.type !== "text") {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // consumimos de la cola N chars por frame (suave)
      const chunk = tokenQueue.shift();
      if (chunk) {
        // “teclado humano”: parte el chunk en pedazos pequeños
        const slice = chunk.slice(0, 4);
        const rest = chunk.slice(4);
        if (rest) tokenQueue.unshift(rest);

        const nextDelta = appendTextToDelta(selected.delta, slice);
        store.updateTextDelta(selected.id, nextDelta);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);
}
```

> En PROD: para exactitud “caret position”, inserta en el cursor actual del Quill overlay si está abierto.

---

# PARTE F — COLABORACIÓN (OPCIONAL) CRDT (Yjs)

Este bloque es un “starter” para multiusuario.  
Decisión clave: ¿sincronizas **Delta por elemento** o **toda la presentación** como documento?  
Recomendación práctica: mapear `deck` a un `Y.Map` con `slides` y `elements`, y cada `TextElement.delta` a `Y.Text`.

## F1) `apps/web/src/collab/yjs.ts` (skeleton)

```ts
// Skeleton de integración Yjs.
// En PROD: definir esquema Y.Doc y binding con el store (Zustand).
import * as Y from "yjs";
// import { WebsocketProvider } from "y-websocket";

export function createYDoc(roomId: string) {
  const doc = new Y.Doc();

  // const provider = new WebsocketProvider("ws://localhost:1234", roomId, doc);
  // const awareness = provider.awareness;

  const deckMap = doc.getMap("deck");
  // deckMap.set("title", "Nueva Presentación");
  // deckMap.set("slides", new Y.Array());

  return { doc, deckMap };
}
```

## Servidor y-websocket
Puedes correr un y-websocket server separado (ej. puerto 1234).
Esto se suele correr como microservicio.

---

# PARTE G — Export “pixel-perfect” y notas de producción

## G1) Estrategia de fidelidad
Para pixel-perfect real:
1) Bloquea ratio y tamaño del slide en canvas (ej. 1280×720 px).
2) Usa la misma tipografía en preview que en export.
3) Export:
   - Text: convertir Delta a **runs** (rich text) si el generador lo soporta.
   - Shapes: mapear a shapes nativos PPTX (vector).
   - Charts: exportar a SVG (vector) e insertar.
   - Imágenes: optimizar (webp->png, etc) en backend.

## G2) Embebido de fuentes
- PPTX puede embebir fuentes, pero:
  - depende de licencias (muchas fuentes no permiten embedding)
  - no está soportado “out of the box” por varias librerías
- Alternativas:
  - **(A)** Requerir fuentes instaladas en cliente
  - **(B)** Convertir texto a SVG outlines (pierde editabilidad)
  - **(C)** Implementar font embedding OOXML (complejo)

---

# PARTE H — Checklist de features pedidas vs. entregadas aquí

✅ Split-view: chat izquierda + editor derecha  
✅ Header: título inline (“Nueva Presentación”), Export dropdown, Close, Undo/Redo  
✅ Ribbon: tabs (Home, Insert, Layout, References, Review, View, AI)  
✅ Home: Clipboard, Font (Google Fonts dinámico + size), toggles B/I/U/S, hyperlink modal, color picker, Paragraph (bullets/numbers/align), Styles (H1/H2/H3)  
✅ Insert: imágenes, shapes, chart stub (tabla/video/iconos stubs)  
✅ AI: acciones + toggle modo IA/manual  
✅ Streaming: WS tokens -> queue+rAF -> texto “tipeado” en slide  
✅ Canvas: Konva con elementos interactivos, handles (Transformer), drag, snap, guides, layers, properties  
✅ Modelo Delta (Quill) + edición rich (overlay Quill)  
✅ Export PPTX básico (PptxGenJS)

⬜ PDF export (TODO)  
⬜ PNG por slide export (TODO)  
⬜ Rich text vectorial completo en preview + export (TODO(VECTOR))  
⬜ Font embedding real (TODO(FONTS))  
⬜ Colaboración CRDT completa (starter incluido)

---

# PARTE I — Cómo correr (local)

```bash
# 1) instalar deps
npm install

# 2) correr todo
npm run dev

# Web: http://localhost:5173
# API: http://localhost:3001
```

Variables de entorno sugeridas (apps/api/.env):

```bash
PORT=3001
CORS_ORIGIN=http://localhost:5173

# Provider interno de LLM (si existe)
LLM_BASE_URL=http://localhost:8080

# Opcional: OpenAI fallback
OPENAI_API_KEY=...

# Google Fonts API
GOOGLE_FONTS_API_KEY=...
```

---

## FIN DEL DOCUMENTO
