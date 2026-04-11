/**
 * Minimal standalone Express server that mounts ONLY the BERT and
 * Transformer routers, with no DB / Redis / Agent / Playwright / etc.
 *
 * Purpose: run live end-to-end HTTP tests against the math endpoints
 * in isolation, without paying the cost of bootstrapping the full
 * IliaGPT platform. Every mounted route is a pure Float64 computation
 * so this smoke server is completely self-contained.
 *
 * Run with:
 *   npx tsx scripts/bert-smoke-server.ts
 *
 * Then hit http://localhost:5174/api/bert/configs (etc.).
 */

import express from "express";
import { createBertRouter } from "../server/routes/bertRoutes";
import { createTransformerRouter } from "../server/routes/transformerRoutes";
import { createGpt3Router } from "../server/routes/gpt3Routes";

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use("/api/bert", createBertRouter());
app.use("/api/transformer", createTransformerRouter());
app.use("/api/gpt3", createGpt3Router());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    routes: ["/api/bert/*", "/api/transformer/*", "/api/gpt3/*"],
  });
});

const PORT = Number(process.env.BERT_SMOKE_PORT ?? 5174);
app.listen(PORT, () => {
  // Print a boundary marker so test scripts can wait for "listening"
  console.log(`[bert-smoke-server] listening on http://localhost:${PORT}`);
});
