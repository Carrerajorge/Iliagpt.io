import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { getUserId } from "../types/express";
import {
  completeOpenAICodexOAuthFlowFromCallback,
  getOpenAICodexOAuthFlowState,
  getOpenAICodexOAuthStatus,
  startOpenAICodexOAuthFlow,
  submitOpenAICodexOAuthManualInput,
} from "../services/openAICodexOAuthService";

const openAICodexOAuthRouter = Router();

// Allow any authenticated user (not just admin) to use OpenAI Codex OAuth.
// Authentication is still required via getUserId() checks in each handler.
// openAICodexOAuthRouter.use(requireAdmin);

function buildObservedCallbackUrl(req: Request): string {
  const canonicalBase =
    process.env.NODE_ENV === "production"
      ? `https://${process.env.CANONICAL_DOMAIN || "iliagpt.com"}`
      : `${req.protocol}://${req.get("host")}`;
  return new URL(req.originalUrl || req.url, canonicalBase).toString();
}

function renderOpenAICodexOAuthBridge(
  res: Response,
  payload: {
    flowId: string;
    status: "success" | "error";
    result?: Record<string, unknown> | null;
    callbackUrl?: string;
    error?: string | null;
    errorDescription?: string | null;
  },
): void {
  const messagePayload = {
    type: "openai-codex-oauth-result",
    flowId: payload.flowId,
    status: payload.status,
    result: payload.result ?? null,
    callbackUrl: payload.callbackUrl || "",
    error: payload.error ?? null,
    errorDescription: payload.errorDescription ?? null,
  };
  const serializedPayload = JSON.stringify(messagePayload).replace(/</g, "\\u003c");
  const nonce = randomBytes(16).toString("base64");
  const contentSecurityPolicy = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
    "connect-src 'self'",
  ].join("; ");

  res
    .status(payload.status === "success" ? 200 : 400)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .setHeader("Content-Security-Policy", contentSecurityPolicy)
    .send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ChatGPT OAuth</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #07131f; color: #f8fafc; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 24px; }
      .card { max-width: 540px; background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(148, 163, 184, 0.22); border-radius: 20px; padding: 24px; box-shadow: 0 24px 80px rgba(15, 23, 42, 0.35); }
      h1 { margin: 0 0 12px; font-size: 22px; }
      p { margin: 0 0 12px; line-height: 1.55; color: #cbd5e1; }
      #status { color: ${payload.status === "success" ? "#86efac" : "#fca5a5"}; }
      code { display: block; margin-top: 12px; padding: 12px; background: rgba(15, 23, 42, 0.8); border-radius: 12px; color: #e2e8f0; word-break: break-all; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${payload.status === "success" ? "ChatGPT conectado" : "No se pudo completar ChatGPT OAuth"}</h1>
      <p>${payload.status === "success" ? "Puedes volver a ILIAGPT. Esta ventana se cerrará automáticamente si el navegador lo permite." : "Vuelve a ILIAGPT para reintentar la vinculación o revisar el error."}</p>
      <p id="status">${payload.status === "success" ? "Finalizando la vinculación..." : (payload.errorDescription || payload.error || "No se pudo completar la autenticación con ChatGPT.").replace(/</g, "&lt;")}</p>
      ${payload.callbackUrl ? `<code>${payload.callbackUrl.replace(/</g, "&lt;")}</code>` : ""}
    </div>
    <script nonce="${nonce}">
      (function () {
        const payload = ${serializedPayload};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, window.location.origin);
          }
        } catch {}
        try {
          window.localStorage.setItem(
            "iliagpt:openai-codex-oauth-result",
            JSON.stringify({ ...payload, createdAt: Date.now() }),
          );
        } catch {}
        setTimeout(function () {
          try { window.close(); } catch {}
        }, 900);
      })();
    </script>
  </body>
</html>`);
}

openAICodexOAuthRouter.get("/status", async (req: Request, res: Response) => {
  try {
    res.json(await getOpenAICodexOAuthStatus(getUserId(req)));
  } catch (error) {
    console.error("[OpenAICodexOAuth] status failed:", error);
    res
      .status(500)
      .json({ error: "No se pudo consultar el estado de ChatGPT OAuth" });
  }
});

openAICodexOAuthRouter.post("/start", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const flow = await startOpenAICodexOAuthFlow({ userId });
    res.json({
      ...flow,
      instructions:
        flow.authMode === "device_code"
          ? "Abre la pagina de ChatGPT, ingresa el codigo de un solo uso y vuelve a ILIAGPT. La vinculacion se completa automaticamente en cuanto OpenAI confirme el codigo."
          : "Inicia sesión con tu cuenta de ChatGPT Plus/Pro. Si el callback web no se completa, pega la URL final de ILIAGPT o solo el código.",
    });
  } catch (error) {
    console.error("[OpenAICodexOAuth] start failed:", error);
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo iniciar ChatGPT OAuth";
    res.status(500).json({ error: message });
  }
});

openAICodexOAuthRouter.get("/flow/:flowId", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    res.json(
      await getOpenAICodexOAuthFlowState({
        flowId: String(req.params.flowId || "").trim(),
        userId,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo consultar el flujo OAuth";
    const statusCode = message.includes("no pertenece") ? 403 : 400;
    res.status(statusCode).json({ error: message });
  }
});

openAICodexOAuthRouter.get("/callback", async (req: Request, res: Response) => {
  try {
    const oauthState =
      typeof req.query.state === "string" ? req.query.state.trim() : "";
    if (!oauthState) {
      return renderOpenAICodexOAuthBridge(res, {
        flowId: "",
        status: "error",
        callbackUrl: buildObservedCallbackUrl(req),
        error: "openai_codex_missing_state",
        errorDescription: "ChatGPT no devolvió el estado esperado para completar la sesión.",
      });
    }

    const result = await completeOpenAICodexOAuthFlowFromCallback({
      oauthState,
      code: typeof req.query.code === "string" ? req.query.code : null,
      error: typeof req.query.error === "string" ? req.query.error : null,
      errorDescription:
        typeof req.query.error_description === "string"
          ? req.query.error_description
          : null,
    });

    renderOpenAICodexOAuthBridge(res, {
      ...result,
      callbackUrl: buildObservedCallbackUrl(req),
    });
  } catch (error) {
    renderOpenAICodexOAuthBridge(res, {
      flowId: "",
      status: "error",
      callbackUrl: buildObservedCallbackUrl(req),
      error: "openai_codex_callback_failed",
      errorDescription:
        error instanceof Error
          ? error.message
          : "No se pudo completar ChatGPT OAuth",
    });
  }
});

openAICodexOAuthRouter.post("/complete", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const flowId =
      typeof req.body?.flowId === "string" ? req.body.flowId.trim() : "";
    const input = typeof req.body?.input === "string" ? req.body.input.trim() : "";
    if (!flowId || !input) {
      return res.status(400).json({ error: "flowId e input son requeridos" });
    }

    const result = await submitOpenAICodexOAuthManualInput({
      flowId,
      userId,
      input,
    });
    res.json({ ok: true, result });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo completar ChatGPT OAuth";
    const statusCode = message.includes("no pertenece") ? 403 : 400;
    res.status(statusCode).json({ error: message });
  }
});

export default openAICodexOAuthRouter;
