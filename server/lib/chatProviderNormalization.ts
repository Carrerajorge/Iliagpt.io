import {
  normalizeModelProviderToRuntime,
  type ChatRuntimeProvider,
} from "../services/modelIntegration";

export type ChatRequestProvider =
  | ChatRuntimeProvider
  | "google-gemini-cli"
  | "openai-codex"
  | "google-antigravity"
  | "auto";

export function normalizeChatRequestProvider(
  provider: unknown,
): ChatRequestProvider | undefined {
  const raw = typeof provider === "string" ? provider.trim().toLowerCase() : "";
  if (!raw) return undefined;
  if (raw === "auto") return "auto";
  if (raw === "google-gemini-cli") return "google-gemini-cli";
  if (raw === "openai-codex") return "openai-codex";
  if (raw === "google-antigravity") return "google-antigravity";
  return normalizeModelProviderToRuntime(raw) ?? undefined;
}
