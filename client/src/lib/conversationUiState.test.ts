import { describe, expect, it } from "vitest";

import { resolveConversationUiStateKey } from "./conversationUiState";

describe("resolveConversationUiStateKey", () => {
  it("prefers the active conversation when it resolves to the requested id", () => {
    const result = resolveConversationUiStateKey({
      requestedConversationId: "chat_real_123",
      activeConversationId: "pending_abc",
      existingConversationIds: ["pending_abc", "chat_real_123"],
      resolveConversationId: (conversationId) =>
        conversationId === "pending_abc" ? "chat_real_123" : conversationId,
    });

    expect(result).toBe("pending_abc");
  });

  it("falls back to an existing conversation key whose resolved id matches", () => {
    const result = resolveConversationUiStateKey({
      requestedConversationId: "chat_real_123",
      existingConversationIds: ["stable_new_chat"],
      resolveConversationId: (conversationId) =>
        conversationId === "stable_new_chat" ? "chat_real_123" : conversationId,
    });

    expect(result).toBe("stable_new_chat");
  });

  it("returns the requested id when no existing conversation key matches", () => {
    const result = resolveConversationUiStateKey({
      requestedConversationId: "temp_analysis_1",
      activeConversationId: "chat_other",
      existingConversationIds: ["chat_other"],
    });

    expect(result).toBe("temp_analysis_1");
  });

  it("uses the active conversation when no requested id is provided", () => {
    const result = resolveConversationUiStateKey({
      activeConversationId: "chat_active",
      pendingConversationId: "chat_pending",
      draftConversationId: "chat_draft",
    });

    expect(result).toBe("chat_active");
  });
});
