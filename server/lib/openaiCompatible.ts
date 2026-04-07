import { FREE_MODEL_ID } from "./modelRegistry";

const DEFAULT_CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";

export function trimEnvValue(value?: string | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isCerebrasBaseUrl(baseUrl?: string | null): boolean {
  const normalized = trimEnvValue(baseUrl);
  return Boolean(normalized && /(^https?:\/\/)?api\.cerebras\.ai(\/v1)?/i.test(normalized));
}

export function getOpenAICompatibleApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return trimEnvValue(env.OPENAI_API_KEY) || trimEnvValue(env.CEREBRAS_API_KEY);
}

export function getOpenAICompatibleBaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    trimEnvValue(env.OPENAI_BASE_URL) ||
    trimEnvValue(env.CEREBRAS_BASE_URL) ||
    (trimEnvValue(env.CEREBRAS_API_KEY) ? DEFAULT_CEREBRAS_BASE_URL : undefined)
  );
}

export function getOpenAICompatibleDefaultModel(env: NodeJS.ProcessEnv = process.env): string {
  return (
    trimEnvValue(env.OPENAI_MODEL) ||
    trimEnvValue(env.CEREBRAS_MODEL) ||
    (isCerebrasBaseUrl(getOpenAICompatibleBaseUrl(env)) ? "gpt-oss-120b" : FREE_MODEL_ID)
  );
}

export function hasConfiguredOpenAICompatibleProvider(env: NodeJS.ProcessEnv = process.env): boolean {
  const baseUrl = getOpenAICompatibleBaseUrl(env);
  const apiKey = getOpenAICompatibleApiKey(env);

  if (baseUrl) {
    if (isCerebrasBaseUrl(baseUrl)) return Boolean(apiKey);
    return true;
  }

  return Boolean(apiKey);
}

export function usesCerebrasOpenAICompatibility(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(trimEnvValue(env.CEREBRAS_API_KEY) || isCerebrasBaseUrl(getOpenAICompatibleBaseUrl(env)));
}

export function normalizeOpenAICompatibleEnv(env: NodeJS.ProcessEnv = process.env): void {
  const cerebrasApiKey = trimEnvValue(env.CEREBRAS_API_KEY);
  const compatibleBaseUrl = getOpenAICompatibleBaseUrl(env);
  const cerebrasModel = trimEnvValue(env.CEREBRAS_MODEL);

  if (!trimEnvValue(env.OPENAI_API_KEY) && cerebrasApiKey) {
    env.OPENAI_API_KEY = cerebrasApiKey;
  }

  if (!trimEnvValue(env.OPENAI_BASE_URL) && compatibleBaseUrl) {
    env.OPENAI_BASE_URL = compatibleBaseUrl;
  }

  if (!trimEnvValue(env.OPENAI_MODEL) && cerebrasModel) {
    env.OPENAI_MODEL = cerebrasModel;
  }
}
