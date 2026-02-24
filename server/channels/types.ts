import { z } from "zod";

const MAX_RECEIVED_AT_LENGTH = 64;
const MAX_CHANNEL_META_ID_LENGTH = 255;
const MAX_INGEST_INPUT_BYTES = 256 * 1024;
const MAX_INGEST_ROOT_KEYS = 80;
export const MAX_INGEST_RUN_ID_LENGTH = 128;
export const INGEST_RUN_ID_RE = /^[A-Za-z0-9._:-]+$/;

export type ExternalChannel = "telegram" | "whatsapp_cloud" | "messenger" | "wechat";

export type ConversationKey = {
  workspaceId: string;
  channel: ExternalChannel;
  channelAccountId: string;
  threadId: string;
};

export type MessageEnvelope = {
  providerMessageId: string;
  channel: ExternalChannel;
  channelKey: string;
  threadId: string;
  senderId: string;
  recipientId?: string;
  conversationKey: ConversationKey;
  receivedAt: string;
  text: string;
  messageType: "text" | "image" | "audio" | "document" | "unsupported";
  media?: {
    providerAssetId?: string;
    fileName?: string;
    mimeType?: string;
    url?: string;
    raw?: unknown;
  };
  metadata: {
    rawPayload: unknown;
    [key: string]: unknown;
  };
};

export type ChannelIngestJob =
  | {
      channel: "telegram";
      update: unknown;
      receivedAt?: string;
    }
  | {
      channel: "whatsapp_cloud";
      payload: unknown;
      receivedAt?: string;
      whatsappMeta?: {
        accountPhoneNumberId: string;
      };
    }
  | {
      channel: "messenger";
      payload: unknown;
      receivedAt?: string;
      pageId?: string;
    }
  | {
      channel: "wechat";
      payload: unknown;
      receivedAt?: string;
      appId?: string;
    };

const BASE_INGEST_JOB = z.object({
  receivedAt: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(20).max(MAX_RECEIVED_AT_LENGTH).optional()),
  runId: z
    .preprocess(
      (v) => (typeof v === "string" ? v.trim().slice(0, MAX_INGEST_RUN_ID_LENGTH) : v),
      z.string().min(12).max(MAX_INGEST_RUN_ID_LENGTH).optional(),
    )
    .superRefine((value, ctx) => {
      if (value && !INGEST_RUN_ID_RE.test(value)) {
        ctx.addIssue({ code: "custom", message: "runId has invalid format", path: ["runId"] });
      }
    }),
});

const telegramIngestJobSchema = BASE_INGEST_JOB.extend({
  channel: z.literal("telegram"),
  update: z.unknown(),
});

const whatsappMetaSchema = z
  .object({
    accountPhoneNumberId: z
      .preprocess((v) => (typeof v === "string" ? v.trim().slice(0, MAX_CHANNEL_META_ID_LENGTH) : v), z.string().min(1).max(MAX_CHANNEL_META_ID_LENGTH)),
  })
  .passthrough();

const whatsappIngestJobSchema = BASE_INGEST_JOB.extend({
  channel: z.literal("whatsapp_cloud"),
  payload: z.unknown(),
  whatsappMeta: whatsappMetaSchema.optional(),
});

const messengerIngestJobSchema = BASE_INGEST_JOB.extend({
  channel: z.literal("messenger"),
  payload: z.unknown(),
  pageId: z
    .preprocess((value) => (typeof value === "string" ? value.trim().slice(0, MAX_CHANNEL_META_ID_LENGTH) : value), z
      .string()
      .min(1)
      .max(MAX_CHANNEL_META_ID_LENGTH))
    .optional(),
});

const wechatIngestJobSchema = BASE_INGEST_JOB.extend({
  channel: z.literal("wechat"),
  payload: z.unknown(),
  appId: z
    .preprocess((value) => (typeof value === "string" ? value.trim().slice(0, MAX_CHANNEL_META_ID_LENGTH) : value), z
      .string()
      .min(1)
      .max(MAX_CHANNEL_META_ID_LENGTH))
    .optional(),
});

export const channelIngestJobSchema = z.discriminatedUnion("channel", [
  telegramIngestJobSchema,
  whatsappIngestJobSchema,
  messengerIngestJobSchema,
  wechatIngestJobSchema,
]);

export type ChannelIngestJobValidationError = {
  path: string;
  message: string;
  code: string;
};

export type ChannelIngestJobValidationResult =
  | { ok: true; data: ChannelIngestJob }
  | { ok: false; errors: ChannelIngestJobValidationError[] };

function failValidation(path: string, message: string, code: string): ChannelIngestJobValidationResult {
  return {
    ok: false,
    errors: [{ path, message, code }],
  };
}

function estimateInputBytes(input: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(input), "utf8");
  } catch {
    return MAX_INGEST_INPUT_BYTES + 1;
  }
}

export function validateChannelIngestJob(input: unknown): ChannelIngestJobValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return failValidation("", "Invalid payload", "invalid_type");
  }

  const rootKeys = Object.keys(input as Record<string, unknown>);
  if (rootKeys.length > MAX_INGEST_ROOT_KEYS) {
    return failValidation("", "Payload contains too many root keys", "too_many_keys");
  }

  const estimatedBytes = estimateInputBytes(input);
  if (estimatedBytes > MAX_INGEST_INPUT_BYTES) {
    return failValidation("", "Payload too large", "payload_too_large");
  }

  const result = channelIngestJobSchema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }

  const issues = (result.error as any).errors || [];
  return {
    ok: false,
    errors: issues.map((issue: any) => ({
      path: Array.isArray(issue.path) ? issue.path.join(".") : "",
      message: issue.message || "Invalid payload",
      code: issue.code || "invalid",
    })),
  };
}
