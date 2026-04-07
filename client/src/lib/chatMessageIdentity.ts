import type { Message } from "@/hooks/use-chats";

type MessageLike = Partial<
  Pick<
    Message,
    | "id"
    | "clientTempId"
    | "requestId"
    | "clientRequestId"
    | "deliveryStatus"
    | "deliveryError"
    | "timestamp"
    | "userMessageId"
  >
> & Record<string, any>;

const DELIVERY_STATUS_PRIORITY: Record<NonNullable<Message["deliveryStatus"]>, number> = {
  error: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
};

const TEMP_ID_PREFIXES = [
  "__streaming__",
  "temp-",
  "user-",
  "assistant-",
  "error-",
  "analysis-",
  "super-agent-",
  "agent-",
  "pending-",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLikelyTemporaryId(id?: string | null, clientTempId?: string | null): boolean {
  if (!id) return true;
  if (clientTempId && id === clientTempId) return true;
  return TEMP_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function messageIdScore(message: MessageLike): number {
  const id = typeof message.id === "string" ? message.id : "";
  const clientTempId = typeof message.clientTempId === "string" ? message.clientTempId : "";
  if (!id) return -1;
  if (isLikelyTemporaryId(id, clientTempId)) return 0;
  return 1;
}

function pickCanonicalId(existing: MessageLike, incoming: MessageLike): string | undefined {
  const existingId = typeof existing.id === "string" ? existing.id : undefined;
  const incomingId = typeof incoming.id === "string" ? incoming.id : undefined;
  const existingScore = messageIdScore(existing);
  const incomingScore = messageIdScore(incoming);

  if (incomingScore > existingScore) return incomingId;
  if (existingScore > incomingScore) return existingId;
  return incomingId || existingId;
}

function pickDeliveryStatus(
  existing?: Message["deliveryStatus"],
  incoming?: Message["deliveryStatus"],
): Message["deliveryStatus"] | undefined {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return DELIVERY_STATUS_PRIORITY[incoming] >= DELIVERY_STATUS_PRIORITY[existing] ? incoming : existing;
}

function toTimestampMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

function pickTimestamp<T extends MessageLike>(existing: T, incoming: T): T["timestamp"] | undefined {
  const existingMs = toTimestampMs(existing.timestamp);
  const incomingMs = toTimestampMs(incoming.timestamp);
  if (!Number.isFinite(existingMs)) return incoming.timestamp as T["timestamp"];
  if (!Number.isFinite(incomingMs)) return existing.timestamp as T["timestamp"];
  return (incomingMs < existingMs ? incoming.timestamp : existing.timestamp) as T["timestamp"];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function areConsecutiveAssistantDuplicates(a: MessageLike, b: MessageLike): boolean {
  if (a.role !== "assistant" || b.role !== "assistant") return false;

  const aContent = normalizeMessageContentForDedup(a.content);
  const bContent = normalizeMessageContentForDedup(b.content);
  if (!aContent || aContent !== bContent) return false;

  const aUserMessageId = typeof a.userMessageId === "string" ? a.userMessageId.trim() : "";
  const bUserMessageId = typeof b.userMessageId === "string" ? b.userMessageId.trim() : "";
  if (aUserMessageId && bUserMessageId && aUserMessageId !== bUserMessageId) {
    return false;
  }

  return true;
}

export function listMessageIdentityKeys(message: MessageLike): string[] {
  return uniqueStrings([
    typeof message.id === "string" ? message.id : undefined,
    typeof message.clientTempId === "string" ? message.clientTempId : undefined,
    typeof message.requestId === "string" ? message.requestId : undefined,
    typeof message.clientRequestId === "string" ? message.clientRequestId : undefined,
  ]);
}

export function mergeMessagesByIdentity<T extends MessageLike>(existing: T, incoming: T): T {
  const deliveryStatus = pickDeliveryStatus(existing.deliveryStatus, incoming.deliveryStatus);
  const merged = {
    ...existing,
    ...incoming,
    id: pickCanonicalId(existing, incoming),
    clientTempId:
      (typeof existing.clientTempId === "string" && existing.clientTempId) ||
      (typeof incoming.clientTempId === "string" && incoming.clientTempId) ||
      undefined,
    requestId:
      (typeof existing.requestId === "string" && existing.requestId) ||
      (typeof incoming.requestId === "string" && incoming.requestId) ||
      undefined,
    clientRequestId:
      (typeof existing.clientRequestId === "string" && existing.clientRequestId) ||
      (typeof incoming.clientRequestId === "string" && incoming.clientRequestId) ||
      undefined,
    deliveryStatus,
    deliveryError:
      deliveryStatus === "error"
        ? incoming.deliveryError || existing.deliveryError
        : undefined,
    timestamp: pickTimestamp(existing, incoming),
  } as T;

  return merged;
}

export function messagesShareIdentity(a: MessageLike, b: MessageLike): boolean {
  const aRequestId = typeof a.requestId === "string" ? a.requestId.trim() : "";
  const bRequestId = typeof b.requestId === "string" ? b.requestId.trim() : "";
  if (aRequestId && aRequestId === bRequestId) return true;

  const aUserMessageId = typeof a.userMessageId === "string" ? a.userMessageId.trim() : "";
  const bUserMessageId = typeof b.userMessageId === "string" ? b.userMessageId.trim() : "";
  if (
    a.role === "assistant" &&
    b.role === "assistant" &&
    aUserMessageId &&
    aUserMessageId === bUserMessageId
  ) {
    const aContent = normalizeMessageContentForDedup(a.content);
    const bContent = normalizeMessageContentForDedup(b.content);
    if (aContent && aContent === bContent) return true;
  }

  const aKeys = listMessageIdentityKeys(a);
  if (aKeys.length === 0) return false;
  const bKeys = new Set(listMessageIdentityKeys(b));
  return aKeys.some((key) => bKeys.has(key));
}

export function dedupeMessagesByIdentity<T extends MessageLike>(messages: T[]): T[] {
  type Group = {
    message: T;
    firstIndex: number;
    aliases: Set<string>;
    deleted?: boolean;
  };

  const groups: Group[] = [];
  const keyToGroup = new Map<string, number>();

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const keys = listMessageIdentityKeys(message);
    let matchingIndexes = Array.from(
      new Set(
        keys
          .map((key) => keyToGroup.get(key))
          .filter((value): value is number => typeof value === "number")
      )
    ).filter((groupIndex) => !groups[groupIndex]?.deleted);

    if (matchingIndexes.length === 0) {
      matchingIndexes = groups
        .map((group, groupIndex) => ({ group, groupIndex }))
        .filter(({ group }) => !group.deleted && messagesShareIdentity(group.message, message))
        .map(({ groupIndex }) => groupIndex);
    }

    if (matchingIndexes.length === 0) {
      const nextGroupIndex = groups.length;
      groups.push({
        message,
        firstIndex: index,
        aliases: new Set(keys),
      });
      for (const key of keys) {
        keyToGroup.set(key, nextGroupIndex);
      }
      continue;
    }

    const primaryIndex = matchingIndexes[0];
    const primaryGroup = groups[primaryIndex];

    for (const duplicateIndex of matchingIndexes.slice(1)) {
      const duplicateGroup = groups[duplicateIndex];
      if (!duplicateGroup || duplicateGroup.deleted) continue;
      primaryGroup.message = mergeMessagesByIdentity(primaryGroup.message, duplicateGroup.message);
      primaryGroup.firstIndex = Math.min(primaryGroup.firstIndex, duplicateGroup.firstIndex);
      for (const alias of duplicateGroup.aliases) {
        primaryGroup.aliases.add(alias);
      }
      duplicateGroup.deleted = true;
    }

    primaryGroup.message = mergeMessagesByIdentity(primaryGroup.message, message);
    for (const alias of keys) {
      primaryGroup.aliases.add(alias);
    }
    for (const alias of listMessageIdentityKeys(primaryGroup.message)) {
      primaryGroup.aliases.add(alias);
    }
    for (const alias of primaryGroup.aliases) {
      keyToGroup.set(alias, primaryIndex);
    }
  }

  const activeGroups = groups.filter((group) => !group.deleted);
  const aliasToCanonicalId = new Map<string, string>();

  for (const group of activeGroups) {
    const canonicalId =
      (typeof group.message.id === "string" && group.message.id) ||
      (typeof group.message.clientTempId === "string" && group.message.clientTempId) ||
      undefined;
    if (!canonicalId) continue;
    for (const alias of group.aliases) {
      aliasToCanonicalId.set(alias, canonicalId);
    }
  }

  return activeGroups
    .sort((a, b) => a.firstIndex - b.firstIndex)
    .map((group) => {
      const nextUserMessageId =
        typeof group.message.userMessageId === "string"
          ? aliasToCanonicalId.get(group.message.userMessageId) || group.message.userMessageId
          : group.message.userMessageId;
      if (nextUserMessageId === group.message.userMessageId) {
        return group.message;
      }
      return {
        ...group.message,
        userMessageId: nextUserMessageId,
      };
    });
}

export function upsertMessageByIdentity<T extends MessageLike>(messages: T[], nextMessage: T): T[] {
  return dedupeMessagesByIdentity([...messages, nextMessage]);
}

export function collectMessageIdentitySet(messages: Array<MessageLike>): Set<string> {
  const values = new Set<string>();
  for (const message of messages) {
    for (const key of listMessageIdentityKeys(message)) {
      values.add(key);
    }
  }
  return values;
}

export function normalizeMessageContentForDedup(content: unknown): string {
  if (typeof content !== "string") return "";
  return content.replace(/\s+/g, " ").trim();
}

export function areRenderableDuplicates(a: MessageLike, b: MessageLike): boolean {
  if (messagesShareIdentity(a, b)) return true;
  if (a.role !== b.role) return false;
  const aContent = normalizeMessageContentForDedup(a.content);
  const bContent = normalizeMessageContentForDedup(b.content);
  if (!aContent || aContent !== bContent) return false;

  const aMs = toTimestampMs(a.timestamp);
  const bMs = toTimestampMs(b.timestamp);
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return false;

  const diffMs = Math.abs(aMs - bMs);
  const windowMs = a.role === "assistant" ? 5000 : 1000;
  return diffMs <= windowMs;
}

export function dedupeRenderableMessages<T extends MessageLike>(messages: T[]): T[] {
  const deduped: T[] = [];
  for (const message of messages) {
    const previousMessage = deduped[deduped.length - 1];
    if (previousMessage && areConsecutiveAssistantDuplicates(previousMessage, message)) {
      deduped[deduped.length - 1] = mergeMessagesByIdentity(previousMessage, message);
      continue;
    }

    const existingIndex = deduped.findIndex((candidate) => areRenderableDuplicates(candidate, message));
    if (existingIndex === -1) {
      deduped.push(message);
      continue;
    }
    deduped[existingIndex] = mergeMessagesByIdentity(deduped[existingIndex], message);
  }
  return deduped;
}

export function isMessageMetadata(value: unknown): value is Record<string, unknown> {
  return isObject(value);
}
