import { describe, it, expect } from "vitest";
import { validateChatRequest } from "../pareSchemas";

describe("pareSchemas - ChatRequestSchema", () => {
  it("accepts attachments: null (treated as undefined)", () => {
    const result = validateChatRequest({
      messages: [{ role: "user", content: "Hola" }],
      attachments: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts images: null (treated as undefined)", () => {
    const result = validateChatRequest({
      messages: [{ role: "user", content: "Hola" }],
      images: null,
    });
    expect(result.success).toBe(true);
  });
});
