const OPENAI_CODEX_LOCAL_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

export type OpenAIWebOAuthAvailability = {
  available: boolean;
  clientId: string | null;
  reason: string | null;
};

export function getOpenAIWebOAuthAvailability(
  env: NodeJS.ProcessEnv = process.env,
): OpenAIWebOAuthAvailability {
  const configuredClientId =
    typeof env.OPENAI_OAUTH_CLIENT_ID === "string"
      ? env.OPENAI_OAUTH_CLIENT_ID.trim()
      : "";

  if (!configuredClientId) {
    return {
      available: false,
      clientId: null,
      reason:
        "OpenAI OAuth directo no está configurado en este despliegue. Usa Loguear ChatGPT para vincular tu cuenta sin redirecciones locales.",
    };
  }

  if (configuredClientId === OPENAI_CODEX_LOCAL_CLIENT_ID) {
    return {
      available: false,
      clientId: configuredClientId,
      reason:
        "OpenAI OAuth directo está usando el cliente local del runtime de OpenClaw y puede redirigir a localhost. Usa Loguear ChatGPT para completar la conexión desde ILIAGPT.",
    };
  }

  return {
    available: true,
    clientId: configuredClientId,
    reason: null,
  };
}

export function isGoogleGeminiDirectOAuthAvailable(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    typeof env.GOOGLE_CLIENT_ID === "string" &&
      env.GOOGLE_CLIENT_ID.trim() &&
      typeof env.GOOGLE_CLIENT_SECRET === "string" &&
      env.GOOGLE_CLIENT_SECRET.trim(),
  );
}
