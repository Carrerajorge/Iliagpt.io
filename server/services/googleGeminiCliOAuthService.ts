import {
  ensureAuthProfileStore,
  listProfilesForProvider,
  setAuthProfileOrder,
  upsertAuthProfile,
} from "./superIntelligence/agents/auth-profiles.js";
import { loadValidConfigOrThrow, updateConfig } from "./superIntelligence/commands/models/shared.js";
import { enablePluginInConfig } from "./superIntelligence/plugins/enable.js";
import { ensureOpenClawModelsJson } from "./superIntelligence/agents/models-config.js";
import { ensurePiAuthJsonFromAuthProfiles } from "./superIntelligence/agents/pi-auth-json.js";
import {
  completeGeminiCliOAuthSession,
  startGeminiCliOAuthSession,
  type GeminiCliOAuthCredentials,
} from "../openclaw/extensions/google-gemini-cli-auth/oauth.js";
import { resolveUserScopedAgentDir } from "./userScopedAgentDir.js";

const PROVIDER_ID = "google-gemini-cli";
const PROVIDER_PLUGIN_ID = "google-gemini-cli-auth";
const DEFAULT_MODEL_REF = "google-gemini-cli/gemini-3.1-pro-preview";
const DEFAULT_MODEL_ID = "gemini-3.1-pro-preview";

export type GoogleGeminiCliOAuthStatus = {
  connected: boolean;
  providerId: typeof PROVIDER_ID;
  defaultModelRef: typeof DEFAULT_MODEL_REF;
  defaultModelId: typeof DEFAULT_MODEL_ID;
  profileId: string | null;
  email: string | null;
};

export type GoogleGeminiCliBootstrapModel = {
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

function buildProfileId(email?: string | null): string {
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  return `${PROVIDER_ID}:${normalized || "default"}`;
}

async function persistGeminiCliOAuthCredentials(
  credentials: GeminiCliOAuthCredentials,
  userId: string,
): Promise<void> {
  const agentDir = resolveUserScopedAgentDir(userId);
  if (!agentDir) {
    throw new Error("No se pudo resolver el almacenamiento OAuth del usuario.");
  }

  const profileId = buildProfileId(credentials.email);

  // Enable the plugin in config — best-effort (config may not exist yet in
  // fresh environments or Docker images without a pre-existing OpenClaw config).
  try {
    await updateConfig((currentConfig) => {
      const enabledPluginResult = enablePluginInConfig(currentConfig, PROVIDER_PLUGIN_ID);
      if (!enabledPluginResult.enabled) {
        console.warn(
          `[GeminiCliOAuth] plugin enable returned false: ${enabledPluginResult.reason || "unknown"}`,
        );
        return currentConfig;
      }
      return enabledPluginResult.config;
    });
  } catch (configError) {
    console.warn(
      "[GeminiCliOAuth] updateConfig failed (non-critical), continuing:",
      configError instanceof Error ? configError.message : configError,
    );
  }

  upsertAuthProfile({
    profileId,
    agentDir,
    credential: {
      type: "oauth",
      provider: PROVIDER_ID,
      access: credentials.access,
      refresh: credentials.refresh,
      expires: credentials.expires,
      projectId: credentials.projectId,
      ...(credentials.email ? { email: credentials.email } : {}),
    },
  });

  await setAuthProfileOrder({
    agentDir,
    provider: PROVIDER_ID,
    order: [profileId],
  });

  // Post-credential hooks: models JSON and Pi auth JSON are best-effort.
  // The credential is already persisted; these enhance the developer experience
  // but should not block the OAuth flow.
  try {
    const config = await loadValidConfigOrThrow();
    await ensureOpenClawModelsJson(config, agentDir);
    await ensurePiAuthJsonFromAuthProfiles(agentDir);
  } catch (postError) {
    console.warn(
      "[GeminiCliOAuth] post-persist hooks failed (non-critical):",
      postError instanceof Error ? postError.message : postError,
    );
  }
}

export function beginGoogleGeminiCliOAuthFlow(params?: {
  redirectUri?: string;
  state?: string;
  loginHint?: string;
}) {
  return startGeminiCliOAuthSession(params);
}

export async function finishGoogleGeminiCliOAuthFlow(params: {
  callbackInput: string;
  verifier: string;
  redirectUri?: string;
  expectedState?: string;
  userId: string;
}): Promise<GoogleGeminiCliOAuthStatus> {
  const credentials = await completeGeminiCliOAuthSession({
    callbackInput: params.callbackInput,
    verifier: params.verifier,
    redirectUri: params.redirectUri,
    expectedState: params.expectedState,
  });
  await persistGeminiCliOAuthCredentials(credentials, params.userId);
  return await getGoogleGeminiCliOAuthStatus(params.userId);
}

export async function getGoogleGeminiCliOAuthStatus(
  userId?: string | null,
): Promise<GoogleGeminiCliOAuthStatus> {
  const storedProfile = await resolveStoredProfile(userId);
  const email =
    storedProfile?.credential && "email" in storedProfile.credential
      ? storedProfile.credential.email ?? null
      : null;

  return {
    connected: Boolean(storedProfile),
    providerId: PROVIDER_ID,
    defaultModelRef: DEFAULT_MODEL_REF,
    defaultModelId: DEFAULT_MODEL_ID,
    profileId: storedProfile?.profileId ?? null,
    email,
  };
}

export async function getGoogleGeminiCliBootstrapModel(
  userId?: string | null,
): Promise<GoogleGeminiCliBootstrapModel | null> {
  const status = await getGoogleGeminiCliOAuthStatus(userId);
  if (!status.connected) {
    return null;
  }

  return {
    id: "bootstrap-google-gemini-cli-pro",
    name: "Gemini 3.1 Pro (Google OAuth)",
    provider: PROVIDER_ID,
    modelId: DEFAULT_MODEL_ID,
    description: "Gemini 3.1 Pro usando la cuenta de Google vinculada por OAuth",
    isEnabled: "true",
    enabledAt: null,
    displayOrder: 1,
    icon: null,
    modelType: "TEXT",
    contextWindow: 2000000,
  };
}
