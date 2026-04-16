const CHANNEL_META = {
  webchat: { label: "Web Chat", aliases: ["web", "chat"], preferOver: [] },
  slack: { label: "Slack", aliases: [], preferOver: [] },
  discord: { label: "Discord", aliases: [], preferOver: [] },
  telegram: { label: "Telegram", aliases: [], preferOver: [] },
  signal: { label: "Signal", aliases: [], preferOver: [] },
  whatsapp: { label: "WhatsApp", aliases: ["wa"], preferOver: [] },
  googlechat: { label: "Google Chat", aliases: ["gchat"], preferOver: [] },
  sms: { label: "SMS", aliases: ["text"], preferOver: [] },
  email: { label: "Email", aliases: ["mail"], preferOver: [] },
  tui: { label: "Terminal UI", aliases: ["cli"], preferOver: [] },
} as const;

export const CHANNEL_IDS = Object.keys(CHANNEL_META) as Array<keyof typeof CHANNEL_META>;
export const CHAT_CHANNEL_ORDER = [...CHANNEL_IDS];

const CHANNEL_ALIAS_TO_ID = new Map<string, keyof typeof CHANNEL_META>(
  CHANNEL_IDS.flatMap((id) => [
    [id, id],
    ...CHANNEL_META[id].aliases.map((alias) => [alias, id] as const),
  ]),
);

export function normalizeChatChannelId(raw?: string | null): (typeof CHANNEL_IDS)[number] | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) return undefined;
  return CHANNEL_ALIAS_TO_ID.get(normalized);
}

export const normalizeChannelId = normalizeChatChannelId;

export function listChatChannelAliases(): string[] {
  return Array.from(
    new Set(CHANNEL_IDS.flatMap((id) => [id, ...CHANNEL_META[id].aliases])),
  );
}

export function getChatChannelMeta(id: (typeof CHANNEL_IDS)[number]) {
  return CHANNEL_META[id];
}
