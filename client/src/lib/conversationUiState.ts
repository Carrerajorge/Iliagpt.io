export interface ResolveConversationUiStateKeyOptions {
  requestedConversationId?: string | null;
  activeConversationId?: string | null;
  pendingConversationId?: string | null;
  draftConversationId?: string | null;
  existingConversationIds?: Iterable<string>;
  resolveConversationId?: (conversationId: string) => string;
}

function normalizeConversationId(conversationId?: string | null): string | null {
  if (typeof conversationId !== "string") return null;
  const normalized = conversationId.trim();
  return normalized.length > 0 ? normalized : null;
}

export function resolveConversationUiStateKey(
  options: ResolveConversationUiStateKeyOptions,
): string | null {
  const resolveConversationId = options.resolveConversationId ?? ((conversationId: string) => conversationId);
  const requestedConversationId = normalizeConversationId(options.requestedConversationId);
  const activeConversationId = normalizeConversationId(options.activeConversationId);
  const pendingConversationId = normalizeConversationId(options.pendingConversationId);
  const draftConversationId = normalizeConversationId(options.draftConversationId);
  const existingConversationIds = Array.from(options.existingConversationIds ?? [])
    .map((conversationId) => normalizeConversationId(conversationId))
    .filter((conversationId): conversationId is string => Boolean(conversationId));

  const findMatchingExistingConversationId = (targetConversationId: string): string | null => {
    if (existingConversationIds.includes(targetConversationId)) {
      return targetConversationId;
    }

    const resolvedTargetConversationId = resolveConversationId(targetConversationId);
    const matchingConversationId = existingConversationIds.find(
      (conversationId) => resolveConversationId(conversationId) === resolvedTargetConversationId,
    );

    return matchingConversationId ?? null;
  };

  if (requestedConversationId) {
    const exactOrResolvedMatch =
      (activeConversationId && resolveConversationId(activeConversationId) === resolveConversationId(requestedConversationId)
        ? activeConversationId
        : null) ||
      (pendingConversationId && resolveConversationId(pendingConversationId) === resolveConversationId(requestedConversationId)
        ? pendingConversationId
        : null) ||
      (draftConversationId && resolveConversationId(draftConversationId) === resolveConversationId(requestedConversationId)
        ? draftConversationId
        : null) ||
      findMatchingExistingConversationId(requestedConversationId);

    return exactOrResolvedMatch || requestedConversationId;
  }

  return (
    activeConversationId ||
    pendingConversationId ||
    draftConversationId ||
    existingConversationIds[0] ||
    null
  );
}
