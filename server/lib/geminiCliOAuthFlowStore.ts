export type GeminiCliOAuthFlowRecord = {
  verifier: string;
  createdAt: number;
  userId: string;
  oauthState: string;
  redirectUri: string;
};

export type GeminiCliOAuthCompletedRecord = {
  userId: string;
  completedAt: number;
  response: Record<string, unknown>;
};

export type GeminiCliOAuthCompletedSessionStore = Record<
  string,
  GeminiCliOAuthCompletedRecord
>;

const GEMINI_CLI_STATE_PREFIX = "gemini-cli:";
const FLOW_TTL_MS = 45 * 60 * 1000;
const COMPLETED_FLOW_TTL_MS = 30 * 60 * 1000;
const globalGeminiCliFlowStore = new Map<string, GeminiCliOAuthFlowRecord>();
const globalGeminiCliCompletedStore = new Map<string, GeminiCliOAuthCompletedRecord>();

function getCompletedKey(flowId: string, userId: string): string {
  return `${userId}:${flowId}`;
}

export function clearExpiredGeminiCliOAuthCompletedStore(
  store: GeminiCliOAuthCompletedSessionStore,
  now = Date.now(),
): void {
  for (const [key, flow] of Object.entries(store)) {
    if (now - flow.completedAt > COMPLETED_FLOW_TTL_MS) {
      delete store[key];
    }
  }
}

export function saveGeminiCliOAuthCompletedToStore(
  store: GeminiCliOAuthCompletedSessionStore,
  flowId: string,
  userId: string,
  response: Record<string, unknown>,
  now = Date.now(),
): GeminiCliOAuthCompletedRecord {
  clearExpiredGeminiCliOAuthCompletedStore(store, now);
  const completedRecord: GeminiCliOAuthCompletedRecord = {
    userId,
    completedAt: now,
    response,
  };
  store[getCompletedKey(flowId, userId)] = completedRecord;
  return completedRecord;
}

export function getGeminiCliOAuthCompletedFromStore(
  store: GeminiCliOAuthCompletedSessionStore,
  flowId: string,
  userId: string,
  now = Date.now(),
): GeminiCliOAuthCompletedRecord | null {
  clearExpiredGeminiCliOAuthCompletedStore(store, now);
  return store[getCompletedKey(flowId, userId)] ?? null;
}

export function deleteGeminiCliOAuthCompletedFromStore(
  store: GeminiCliOAuthCompletedSessionStore,
  flowId: string,
  userId: string,
): void {
  delete store[getCompletedKey(flowId, userId)];
}

export function clearExpiredGeminiCliOAuthFlows(now = Date.now()): void {
  for (const [flowId, flow] of globalGeminiCliFlowStore.entries()) {
    if (now - flow.createdAt > FLOW_TTL_MS) {
      globalGeminiCliFlowStore.delete(flowId);
    }
  }

  for (const [key, flow] of globalGeminiCliCompletedStore.entries()) {
    if (now - flow.completedAt > COMPLETED_FLOW_TTL_MS) {
      globalGeminiCliCompletedStore.delete(key);
    }
  }
}

export function saveGeminiCliOAuthFlow(
  flowId: string,
  flow: GeminiCliOAuthFlowRecord,
): GeminiCliOAuthFlowRecord {
  clearExpiredGeminiCliOAuthFlows();
  globalGeminiCliFlowStore.set(flowId, flow);
  return flow;
}

export function getGeminiCliOAuthFlow(flowId: string): GeminiCliOAuthFlowRecord | null {
  clearExpiredGeminiCliOAuthFlows();
  return globalGeminiCliFlowStore.get(flowId) ?? null;
}

export function deleteGeminiCliOAuthFlow(flowId: string): void {
  globalGeminiCliFlowStore.delete(flowId);
}

export function saveGeminiCliOAuthCompleted(
  flowId: string,
  userId: string,
  response: Record<string, unknown>,
): GeminiCliOAuthCompletedRecord {
  clearExpiredGeminiCliOAuthFlows();
  const completedRecord: GeminiCliOAuthCompletedRecord = {
    userId,
    completedAt: Date.now(),
    response,
  };
  globalGeminiCliCompletedStore.set(getCompletedKey(flowId, userId), completedRecord);
  return completedRecord;
}

export function getGeminiCliOAuthCompleted(
  flowId: string,
  userId: string,
): GeminiCliOAuthCompletedRecord | null {
  clearExpiredGeminiCliOAuthFlows();
  return globalGeminiCliCompletedStore.get(getCompletedKey(flowId, userId)) ?? null;
}

export function deleteGeminiCliOAuthCompleted(flowId: string, userId: string): void {
  globalGeminiCliCompletedStore.delete(getCompletedKey(flowId, userId));
}

export function extractGeminiCliFlowIdFromState(state: string | null | undefined): string | null {
  const trimmed = typeof state === "string" ? state.trim() : "";
  if (!trimmed.startsWith(GEMINI_CLI_STATE_PREFIX)) {
    return null;
  }
  const flowId = trimmed.slice(GEMINI_CLI_STATE_PREFIX.length).trim();
  return flowId || null;
}

export function extractGeminiCliFlowIdFromCallbackInput(
  callbackInput: string | null | undefined,
): string | null {
  const trimmed = typeof callbackInput === "string" ? callbackInput.trim() : "";
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return extractGeminiCliFlowIdFromState(url.searchParams.get("state"));
  } catch {
    const normalized = trimmed.startsWith("?") ? trimmed.slice(1) : trimmed;
    const params = new URLSearchParams(normalized);
    return extractGeminiCliFlowIdFromState(params.get("state"));
  }
}
