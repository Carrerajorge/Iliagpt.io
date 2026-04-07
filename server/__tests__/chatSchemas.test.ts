import { describe, expect, it } from "vitest";

import { chatRequestSchema } from "../schemas/chatSchemas";

function buildValidPayload() {
  return {
    messages: [{ role: "user" as const, content: "Hola" }],
    attachments: [{
      name: "reporte.pdf",
      type: "document",
      mimeType: "application/pdf",
      size: 1024,
      storagePath: "/objects/reporte.pdf",
    }],
  };
}

describe("chatSchemas", () => {
  it("rejects too many attachments", () => {
    const payload = buildValidPayload();
    payload.attachments = Array.from({ length: 51 }, (_, index) => ({
      name: `archivo-${index}.pdf`,
      type: "document",
      mimeType: "application/pdf",
      size: 1024,
      storagePath: `/objects/archivo-${index}.pdf`,
    }));

    const result = chatRequestSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects oversized total attachment payload", () => {
    const payload = buildValidPayload();
    payload.attachments = Array.from({ length: 5 }, (_, index) => ({
      name: `archivo-${index}.pdf`,
      type: "document",
      mimeType: "application/pdf",
      size: 500 * 1024 * 1024,
      storagePath: `/objects/archivo-${index}.pdf`,
    }));

    const result = chatRequestSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("Combined attachment size exceeds"))).toBe(true);
    }
  });
});
