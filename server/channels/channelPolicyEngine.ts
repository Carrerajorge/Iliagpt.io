import { createHash } from "crypto";

import type { ChannelConversation } from "@shared/schema/channels";
import type { ChannelRuntimeConfig } from "./runtimeConfig";
import type { ExternalChannel, MessageEnvelope } from "./types";

export type ChannelPolicyDecisionCode =
  | "ok"
  | "off_for_owner_only"
  | "outside_window"
  | "rate_limited"
  | "blocked_sender"
  | "disabled"
  | "invalid_payload";

export type ChannelPolicyDecision = {
  allowed: boolean;
  code: ChannelPolicyDecisionCode;
  replyText: string;
  policyTraceId?: string;
  requiresTemplate?: boolean;
  requiresOwnerHandshake?: boolean;
  shouldRespond?: boolean;
  throttleUntilIso?: string;
};

export type ResultOk<T> = {
  ok: true;
  data: T;
};

export type ResultErr<T> = {
  ok: false;
  error: ChannelPolicyDecisionCode;
  data: T;
};

export type ChannelPolicyResult = ResultOk<ChannelPolicyDecision> | ResultErr<ChannelPolicyDecision>;

type ChannelPolicyProfile = {
  windowMs: number;
  templateRequired: boolean;
  canUseOtnTags: boolean;
};

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const CHANNEL_POLICY_PROFILE: Record<ExternalChannel, ChannelPolicyProfile> = {
  whatsapp_cloud: {
    windowMs: DEFAULT_WINDOW_MS,
    templateRequired: true,
    canUseOtnTags: false,
  },
  messenger: {
    windowMs: DEFAULT_WINDOW_MS,
    templateRequired: true,
    canUseOtnTags: true,
  },
  wechat: {
    windowMs: 12 * 60 * 60 * 1000,
    templateRequired: false,
    canUseOtnTags: false,
  },
  telegram: {
    windowMs: 0,
    templateRequired: false,
    canUseOtnTags: false,
  },
};
const MAX_RATE_LIMIT_PER_MINUTE = 120;
const MAX_IDENTITY_LIST_SIZE = 64;
const MAX_IDENTITY_TEXT_LENGTH = 120;
const MAX_POLICY_ID_TEXT_LENGTH = 160;
const MAX_PAIRING_CODE_LENGTH = 16;
const MAX_OWNER_SET_SIZE = 128;
const SAFE_CHANNEL_ID_RE = /^[A-Za-z0-9._:@+\-]+$/;
const SAFE_WORKSPACE_ID_RE = /^workspace:[A-Za-z0-9._:@+\-]+$/;
const MAX_POLICY_MESSAGE_LENGTH = 320;

function enforcePolicyText(value: unknown, fallback: string): string {
  return String(value ?? fallback)
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, MAX_POLICY_MESSAGE_LENGTH);
}

function channelProfile(channel: MessageEnvelope["channel"]): ChannelPolicyProfile {
  return CHANNEL_POLICY_PROFILE[channel] ?? CHANNEL_POLICY_PROFILE.telegram;
}

function normalizeIdentity(value: unknown, maxLength = MAX_IDENTITY_TEXT_LENGTH): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, maxLength);
}

function normalizeIdentityStrict(value: unknown, maxLength = MAX_POLICY_ID_TEXT_LENGTH): string {
  const normalized = normalizeIdentity(value, maxLength);
  if (!normalized || !SAFE_CHANNEL_ID_RE.test(normalized)) return "";
  return normalized;
}

export function parseChannelPairingCodeFromMessage(text: string): string | null {
  if (!text || typeof text !== "string") return null;
  const normalized = text.normalize("NFKC").toUpperCase().trim();
  if (normalized.length > MAX_PAIRING_CODE_LENGTH) return null;
  if (!normalized) return null;

  const directStart = /^\/(?:start|code)\s+([A-Z0-9]{6,12})$/i.exec(normalized);
  if (directStart) return directStart[1].toUpperCase();

  const regexes = [
    /^code\s*[:#]?\s*([A-Z0-9]{6,12})$/i,
    /^pair\s*[:#]?\s*([A-Z0-9]{6,12})$/i,
    /^alia\s+pair\s*[:#]?\s*([A-Z0-9]{6,12})$/i,
    /^token\s*[:#]?\s*([A-Z0-9]{6,12})$/i,
  ];

  for (const re of regexes) {
    const m = re.exec(normalized);
    if (m) return m[1]?.toUpperCase() ?? null;
  }

  return null;
}

function parseDateMs(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    const ms = value < 1e12 ? value * 1000 : value;
    return ms > 0 ? ms : 0;
  }

  if (typeof value !== "string") return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStringSet(values: unknown): Set<string> {
  if (!Array.isArray(values)) return new Set<string>();
  if (values.length > MAX_IDENTITY_LIST_SIZE) {
    return new Set(
      values
        .slice(0, MAX_IDENTITY_LIST_SIZE)
        .map((value) => normalizeIdentity(value, MAX_IDENTITY_TEXT_LENGTH))
        .filter((value) => value.length > 0),
    );
  }
  return new Set(
    values
      .map((value) => normalizeIdentity(value, MAX_IDENTITY_TEXT_LENGTH))
      .filter((value) => value.length > 0),
  );
}

function addOwnerIdCandidate(target: Set<string>, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      addOwnerIdCandidate(target, item);
    }
    return;
  }

  const candidate = normalizeIdentityStrict(value);
  if (candidate.length > 0) target.add(candidate);
}

function collectOwnerExternalIds(values: unknown): Set<string> {
  if (!Array.isArray(values)) return new Set<string>();
  return new Set(values.slice(0, MAX_OWNER_SET_SIZE).map((value) => normalizeIdentityStrict(value)).filter(Boolean));
}

function addOwnerIdCandidatesFromObject(target: Set<string>, value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const raw = value as Record<string, unknown>;

  addOwnerIdCandidate(target, raw.ownerExternalId);
  addOwnerIdCandidate(target, raw.ownerId);
  addOwnerIdCandidate(target, raw.owner_external_ids);
  addOwnerIdCandidate(target, raw.owner_external_id);
  addOwnerIdCandidate(target, raw.owners);
}

function getMetadataObject(conversation: ChannelConversation): Record<string, unknown> {
  if (conversation && typeof conversation.metadata === "object" && conversation.metadata !== null) {
    return conversation.metadata as Record<string, unknown>;
  }
  return {};
}

function getPolicyMap(conversation: ChannelConversation): Record<string, unknown> {
  const metadata = getMetadataObject(conversation);
  const raw = metadata.policy;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function getOwnerIdentityCandidatesFromMetadata(conversation: ChannelConversation): Set<string> {
  const metadata = getMetadataObject(conversation);
  const out = new Set<string>();

  addOwnerIdCandidatesFromObject(out, metadata.ownerIdentity);
  addOwnerIdCandidatesFromObject(out, getPolicyMap(conversation).ownerIdentity);

  const runtime = metadata.runtime;
  addOwnerIdCandidate(out, runtime && typeof runtime === "object" && !Array.isArray(runtime)
    ? (runtime as Record<string, unknown>).owner_external_ids
    : undefined);

  return out;
}

export function getConversationOwnerIds(conversation: ChannelConversation): string[] {
  const out = getOwnerIdentityCandidatesFromMetadata(conversation);
  return Array.from(out).sort();
}

function conversationOwnerCandidates(
  runtimeConfig: ChannelRuntimeConfig,
  conversation: ChannelConversation,
): Set<string> {
  const out = new Set<string>(Array.from(toStringSet(runtimeConfig.owner_external_ids)).map((value) => normalizeIdentityStrict(value)));
  addOwnerIdCandidate(out, getPolicyMap(conversation).owner_external_ids);
  addOwnerIdCandidate(out, runtimeConfig.owner_external_ids);
  for (const value of collectOwnerExternalIds(runtimeConfig.owner_external_ids)) {
    out.add(value);
  }

  for (const owner of getConversationOwnerIds(conversation)) {
    const normalized = normalizeIdentityStrict(owner);
    if (normalized) out.add(normalized);
  }

  return out;
}

function normalizeWindowRecoveryMessage(channel: MessageEnvelope["channel"]): string {
  if (channel === "whatsapp_cloud") {
    return enforcePolicyText(
      "La conversación de WhatsApp está fuera de la ventana activa (24h). Pide al usuario que escriba de nuevo; solo puedo responder con plantilla aprobada.",
      "La conversación está fuera de ventana. Reabre el chat y usa plantilla aprobada.",
    );
  }

  if (channel === "messenger") {
    return enforcePolicyText(
      "Esta conversación de Messenger está fuera de la ventana activa. Usa un mensaje con etiqueta/OTN o plantilla aprobada para reabrir el chat.",
      "Esta conversación está fuera de la ventana de Messenger.",
    );
  }

  return enforcePolicyText(
    "Esta conversación de WeChat está fuera de la ventana de servicio. El contacto debe escribir de nuevo para reabrir el canal.",
    "Esta conversación está fuera de ventana.",
  );
}

function normalizeOwnerBlockMessage(channel: MessageEnvelope["channel"]): string {
  if (channel === "whatsapp_cloud") {
    return enforcePolicyText(
      "No puedo responder aquí ahora mismo. Envía el código de vinculación recibido desde la app para habilitar este canal.",
      "No puedo responder aquí. Envía el código de vinculación.",
    );
  }
  return enforcePolicyText(
    "No se procesa este mensaje porque el auto-reply está desactivado para este chat.",
    "Auto-reply desactivado para este chat.",
  );
}

function normalizePayloadErrorMessage(): string {
  return enforcePolicyText(
    "Evento no procesable. Verifica que el mensaje contenga un identificador válido.",
    "Evento no procesable.",
  );
}

function normalizeBlockedSenderMessage(): string {
  return enforcePolicyText("Mensaje bloqueado por configuración de seguridad del canal.", "Mensaje bloqueado por configuración.");
}

export type ChannelPolicyContext = {
  conversation: ChannelConversation;
  envelope: MessageEnvelope;
  runtimeConfig: ChannelRuntimeConfig;
  globalResponderEnabled: boolean;
  senderIsOwner?: boolean;
};

export type ChannelWindowState = {
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
};

function buildPolicyTraceId(context: ChannelPolicyContext, code: ChannelPolicyDecisionCode): string {
  const canonical = `${context.envelope.channel}|${context.envelope.senderId}|${context.envelope.providerMessageId}|${code}|${context.envelope.threadId}`;
  return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}

export function getConversationWindowState(conversation: ChannelConversation): ChannelWindowState {
  const metadata = getMetadataObject(conversation);
  return {
    lastInboundAt: typeof metadata.lastInboundAt === "string" ? metadata.lastInboundAt : null,
    lastOutboundAt: typeof metadata.lastOutboundAt === "string" ? metadata.lastOutboundAt : null,
  };
}

export function getConversationPolicy(conversation: ChannelConversation): {
  autoResponderEnabled: boolean | null;
  ownerOnly: boolean;
  ownerExternalIds: string[];
  rateLimitPerMinute: number;
} {
  const policy = getPolicyMap(conversation);

  const autoResponderEnabled =
    typeof policy.autoResponderEnabled === "boolean"
      ? policy.autoResponderEnabled
      : typeof policy.auto_responder_enabled === "boolean"
        ? policy.auto_responder_enabled
        : typeof policy.enabled === "boolean"
          ? policy.enabled
          : null;

  const ownerOnly =
    typeof policy.ownerOnly === "boolean"
      ? policy.ownerOnly
      : typeof policy.owner_only === "boolean"
        ? policy.owner_only
        : false;

  const ownerExternalIds = collectOwnerExternalIds(
    policy.owner_external_ids ??
      policy.ownerExternalIds ??
      policy.owner_ids ??
      policy.owners ??
      policy.owner_ids,
  );

  const rate = Number(
    policy.rateLimitPerMinute ??
      policy.rateLimit ??
      policy.rate_limit_per_minute ??
      policy.rate_limit,
  );
  const rateLimitPerMinute = Number.isFinite(rate) && rate > 0
    ? Math.min(Math.floor(rate), MAX_RATE_LIMIT_PER_MINUTE)
    : 6;

  return {
    autoResponderEnabled,
    ownerOnly,
    ownerExternalIds: Array.from(ownerExternalIds),
    rateLimitPerMinute,
  };
}

function nowWithinWindow(channel: MessageEnvelope["channel"], lastTs: number, now: number): boolean {
  const windowMs = channelProfile(channel).windowMs;
  if (windowMs <= 0) return true;
  if (!lastTs) return true;
  return now - lastTs <= windowMs;
}

export function evaluateChannelPolicy(
  context: ChannelPolicyContext,
  windowState: ChannelWindowState,
  rateControl?: { allowed: boolean; retryAfterIso?: string },
): ChannelPolicyResult {
  if (context.envelope.conversationKey.channel !== context.envelope.channel) {
    return {
      ok: false,
      error: "invalid_payload",
      data: {
        allowed: false,
        code: "invalid_payload",
        replyText: normalizePayloadErrorMessage(),
        policyTraceId: buildPolicyTraceId(context, "invalid_payload"),
        requiresOwnerHandshake: true,
        shouldRespond: false,
      },
    };
  }

  if (
    !context.envelope.providerMessageId ||
    !context.envelope.senderId ||
    !context.envelope.channelKey ||
    !context.envelope.threadId ||
    !context.envelope.conversationKey.workspaceId ||
    !context.envelope.conversationKey.channelAccountId ||
    !context.envelope.conversationKey.threadId
  ) {
    return {
      ok: false,
      error: "invalid_payload",
      data: {
        allowed: false,
        code: "invalid_payload",
        replyText: normalizePayloadErrorMessage(),
        policyTraceId: buildPolicyTraceId(context, "invalid_payload"),
        requiresOwnerHandshake: true,
        shouldRespond: false,
      },
    };
  }

  if (context.envelope.conversationKey.threadId !== context.envelope.threadId) {
    return {
      ok: false,
      error: "invalid_payload",
      data: {
        allowed: false,
        code: "invalid_payload",
        replyText: normalizePayloadErrorMessage(),
        policyTraceId: buildPolicyTraceId(context, "invalid_payload"),
        requiresOwnerHandshake: false,
        shouldRespond: false,
      },
    };
  }

  if (context.envelope.conversationKey.channelAccountId !== context.envelope.channelKey) {
    return {
      ok: false,
      error: "invalid_payload",
      data: {
        allowed: false,
        code: "invalid_payload",
        replyText: normalizePayloadErrorMessage(),
        policyTraceId: buildPolicyTraceId(context, "invalid_payload"),
        requiresOwnerHandshake: false,
        shouldRespond: false,
      },
    };
  }

  if (!SAFE_WORKSPACE_ID_RE.test(context.envelope.conversationKey.workspaceId)) {
    return {
      ok: false,
      error: "invalid_payload",
      data: {
        allowed: false,
        code: "invalid_payload",
        replyText: normalizePayloadErrorMessage(),
        policyTraceId: buildPolicyTraceId(context, "invalid_payload"),
        requiresOwnerHandshake: false,
        shouldRespond: false,
      },
    };
  }

  const normalizedSender = normalizeIdentityStrict(context.envelope.senderId);
  if (!normalizedSender) {
    return {
      ok: false,
      error: "invalid_payload",
      data: {
        allowed: false,
        code: "invalid_payload",
        replyText: normalizePayloadErrorMessage(),
        policyTraceId: buildPolicyTraceId(context, "invalid_payload"),
        requiresOwnerHandshake: false,
        shouldRespond: false,
      },
    };
  }

  const allowlist = toStringSet(context.runtimeConfig.allowlist);
  const normalizedAllowlist = new Set(Array.from(allowlist).map((value) => normalizeIdentityStrict(value)));
  if (normalizedAllowlist.size > 0 && !normalizedAllowlist.has(normalizedSender)) {
    return {
      ok: false,
      error: "blocked_sender",
      data: {
        allowed: false,
        code: "blocked_sender",
        replyText: normalizeBlockedSenderMessage(),
        policyTraceId: buildPolicyTraceId(context, "blocked_sender"),
        requiresOwnerHandshake: false,
        shouldRespond: false,
      },
    };
  }

  if (rateControl && !rateControl.allowed) {
    return {
      ok: false,
      error: "rate_limited",
      data: {
        allowed: false,
        code: "rate_limited",
        replyText: enforcePolicyText(
          "Has enviado mensajes muy rápido. Espera un momento y vuelve a intentarlo.",
          "Espera un momento y vuelve a intentarlo.",
        ),
        policyTraceId: buildPolicyTraceId(context, "rate_limited"),
        requiresOwnerHandshake: true,
        shouldRespond: false,
        throttleUntilIso: rateControl.retryAfterIso,
      },
    };
  }

  const conversationPolicy = getPolicyMap(context.conversation);
  const ownerCandidates = conversationOwnerCandidates(context.runtimeConfig, context.conversation);
  const isOwner = ownerCandidates.size > 0
    ? ownerCandidates.has(normalizedSender)
    : Boolean(context.senderIsOwner);

  const ownerOnly = typeof conversationPolicy.ownerOnly === "boolean"
    ? conversationPolicy.ownerOnly
    : Boolean(context.runtimeConfig.owner_only);

  const conversationPolicyEnabled =
    typeof conversationPolicy.autoResponderEnabled === "boolean"
      ? conversationPolicy.autoResponderEnabled
      : context.globalResponderEnabled;

  if (!conversationPolicyEnabled && !isOwner) {
    return {
      ok: false,
      error: "off_for_owner_only",
      data: {
        allowed: false,
        code: "off_for_owner_only",
        replyText: normalizeOwnerBlockMessage(context.envelope.channel),
        policyTraceId: buildPolicyTraceId(context, "off_for_owner_only"),
        requiresOwnerHandshake: true,
        shouldRespond: false,
      },
    };
  }

  if (ownerOnly && !isOwner) {
    return {
      ok: false,
      error: "off_for_owner_only",
      data: {
        allowed: false,
        code: "off_for_owner_only",
        replyText: enforcePolicyText(
          "Este chat está configurado para solo propietario. Envía el código del chat desde el panel para habilitar respuestas automáticas.",
          "Este chat está bloqueado para auto-reply.",
        ),
        policyTraceId: buildPolicyTraceId(context, "off_for_owner_only"),
        requiresOwnerHandshake: true,
        shouldRespond: false,
      },
    };
  }

  const latestTs = Math.max(
    parseDateMs(windowState.lastInboundAt),
    parseDateMs(windowState.lastOutboundAt),
  );

  if (!nowWithinWindow(context.envelope.channel, latestTs, Date.now())) {
    const profile = channelProfile(context.envelope.channel);
    return {
      ok: false,
      error: "outside_window",
      data: {
        allowed: false,
        code: "outside_window",
        replyText: normalizeWindowRecoveryMessage(context.envelope.channel),
        requiresTemplate: profile.templateRequired,
        policyTraceId: buildPolicyTraceId(context, "outside_window"),
        requiresOwnerHandshake: isOwner,
        shouldRespond: true,
      },
    };
  }

  return {
    ok: true,
    data: {
      allowed: true,
      code: "ok",
      replyText: "",
      policyTraceId: buildPolicyTraceId(context, "ok"),
      shouldRespond: true,
    },
  };
}
