import { describe, expect, it } from "vitest";
import express from "express";
import { createHttpTestClient } from "../../tests/helpers/httpTestClient";
import { correlationIdMiddleware } from "../middleware/correlationId";
import { requestLoggerMiddleware } from "../middleware/requestLogger";
import { requestTracerMiddleware } from "../lib/requestTracer";

describe("requestTracerMiddleware correlation", () => {
  it("preserves upstream request IDs (does not override res.locals.requestId)", async () => {
    const app = express();
    app.use(express.json({ limit: "128kb" }));
    app.use(correlationIdMiddleware);
    app.use(requestLoggerMiddleware);
    app.use(requestTracerMiddleware);

    app.get("/ping", (req, res) => {
      res.json({
        localsRequestId: res.locals.requestId,
        correlationId: (req as any).correlationId,
        requestId: (req as any).requestId,
        traceId: (res.locals as any).traceId,
      });
    });

    const { client, close } = await createHttpTestClient(app);
    try {
      const upstream = "req_abc12345";
      const response = await client.get("/ping").set("X-Request-Id", upstream);

      expect(response.status).toBe(200);
      expect(response.headers["x-request-id"]).toBe(upstream);
      expect(response.body.localsRequestId).toBe(upstream);
      expect(response.body.correlationId).toBe(upstream);
    } finally {
      await close();
    }
  });
});

