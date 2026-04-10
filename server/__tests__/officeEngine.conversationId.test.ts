import { describe, expect, it } from "vitest";

import { normalizeOfficeConversationIdForPersistence } from "../lib/office/engine/OfficeEngine";

describe("normalizeOfficeConversationIdForPersistence", () => {
  it("preserves raw UUID conversation ids", () => {
    expect(
      normalizeOfficeConversationIdForPersistence("123e4567-e89b-42d3-a456-426614174000"),
    ).toBe("123e4567-e89b-42d3-a456-426614174000");
  });

  it("extracts the UUID suffix from prefixed chat ids", () => {
    expect(
      normalizeOfficeConversationIdForPersistence("chat_123e4567-e89b-42d3-a456-426614174000"),
    ).toBe("123e4567-e89b-42d3-a456-426614174000");
  });

  it("drops incompatible non-UUID conversation ids instead of crashing persistence", () => {
    expect(normalizeOfficeConversationIdForPersistence("conv-1")).toBeUndefined();
    expect(normalizeOfficeConversationIdForPersistence("chat-without-uuid")).toBeUndefined();
    expect(normalizeOfficeConversationIdForPersistence(null)).toBeUndefined();
  });
});
