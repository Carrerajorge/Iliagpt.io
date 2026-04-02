import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { requireAdmin } from "./admin/utils";
import { getUserId } from "../types/express";
import {
  clearExpiredGeminiCliOAuthCompletedStore,
  clearExpiredGeminiCliOAuthFlows,
  getGeminiCliOAuthCompletedFromStore,
  getGeminiCliOAuthCompleted,
  deleteGeminiCliOAuthFlow,
  extractGeminiCliFlowIdFromCallbackInput,
  getGeminiCliOAuthFlow,
  saveGeminiCliOAuthCompletedToStore,
  saveGeminiCliOAuthCompleted,
  saveGeminiCliOAuthFlow,
  type GeminiCliOAuthCompletedSessionStore,
  type GeminiCliOAuthFlowRecord,
} from "../lib/geminiCliOAuthFlowStore";
import {
  beginGoogleGeminiCliOAuthFlow,
  finishGoogleGeminiCliOAuthFlow,
  getGoogleGeminiCliOAuthStatus,
} from "../services/googleGeminiCliOAuthService";

const FLOW_TTL_MS = 45 * 60 * 1000;

type GeminiCliFlowSessionEntry = GeminiCliOAuthFlowRecord;

type GeminiCliFlowProof = {
  verifier: string;
  oauthState: string;
  redirectUri: string;
  createdAt: number;
};

type GeminiCliSessionState = {
  geminiCliOAuthFlows?: Record<string, GeminiCliFlowSessionEntry>;
  geminiCliOAuthCompleted?: GeminiCliOAuthCompletedSessionStore;
};

const pendingFlowStore = new Map<string, GeminiCliFlowSessionEntry>();

function getFlowStore(req: Request): Record<string, GeminiCliFlowSessionEntry> {
  const session = ((req as any).session ?? {}) as GeminiCliSessionState;
  session.geminiCliOAuthFlows = session.geminiCliOAuthFlows ?? {};
  (req as any).session = session;
  return session.geminiCliOAuthFlows;
}

function getCompletedStore(req: Request): GeminiCliOAuthCompletedSessionStore {
  const session = ((req as any).session ?? {}) as GeminiCliSessionState;
  session.geminiCliOAuthCompleted = session.geminiCliOAuthCompleted ?? {};
  (req as any).session = session;
  return session.geminiCliOAuthCompleted;
}

async function saveSession(req: Request): Promise<void> {
  const session = (req as any).session;
  if (!session || typeof session.save !== "function") {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    session.save((error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function clearExpiredFlows(
  store: Record<string, GeminiCliFlowSessionEntry>,
  completedStore?: GeminiCliOAuthCompletedSessionStore,
): void {
  clearExpiredGeminiCliOAuthFlows();
  const now = Date.now();
  for (const [flowId, flow] of Object.entries(store)) {
    if (now - flow.createdAt > FLOW_TTL_MS) {
      delete store[flowId];
    }
  }
  if (completedStore) {
    clearExpiredGeminiCliOAuthCompletedStore(completedStore, now);
  }
}

function getPendingFlowKey(userId: string, flowId: string): string {
  return `${userId}:${flowId}`;
}

function clearExpiredPendingFlows(): void {
  const now = Date.now();
  for (const [key, flow] of pendingFlowStore.entries()) {
    if (now - flow.createdAt > FLOW_TTL_MS) {
      pendingFlowStore.delete(key);
    }
  }
}

function getCanonicalGoogleCallbackUri(req: Request): string {
  const canonicalDomain = process.env.CANONICAL_DOMAIN || "iliagpt.com";
  if (process.env.NODE_ENV === "production") {
    return `https://${canonicalDomain}/api/auth/google/callback`;
  }
  return `${req.protocol}://${req.get("host")}/api/auth/google/callback`;
}

function normalizeLoginHint(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized.length > 320 ||
    /\s/.test(normalized) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new Error(
      "Ingresa un correo Gmail valido para sugerir la cuenta que deseas vincular.",
    );
  }

  return normalized;
}

const googleGeminiCliOAuthRouter = Router();

// Allow any authenticated user (not just admin) to use Gemini CLI OAuth.
// Authentication is still required via getUserId() checks in each handler.
// googleGeminiCliOAuthRouter.use(requireAdmin);

googleGeminiCliOAuthRouter.get(
  "/status",
  async (req: Request, res: Response) => {
    try {
      res.json(await getGoogleGeminiCliOAuthStatus(getUserId(req)));
    } catch (error) {
      console.error("[GeminiCliOAuth] status failed:", error);
      res
        .status(500)
        .json({ error: "No se pudo consultar el estado de Gemini CLI OAuth" });
    }
  },
);

googleGeminiCliOAuthRouter.post(
  "/start",
  async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const flowStore = getFlowStore(req);
      const completedStore = getCompletedStore(req);
      clearExpiredFlows(flowStore, completedStore);
      clearExpiredPendingFlows();

      const flowId = randomUUID();
      const redirectUri = getCanonicalGoogleCallbackUri(req);
      const oauthState = `gemini-cli:${flowId}`;
      const loginHint = normalizeLoginHint(req.body?.loginHint);
      const flow = beginGoogleGeminiCliOAuthFlow({
        redirectUri,
        state: oauthState,
        loginHint,
      });
      const flowRecord: GeminiCliFlowSessionEntry = {
        verifier: flow.verifier,
        createdAt: Date.now(),
        userId,
        oauthState,
        redirectUri,
      };
      flowStore[flowId] = flowRecord;
      pendingFlowStore.set(getPendingFlowKey(userId, flowId), flowRecord);
      saveGeminiCliOAuthFlow(flowId, flowRecord);
      const respond = () =>
        res.json({
          flowId,
          authUrl: flow.authUrl,
          redirectUri: flow.redirectUri,
          flowProof: {
            verifier: flow.verifier,
            oauthState,
            redirectUri,
            createdAt: flowRecord.createdAt,
          } satisfies GeminiCliFlowProof,
          warning:
            "Integracion no oficial. Algunas cuentas pueden sufrir restricciones al usar Gemini CLI OAuth desde terceros.",
        });

      if (typeof (req as any).session?.save === "function") {
        return (req as any).session.save((sessionError: unknown) => {
          if (sessionError) {
            console.error(
              "[GeminiCliOAuth] failed to persist session flow:",
              sessionError,
            );
          }
          respond();
        });
      }

      respond();
    } catch (error) {
      console.error("[GeminiCliOAuth] start failed:", error);
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo iniciar Gemini CLI OAuth";
      res.status(500).json({ error: message });
    }
  },
);

googleGeminiCliOAuthRouter.post(
  "/complete",
  async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const callbackUrl =
        typeof req.body?.callbackUrl === "string"
          ? req.body.callbackUrl.trim()
          : "";
      const requestedFlowId =
        typeof req.body?.flowId === "string" ? req.body.flowId.trim() : "";
      const callbackFlowId =
        extractGeminiCliFlowIdFromCallbackInput(callbackUrl) || "";
      const flowId = callbackFlowId || requestedFlowId || "";
      const flowProofRaw = req.body?.flowProof;
      const flowProof: GeminiCliFlowProof | null =
        flowProofRaw &&
        typeof flowProofRaw?.verifier === "string" &&
        typeof flowProofRaw?.oauthState === "string" &&
        typeof flowProofRaw?.redirectUri === "string" &&
        typeof flowProofRaw?.createdAt === "number"
          ? {
              verifier: flowProofRaw.verifier.trim(),
              oauthState: flowProofRaw.oauthState.trim(),
              redirectUri: flowProofRaw.redirectUri.trim(),
              createdAt: flowProofRaw.createdAt,
            }
          : null;
      if (!flowId || !callbackUrl) {
        return res
          .status(400)
          .json({ error: "flowId y callbackUrl son requeridos" });
      }
      if (
        requestedFlowId &&
        callbackFlowId &&
        requestedFlowId !== callbackFlowId
      ) {
        console.warn(
          "[GeminiCliOAuth] flowId mismatch between request body and callback state",
          {
            requestedFlowId,
            callbackFlowId,
            userId,
          },
        );
      }

      const flowStore = getFlowStore(req);
      const completedStore = getCompletedStore(req);
      clearExpiredFlows(flowStore, completedStore);
      clearExpiredPendingFlows();
      const pendingFlowKey = getPendingFlowKey(userId, flowId);

      const storedFlow =
        flowStore[flowId] ??
        pendingFlowStore.get(pendingFlowKey) ??
        getGeminiCliOAuthFlow(flowId);
      let flow:
        | (GeminiCliFlowSessionEntry & {
            userId: string;
          })
        | null = storedFlow;

      if (!flow && flowProof) {
        const isFresh = Date.now() - flowProof.createdAt <= FLOW_TTL_MS;
        const expectedState = `gemini-cli:${flowId}`;
        if (isFresh && flowProof.oauthState === expectedState) {
          flow = {
            verifier: flowProof.verifier,
            createdAt: flowProof.createdAt,
            userId,
            oauthState: flowProof.oauthState,
            redirectUri: flowProof.redirectUri,
          };
        }
      }
      if (!flow) {
        const sessionCompleted = getGeminiCliOAuthCompletedFromStore(
          completedStore,
          flowId,
          userId,
        );
        if (sessionCompleted) {
          return res.json(sessionCompleted.response);
        }
        const completed = getGeminiCliOAuthCompleted(flowId, userId);
        if (completed) {
          return res.json(completed.response);
        }
        return res.status(400).json({
          error: "La sesion OAuth expiro. Inicia la vinculacion otra vez.",
        });
      }
      if (flow.userId !== userId) {
        return res
          .status(403)
          .json({ error: "La sesion OAuth no pertenece a este usuario" });
      }

      const status = await finishGoogleGeminiCliOAuthFlow({
        verifier: flow.verifier,
        callbackInput: callbackUrl,
        redirectUri: flow.redirectUri,
        expectedState: flow.oauthState,
        userId,
      });

      delete flowStore[flowId];
      pendingFlowStore.delete(pendingFlowKey);
      deleteGeminiCliOAuthFlow(flowId);
      const responsePayload = {
        ...status,
        selectedModelId: status.defaultModelId,
      };
      saveGeminiCliOAuthCompletedToStore(
        completedStore,
        flowId,
        userId,
        responsePayload,
      );
      saveGeminiCliOAuthCompleted(flowId, userId, responsePayload);
      await saveSession(req);

      res.json(responsePayload);
    } catch (error) {
      console.error("[GeminiCliOAuth] complete failed:", error);
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo completar Gemini CLI OAuth";
      res.status(400).json({ error: message });
    }
  },
);

export default googleGeminiCliOAuthRouter;
