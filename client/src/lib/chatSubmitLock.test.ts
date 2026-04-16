import { beforeEach, describe, expect, it } from "vitest";

import {
  SUBMIT_LOCK_TTL_MS,
  clearSubmitLock,
  isSubmitLocked,
  normalizeSubmitLockScope,
  resolveScopedSubmitLock,
  setSubmitLock,
} from "@/lib/chatSubmitLock";

describe("chatSubmitLock", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("locks only the scoped conversation", () => {
    setSubmitLock("chat-a", 1_000);

    expect(isSubmitLocked("chat-a", 1_001)).toBe(true);
    expect(isSubmitLocked("chat-b", 1_001)).toBe(false);
  });

  it("expires stale locks without affecting newer conversations", () => {
    setSubmitLock("chat-a", 1_000);
    setSubmitLock("chat-b", 5_000);

    expect(isSubmitLocked("chat-a", 1_000 + SUBMIT_LOCK_TTL_MS + 1)).toBe(false);
    expect(isSubmitLocked("chat-b", 5_000 + SUBMIT_LOCK_TTL_MS - 1)).toBe(true);
  });

  it("uses the draft scope when no conversation id exists", () => {
    const scope = normalizeSubmitLockScope(null);
    setSubmitLock(scope, 100);

    expect(scope).toBe("__draft__");
    expect(isSubmitLocked(undefined, 101)).toBe(true);

    clearSubmitLock(scope);
    expect(isSubmitLocked(undefined, 102)).toBe(false);
  });

  it("prefers the stable conversation scope over evolving chat ids", () => {
    expect(
      resolveScopedSubmitLock({
        preferredScope: "stable-chat-a",
        conversationId: "pending-chat-a",
        latestConversationId: "chat-a",
        normalizeConversationId: (conversationId) => `resolved:${conversationId}`,
      })
    ).toBe("stable-chat-a");
  });

  it("falls back to the normalized latest conversation id when needed", () => {
    expect(
      resolveScopedSubmitLock({
        latestConversationId: "pending-chat-a",
        normalizeConversationId: (conversationId) => `chat-a-from:${conversationId}`,
      })
    ).toBe("chat-a-from:pending-chat-a");
  });
});
