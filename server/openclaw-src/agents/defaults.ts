function readDefaultEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// Defaults for agent metadata when upstream does not supply them.
// OpenClaw should align with the gateway's current default model unless an
// explicit runtime override is provided via OPENCLAW_DEFAULT_*.
export const DEFAULT_PROVIDER = readDefaultEnv("OPENCLAW_DEFAULT_PROVIDER") ?? "openrouter";
export const DEFAULT_MODEL =
  readDefaultEnv("OPENCLAW_DEFAULT_MODEL") ?? "moonshotai/kimi-k2.5";
// Conservative fallback used when model metadata is unavailable.
export const DEFAULT_CONTEXT_TOKENS = 200_000;
