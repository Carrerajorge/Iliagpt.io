import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  exportChatsToJSON,
  parseImportFile,
  convertImportedChats,
} from "../lib/chat-export";
import type { ChatExport } from "../lib/chat-export";

// ── Helpers ──────────────────────────────────────────────────

function makeChat(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? "chat-1",
    stableKey: overrides.stableKey ?? "stable-1",
    title: overrides.title ?? "Test Chat",
    timestamp: overrides.timestamp ?? 1700000000000,
    messages: overrides.messages ?? [
      { id: "m1", role: "user", content: "Hello" },
      { id: "m2", role: "assistant", content: "Hi there" },
    ],
  } as any;
}

function validExportPayload(chats: any[] = [makeChat()]): ChatExport {
  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    chatsCount: chats.length,
    chats: chats.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.timestamp || Date.now(),
      updatedAt: c.timestamp || Date.now(),
      messages: c.messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: Date.now(),
      })),
    })),
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("chat-export", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ---------- exportChatsToJSON ----------

  describe("exportChatsToJSON", () => {
    it("produces valid JSON string", () => {
      const json = exportChatsToJSON([makeChat()]);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it("includes version field set to 1.0", () => {
      const parsed = JSON.parse(exportChatsToJSON([makeChat()]));
      expect(parsed.version).toBe("1.0");
    });

    it("includes exportedAt as ISO date string", () => {
      const parsed = JSON.parse(exportChatsToJSON([makeChat()]));
      expect(parsed.exportedAt).toBeDefined();
      expect(new Date(parsed.exportedAt).toISOString()).toBe(parsed.exportedAt);
    });

    it("sets chatsCount matching the number of chats", () => {
      const chats = [makeChat({ id: "a" }), makeChat({ id: "b" })];
      const parsed = JSON.parse(exportChatsToJSON(chats));
      expect(parsed.chatsCount).toBe(2);
      expect(parsed.chats).toHaveLength(2);
    });

    it("preserves chat title and messages content", () => {
      const chat = makeChat({ title: "My Title" });
      const parsed = JSON.parse(exportChatsToJSON([chat]));
      expect(parsed.chats[0].title).toBe("My Title");
      expect(parsed.chats[0].messages[0].content).toBe("Hello");
    });

    it("handles empty chat array", () => {
      const parsed = JSON.parse(exportChatsToJSON([]));
      expect(parsed.chatsCount).toBe(0);
      expect(parsed.chats).toEqual([]);
    });
  });

  // ---------- parseImportFile ----------

  describe("parseImportFile", () => {
    it("returns ChatExport for valid JSON", () => {
      const payload = validExportPayload();
      const result = parseImportFile(JSON.stringify(payload));
      expect(result).not.toBeNull();
      expect(result!.version).toBe("1.0");
      expect(result!.chats).toHaveLength(1);
    });

    it("returns null for invalid JSON", () => {
      const result = parseImportFile("not-json{{{}}}");
      expect(result).toBeNull();
    });

    it("returns null when version field is missing", () => {
      const result = parseImportFile(JSON.stringify({ chats: [] }));
      expect(result).toBeNull();
    });

    it("returns null when chats field is not an array", () => {
      const result = parseImportFile(
        JSON.stringify({ version: "1.0", chats: "not-array" }),
      );
      expect(result).toBeNull();
    });

    it("returns null for empty string input", () => {
      const result = parseImportFile("");
      expect(result).toBeNull();
    });
  });

  // ---------- convertImportedChats ----------

  describe("convertImportedChats", () => {
    it("generates new IDs prefixed with imported_", () => {
      const payload = validExportPayload();
      const chats = convertImportedChats(payload);
      expect(chats[0].id).toMatch(/^imported_/);
    });

    it("generates new message IDs prefixed with imported_", () => {
      const payload = validExportPayload();
      const chats = convertImportedChats(payload);
      expect(chats[0].messages[0].id).toMatch(/^imported_/);
    });

    it("preserves chat title", () => {
      const payload = validExportPayload([makeChat({ title: "Preserved" })]);
      const chats = convertImportedChats(payload);
      expect(chats[0].title).toBe("Preserved");
    });

    it("preserves message content and role", () => {
      const payload = validExportPayload();
      const chats = convertImportedChats(payload);
      expect(chats[0].messages[0].role).toBe("user");
      expect(chats[0].messages[0].content).toBe("Hello");
    });
  });

  // ---------- Round-trip ----------

  describe("round-trip", () => {
    it("export then import preserves data integrity", () => {
      const original = [makeChat({ title: "Round-Trip" })];
      const json = exportChatsToJSON(original);
      const imported = parseImportFile(json);
      expect(imported).not.toBeNull();
      expect(imported!.chats[0].title).toBe("Round-Trip");
      expect(imported!.chats[0].messages[0].content).toBe("Hello");

      const converted = convertImportedChats(imported!);
      expect(converted).toHaveLength(1);
      expect(converted[0].title).toBe("Round-Trip");
    });
  });
});
