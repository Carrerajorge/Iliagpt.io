import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  ensureAuthProfileStore,
  listProfilesForProvider,
  setAuthProfileOrder,
  upsertAuthProfile,
} from "./superIntelligence/agents/auth-profiles.js";
import { ensureOpenClawModelsJson } from "./superIntelligence/agents/models-config.js";
import { ensurePiAuthJsonFromAuthProfiles } from "./superIntelligence/agents/pi-auth-json.js";
import { loadValidConfigOrThrow } from "./superIntelligence/commands/models/shared.js";
import { OPENAI_CODEX_DEFAULT_MODEL } from "./superIntelligence/commands/openai-codex-model-default.js";
import { resolveUserScopedAgentDir } from "./userScopedAgentDir.js";

const PROVIDER_ID = "openai-codex";
const DEFAULT_MODEL_REF = OPENAI_CODEX_DEFAULT_MODEL;
const DEFAULT_MODEL_ID = DEFAULT_MODEL_REF.replace(`${PROVIDER_ID}/`, "");
const FLOW_TTL_MS = 30 * 60 * 1000;
const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_ISSUER = "https://auth.openai.com";
const OPENAI_AUTHORIZE_URL = `${OPENAI_ISSUER}/oauth/authorize`;
const OPENAI_TOKEN_URL = `${OPENAI_ISSUER}/oauth/token`;
const OPENAI_SCOPE = "openid profile email offline_access";
const OPENAI_DEVICE_CODE_REQUEST_URL = `${OPENAI_ISSUER}/api/accounts/deviceauth/usercode`;
const OPENAI_DEVICE_CODE_POLL_URL = `${OPENAI_ISSUER}/api/accounts/deviceauth/token`;
const OPENAI_DEVICE_VERIFICATION_URL = `${OPENAI_ISSUER}/codex/device`;
const OPENAI_DEVICE_CALLBACK_URL = `${OPENAI_ISSUER}/deviceauth/callback`;
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

type OpenAICodexCredentials = {
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
};

type OpenAICodexFlowBase = {
  id: string;
  userId: string;
  createdAt: number;
  completed: boolean;
  error: string | null;
  result: OpenAICodexOAuthStatus | null;
};

type OpenAICodexDeviceCodeFlowRecord = OpenAICodexFlowBase & {
  kind: "device_code";
  authUrl: string;
  redirectUri: string;
  userCode: string;
  deviceAuthId: string;
  intervalSeconds: number;
  expiresAt: number;
  nextPollAt: number;
};

type OpenAICodexBrowserFlowRecord = OpenAICodexFlowBase & {
  kind: "browser";
  authUrl: string;
  redirectUri: string;
  oauthState: string;
  codeVerifier: string;
};

type OpenAICodexFlowRecord =
  | OpenAICodexDeviceCodeFlowRecord
  | OpenAICodexBrowserFlowRecord;

type OpenAICodexDeviceCodeStartResponse = {
  device_auth_id?: string;
  user_code?: string;
  interval?: string | number;
  expires_at?: string;
};

type OpenAICodexDeviceCodePollResponse = {
  authorization_code?: string;
  code_verifier?: string;
  code_challenge?: string;
};

const flowStore = new Map<string, OpenAICodexFlowRecord>();
const flowIdByState = new Map<string, string>();

export type OpenAICodexAuthMode = "device_code" | "browser";

export type OpenAICodexOAuthStatus = {
  connected: boolean;
  providerId: typeof PROVIDER_ID;
  defaultModelRef: typeof DEFAULT_MODEL_REF;
  defaultModelId: typeof DEFAULT_MODEL_ID;
  profileId: string | null;
  accountId: string | null;
};

export type OpenAICodexBootstrapModel = {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  description: string;
  isEnabled: "true";
  enabledAt: null;
  displayOrder: number;
  icon: null;
  modelType: "TEXT";
  contextWindow: number;
};

export type OpenAICodexOAuthFlowState = {
  flowId: string;
  authMode: OpenAICodexAuthMode;
  status: "pending" | "completed" | "failed";
  authUrl: string;
  redirectUri: string;
  userCode: string | null;
  expiresAt: string | null;
  result: OpenAICodexOAuthStatus | null;
  error: string | null;
};

function buildProfileId(credentials: OpenAICodexCredentials): string {
  const rawAccountId = credentials.accountId.trim();
  const normalizedAccountId = rawAccountId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${PROVIDER_ID}:${normalizedAccountId || "default"}`;
}

async function resolveStoredProfile(userId?: string | null) {
  const agentDir = resolveUserScopedAgentDir(userId);
  if (!agentDir) {
    return null;
  }

  const store = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  const profileIds = listProfilesForProvider(store, PROVIDER_ID);
  if (profileIds.length === 0) {
    return null;
  }

  const profileId = profileIds[0];
  const credential = store.profiles[profileId];
  if (!credential) {
    return null;
  }

  return {
    profileId,
    credential,
  };
}

function clearExpiredFlows(): void {
  const now = Date.now();
  for (const [flowId, flow] of flowStore.entries()) {
    const hardExpiry =
      flow.kind === "device_code"
        ? Math.max(flow.createdAt + FLOW_TTL_MS, flow.expiresAt + 60_000)
        : flow.createdAt + FLOW_TTL_MS;
    if (now > hardExpiry) {
      if (flow.kind === "browser") {
        flowIdByState.delete(flow.oauthState);
      }
      flowStore.delete(flowId);
    }
  }
}

async function persistOpenAICodexOAuthCredentials(
  credentials: OpenAICodexCredentials,
  userId: string,
): Promise<void> {
  const agentDir = resolveUserScopedAgentDir(userId);
  if (!agentDir) {
    throw new Error("No se pudo resolver el almacenamiento OAuth del usuario.");
  }

  const profileId = buildProfileId(credentials);
  upsertAuthProfile({
    profileId,
    agentDir,
    credential: {
      type: "oauth",
      provider: PROVIDER_ID,
      access: credentials.access,
      refresh: credentials.refresh,
      expires: credentials.expires,
      accountId: credentials.accountId,
    },
  });

  await setAuthProfileOrder({
    agentDir,
    provider: PROVIDER_ID,
    order: [profileId],
  });

  const config = await loadValidConfigOrThrow();
  await ensureOpenClawModelsJson(config, agentDir);
  await ensurePiAuthJsonFromAuthProfiles(agentDir);
}

function markFlowFailed(flow: OpenAICodexFlowRecord, error: unknown): void {
  flow.completed = true;
  flow.error = error instanceof Error ? error.message : String(error);
  flow.result = null;
}

async function markFlowCompleted(flow: OpenAICodexFlowRecord): Promise<void> {
  flow.result = await getOpenAICodexOAuthStatus(flow.userId);
  flow.completed = true;
  flow.error = null;
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = toBase64Url(randomBytes(32));
  const challenge = toBase64Url(
    createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge };
}

function createOAuthState(): string {
  return randomBytes(16).toString("hex");
}

function buildOpenAICodexAuthUrl(params: {
  redirectUri: string;
  oauthState: string;
  codeChallenge: string;
  originator?: string;
}): string {
  const url = new URL(OPENAI_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", OPENAI_CLIENT_ID);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", OPENAI_SCOPE);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.oauthState);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", params.originator || "iliagpt-web");
  return url.toString();
}

function parseAuthorizationInput(input: string): {
  code?: string;
  state?: string;
} {
  const value = input.trim();
  if (!value) {
    return {};
  }

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {
    // Ignore malformed URLs and continue with permissive parsing below.
  }

  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return {
      code: code?.trim() || undefined,
      state: state?.trim() || undefined,
    };
  }

  if (value.includes("code=")) {
    const params = new URLSearchParams(value.startsWith("?") ? value.slice(1) : value);
    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined,
    };
  }

  return { code: value };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }

    const payload = parts[1] ?? "";
    const normalized = payload
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getAccountId(accessToken: string): string | null {
  const payload = decodeJwtPayload(accessToken);
  const auth =
    payload && JWT_CLAIM_PATH in payload
      ? (payload[JWT_CLAIM_PATH] as Record<string, unknown> | null)
      : null;
  const accountId = auth?.chatgpt_account_id;
  return typeof accountId === "string" && accountId.trim()
    ? accountId.trim()
    : null;
}

async function exchangeAuthorizationCode(params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OpenAICodexCredentials> {
  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: OPENAI_CLIENT_ID,
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `ChatGPT OAuth rechazo el código de autorización (${response.status}).`,
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (
    !payload.access_token ||
    !payload.refresh_token ||
    typeof payload.expires_in !== "number"
  ) {
    throw new Error("ChatGPT OAuth devolvió una respuesta incompleta.");
  }

  const accountId = getAccountId(payload.access_token);
  if (!accountId) {
    throw new Error("No se pudo identificar la cuenta de ChatGPT autenticada.");
  }

  return {
    access: payload.access_token,
    refresh: payload.refresh_token,
    expires: Date.now() + payload.expires_in * 1000,
    accountId,
  };
}

async function completeFlowWithAuthorizationCode(params: {
  flow: OpenAICodexFlowRecord;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OpenAICodexOAuthStatus> {
  if (params.flow.completed && params.flow.result) {
    return params.flow.result;
  }

  const credentials = await exchangeAuthorizationCode({
    code: params.code,
    redirectUri: params.redirectUri,
    codeVerifier: params.codeVerifier,
  });
  await persistOpenAICodexOAuthCredentials(credentials, params.flow.userId);
  await markFlowCompleted(params.flow);
  return params.flow.result ?? (await getOpenAICodexOAuthStatus(params.flow.userId));
}

async function requestOpenAICodexDeviceCode(): Promise<{
  authUrl: string;
  redirectUri: string;
  userCode: string;
  deviceAuthId: string;
  intervalSeconds: number;
  expiresAt: number;
}> {
  const response = await fetch(OPENAI_DEVICE_CODE_REQUEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: OPENAI_CLIENT_ID }),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        "ChatGPT no habilito el login con codigo de dispositivo para este flujo.",
      );
    }
    throw new Error(
      `No se pudo iniciar el codigo de dispositivo de ChatGPT (${response.status}).`,
    );
  }

  const payload = (await response.json()) as OpenAICodexDeviceCodeStartResponse;
  const deviceAuthId = payload.device_auth_id?.trim() || "";
  const userCode = payload.user_code?.trim() || "";
  const intervalSeconds = Math.max(1, Number.parseInt(String(payload.interval ?? "5"), 10) || 5);
  const expiresAtValue = payload.expires_at ? Date.parse(payload.expires_at) : Number.NaN;
  const expiresAt = Number.isFinite(expiresAtValue)
    ? expiresAtValue
    : Date.now() + 15 * 60 * 1000;

  if (!deviceAuthId || !userCode) {
    throw new Error("ChatGPT no devolvio el codigo de dispositivo esperado.");
  }

  return {
    authUrl: OPENAI_DEVICE_VERIFICATION_URL,
    redirectUri: OPENAI_DEVICE_CALLBACK_URL,
    userCode,
    deviceAuthId,
    intervalSeconds,
    expiresAt,
  };
}

async function pollOpenAICodexDeviceCodeFlow(
  flow: OpenAICodexDeviceCodeFlowRecord,
): Promise<void> {
  if (flow.completed) {
    return;
  }

  const now = Date.now();
  if (now >= flow.expiresAt) {
    markFlowFailed(
      flow,
      "El codigo de ChatGPT expiro. Inicia la vinculacion otra vez.",
    );
    return;
  }

  if (now < flow.nextPollAt) {
    return;
  }

  flow.nextPollAt = now + flow.intervalSeconds * 1000;

  const response = await fetch(OPENAI_DEVICE_CODE_POLL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_auth_id: flow.deviceAuthId,
      user_code: flow.userCode,
    }),
  });

  if (response.status === 403 || response.status === 404) {
    return;
  }

  if (!response.ok) {
    throw new Error(
      `ChatGPT no pudo confirmar el codigo del dispositivo (${response.status}).`,
    );
  }

  const payload = (await response.json()) as OpenAICodexDeviceCodePollResponse;
  const authorizationCode = payload.authorization_code?.trim() || "";
  const codeVerifier = payload.code_verifier?.trim() || "";

  if (!authorizationCode || !codeVerifier) {
    throw new Error("ChatGPT devolvio una respuesta incompleta para el codigo de dispositivo.");
  }

  await completeFlowWithAuthorizationCode({
    flow,
    code: authorizationCode,
    redirectUri: OPENAI_DEVICE_CALLBACK_URL,
    codeVerifier,
  });
}

function serializeFlow(flow: OpenAICodexFlowRecord): OpenAICodexOAuthFlowState {
  return {
    flowId: flow.id,
    authMode: flow.kind,
    status: flow.completed ? (flow.error ? "failed" : "completed") : "pending",
    authUrl: flow.authUrl,
    redirectUri: flow.redirectUri,
    userCode: flow.kind === "device_code" ? flow.userCode : null,
    expiresAt:
      flow.kind === "device_code" ? new Date(flow.expiresAt).toISOString() : null,
    result: flow.result,
    error: flow.error,
  };
}

export async function getOpenAICodexOAuthStatus(
  userId?: string | null,
): Promise<OpenAICodexOAuthStatus> {
  const storedProfile = await resolveStoredProfile(userId);
  const accountId =
    storedProfile?.credential && "accountId" in storedProfile.credential
      ? storedProfile.credential.accountId ?? null
      : null;

  return {
    connected: Boolean(storedProfile),
    providerId: PROVIDER_ID,
    defaultModelRef: DEFAULT_MODEL_REF,
    defaultModelId: DEFAULT_MODEL_ID,
    profileId: storedProfile?.profileId ?? null,
    accountId,
  };
}

export async function getOpenAICodexBootstrapModel(
  userId?: string | null,
): Promise<OpenAICodexBootstrapModel | null> {
  const status = await getOpenAICodexOAuthStatus(userId);
  if (!status.connected) {
    return null;
  }

  return {
    id: "bootstrap-openai-codex-primary",
    name: "GPT-5.4 (ChatGPT)",
    provider: PROVIDER_ID,
    modelId: DEFAULT_MODEL_ID,
    description: "GPT-5.4 usando tu cuenta de ChatGPT con OAuth",
    isEnabled: "true",
    enabledAt: null,
    displayOrder: 1,
    icon: null,
    modelType: "TEXT",
    contextWindow: 1_050_000,
  };
}

async function startOpenAICodexDeviceCodeFlow(params: {
  userId: string;
}): Promise<OpenAICodexOAuthFlowState> {
  const deviceCode = await requestOpenAICodexDeviceCode();
  const flow: OpenAICodexDeviceCodeFlowRecord = {
    id: randomUUID(),
    kind: "device_code",
    userId: params.userId,
    createdAt: Date.now(),
    authUrl: deviceCode.authUrl,
    redirectUri: deviceCode.redirectUri,
    userCode: deviceCode.userCode,
    deviceAuthId: deviceCode.deviceAuthId,
    intervalSeconds: deviceCode.intervalSeconds,
    expiresAt: deviceCode.expiresAt,
    nextPollAt: Date.now() + deviceCode.intervalSeconds * 1000,
    completed: false,
    error: null,
    result: null,
  };

  flowStore.set(flow.id, flow);
  return serializeFlow(flow);
}

export async function startOpenAICodexOAuthFlow(params: {
  userId: string;
}): Promise<OpenAICodexOAuthFlowState> {
  clearExpiredFlows();
  return startOpenAICodexDeviceCodeFlow(params);
}

function getOwnedFlow(flowId: string, userId: string): OpenAICodexFlowRecord {
  clearExpiredFlows();
  const flow = flowStore.get(flowId);
  if (!flow) {
    throw new Error("La sesion OAuth expiro. Inicia la vinculacion otra vez.");
  }
  if (flow.userId !== userId) {
    throw new Error("La sesion OAuth no pertenece a este usuario.");
  }
  return flow;
}

function getFlowByState(oauthState: string): OpenAICodexBrowserFlowRecord {
  clearExpiredFlows();
  const flowId = flowIdByState.get(oauthState);
  if (!flowId) {
    throw new Error("La sesion OAuth expiro. Inicia la vinculacion otra vez.");
  }

  const flow = flowStore.get(flowId);
  if (!flow || flow.kind !== "browser") {
    throw new Error("La sesion OAuth expiro. Inicia la vinculacion otra vez.");
  }

  return flow;
}

export async function submitOpenAICodexOAuthManualInput(params: {
  flowId: string;
  userId: string;
  input: string;
}): Promise<OpenAICodexOAuthStatus | null> {
  const flow = getOwnedFlow(params.flowId, params.userId);
  if (flow.kind !== "browser") {
    throw new Error(
      "Este flujo de ChatGPT usa codigo de dispositivo. Reinicia la vinculacion y usa el codigo mostrado.",
    );
  }

  if (flow.completed) {
    if (flow.error) {
      throw new Error(flow.error);
    }
    return flow.result;
  }

  const value = params.input.trim();
  if (!value) {
    throw new Error("Debes pegar la URL final del callback o el codigo.");
  }

  const parsed = parseAuthorizationInput(value);
  if (parsed.state && parsed.state !== flow.oauthState) {
    throw new Error("La URL final no pertenece a esta sesion de ChatGPT OAuth.");
  }
  if (!parsed.code) {
    throw new Error("No se encontro el codigo de autorizacion de ChatGPT.");
  }

  try {
    return await completeFlowWithAuthorizationCode({
      flow,
      code: parsed.code,
      redirectUri: flow.redirectUri,
      codeVerifier: flow.codeVerifier,
    });
  } catch (error) {
    markFlowFailed(flow, error);
    throw error;
  }
}

export async function completeOpenAICodexOAuthFlowFromCallback(params: {
  oauthState: string;
  code?: string | null;
  error?: string | null;
  errorDescription?: string | null;
}): Promise<{
  flowId: string;
  status: "success" | "error";
  result: OpenAICodexOAuthStatus | null;
  error: string | null;
  errorDescription: string | null;
}> {
  const flow = getFlowByState(params.oauthState.trim());
  if (flow.completed) {
    return {
      flowId: flow.id,
      status: flow.error ? "error" : "success",
      result: flow.result,
      error: flow.error ? "openai_codex_oauth_failed" : null,
      errorDescription: flow.error,
    };
  }

  if (params.error) {
    const description =
      params.errorDescription?.trim() ||
      "ChatGPT cancelo o rechazo la autenticacion.";
    markFlowFailed(flow, description);
    return {
      flowId: flow.id,
      status: "error",
      result: null,
      error: params.error.trim(),
      errorDescription: description,
    };
  }

  const code = params.code?.trim() || "";
  if (!code) {
    const description = "ChatGPT no devolvio un codigo de autorizacion valido.";
    markFlowFailed(flow, description);
    return {
      flowId: flow.id,
      status: "error",
      result: null,
      error: "openai_codex_missing_code",
      errorDescription: description,
    };
  }

  try {
    const result = await completeFlowWithAuthorizationCode({
      flow,
      code,
      redirectUri: flow.redirectUri,
      codeVerifier: flow.codeVerifier,
    });
    return {
      flowId: flow.id,
      status: "success",
      result,
      error: null,
      errorDescription: null,
    };
  } catch (error) {
    markFlowFailed(flow, error);
    return {
      flowId: flow.id,
      status: "error",
      result: null,
      error: "openai_codex_complete_failed",
      errorDescription: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getOpenAICodexOAuthFlowState(params: {
  flowId: string;
  userId: string;
}): Promise<OpenAICodexOAuthFlowState> {
  const flow = getOwnedFlow(params.flowId, params.userId);

  if (flow.kind === "device_code" && !flow.completed) {
    try {
      await pollOpenAICodexDeviceCodeFlow(flow);
    } catch (error) {
      markFlowFailed(flow, error);
    }
  }

  return serializeFlow(flow);
}

