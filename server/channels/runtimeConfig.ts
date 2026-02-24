import { z } from "zod";

const OWNER_IDENTIFIER_RE = /^[A-Za-z0-9._:@+\-]+$/;
const MAX_RUNTIME_CONFIG_TEXT_LENGTH = 800;
const MAX_RUNTIME_OWNER_ID_LENGTH = 120;
const MAX_RUNTIME_OWNER_LIST_LENGTH = 128;

const safeRuntimeText = (value: unknown): string => String(value ?? "")
  .normalize("NFKC")
  .replace(/\u0000/g, "")
  .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
  .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
  .trim()
  .slice(0, MAX_RUNTIME_CONFIG_TEXT_LENGTH);

export const channelRuntimeConfigSchema = z.object({
  responder_enabled: z.boolean().optional(),
  owner_only: z.boolean().optional(),
  owner_external_ids: z.array(
    z.preprocess(
      (raw) => safeRuntimeText(raw).toLowerCase(),
      z.string().min(1).max(MAX_RUNTIME_OWNER_ID_LENGTH).regex(OWNER_IDENTIFIER_RE),
    ),
  )
    .max(MAX_RUNTIME_OWNER_LIST_LENGTH)
    .optional(),
  response_style: z.enum(["default", "concise", "friendly", "professional", "custom"]).optional(),
  custom_prompt: z.preprocess(
    (raw) => safeRuntimeText(raw),
    z.string().max(MAX_RUNTIME_CONFIG_TEXT_LENGTH).optional(),
  ),
  allowlist: z.array(
    z.preprocess(
      (raw) => safeRuntimeText(raw),
      z.string().min(1).max(MAX_RUNTIME_OWNER_ID_LENGTH).regex(OWNER_IDENTIFIER_RE),
    ),
  )
    .max(MAX_RUNTIME_OWNER_LIST_LENGTH)
    .optional(),
  rate_limit_per_minute: z.number().int().min(1).max(120).optional(),
});

export type ChannelRuntimeConfig = z.infer<typeof channelRuntimeConfigSchema>;

export const DEFAULT_CHANNEL_RUNTIME_CONFIG: Required<Pick<ChannelRuntimeConfig, "responder_enabled" | "owner_only" | "response_style" | "rate_limit_per_minute">> & {
  custom_prompt?: string;
  allowlist?: string[];
  owner_external_ids?: string[];
} = {
  responder_enabled: false,
  owner_only: false,
  response_style: "default",
  rate_limit_per_minute: 6,
};

export function parseRuntimeConfig(raw: unknown): ChannelRuntimeConfig {
  const parsed = channelRuntimeConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

export function resolveRuntimeConfig(metadata: unknown): typeof DEFAULT_CHANNEL_RUNTIME_CONFIG {
  const base = DEFAULT_CHANNEL_RUNTIME_CONFIG;
  const parsed = parseRuntimeConfig((metadata as any)?.runtime ?? metadata ?? {});
  return {
    ...base,
    ...parsed,
  };
}

export function isSenderAllowedByPolicy(config: ReturnType<typeof resolveRuntimeConfig>, senderId: string): boolean {
  if (config.owner_only) {
    const owners = (config.owner_external_ids ?? []).map(String);
    if (!owners.includes(senderId)) return false;
  }

  const allow = (config.allowlist ?? []).map(String);
  if (allow.length > 0 && !allow.includes(senderId)) return false;

  return true;
}

export function buildResponseStyleSystemPrompt(config: ReturnType<typeof resolveRuntimeConfig>, channelLabel: string): string | null {
  if (config.response_style === "custom" && config.custom_prompt?.trim()) {
    return config.custom_prompt.trim();
  }

  switch (config.response_style) {
    case "concise":
      return `Responde de forma muy breve y clara por ${channelLabel}.`;
    case "friendly":
      return `Responde de forma cálida y amigable por ${channelLabel}, sin perder precisión.`;
    case "professional":
      return `Responde con tono profesional y directo por ${channelLabel}.`;
    default:
      return null;
  }
}
