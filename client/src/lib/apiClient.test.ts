import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-auth", () => ({
  getStoredAnonUserId: () => null,
  getStoredAnonToken: () => null,
}));

vi.mock("@/lib/csrfTokenStore", () => ({
  getCsrfToken: () => null,
  setInMemoryCsrfToken: vi.fn(),
}));

import { apiFetch } from "@/lib/apiClient";

describe("apiFetch", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
    vi.stubGlobal("location", new URL("http://localhost:5001/chat/test"));
  });

  it("returns the primary HTTP response without probing other dev ports", async () => {
    const primaryResponse = new Response(JSON.stringify({ error: "boom" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
    vi.mocked(fetch).mockResolvedValue(primaryResponse);

    const response = await apiFetch("/api/memory/chats/chat_test/state");

    expect(response.status).toBe(500);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5001/api/memory/chats/chat_test/state",
      expect.objectContaining({
        credentials: "include",
      }),
    );
  });

  it("falls back to alternate local ports only after a network failure", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const response = await apiFetch("/api/memory/chats/chat_test/state");

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:5001/api/memory/chats/chat_test/state",
      expect.objectContaining({
        credentials: "include",
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost:5000/api/memory/chats/chat_test/state",
      expect.objectContaining({
        credentials: "include",
      }),
    );
  });
});
