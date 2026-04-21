/**
 * Tests for the web orchestrator (web-side fan-out + dedupe).
 */

import { describe, expect, it, vi } from "vitest";
import {
  runWebSearch,
  dedupeWebResults,
  normaliseUrlForDedupe,
} from "../services/searchBrain/webOrchestrator";
import type { WebResult } from "../services/searchBrain/webProviders";

function hit(source: WebResult["source"], url: string, title = "T"): WebResult {
  return { source, url, title, host: url };
}

describe("normaliseUrlForDedupe", () => {
  it("lowercases host, strips fragment, drops trailing slash", () => {
    expect(normaliseUrlForDedupe("HTTPS://Example.com/#frag")).toBe("https://example.com");
    // Trailing slash dropped so x.com/path and x.com/path/ hash to the same key for dedupe.
    expect(normaliseUrlForDedupe("https://example.com/path/")).toBe("https://example.com/path");
  });

  it("returns the input on malformed URL", () => {
    expect(normaliseUrlForDedupe("not-a-url")).toBe("not-a-url");
  });
});

describe("dedupeWebResults", () => {
  it("drops duplicates by normalised URL", () => {
    const out = dedupeWebResults([
      hit("wikipedia", "https://x.com/a"),
      hit("duckduckgo", "HTTPS://x.com/a#section"),
      hit("searxng", "https://x.com/b"),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("runWebSearch", () => {
  it("fan-outs across sources, dedupes pool, returns traces", async () => {
    const providerFns = {
      wikipedia: vi.fn(async () => [hit("wikipedia", "https://w/1")]),
      duckduckgo: vi.fn(async () => [
        hit("duckduckgo", "https://d/1"),
        hit("duckduckgo", "https://d/2"),
      ]),
      searxng: vi.fn(async () => [
        hit("searxng", "https://d/1"), // duplicate of duckduckgo[0]
        hit("searxng", "https://s/1"),
      ]),
    };
    const out = await runWebSearch({ query: "q", providerFns });
    expect(out.providers).toHaveLength(3);
    expect(out.results.length).toBeLessThanOrEqual(4);
    // Three traces, all ok=true with non-zero counts.
    for (const p of out.providers) {
      expect(p.ok).toBe(true);
      expect(p.count).toBeGreaterThan(0);
    }
  });

  it("records ok=false when a provider throws", async () => {
    const providerFns = {
      wikipedia: vi.fn(async () => [hit("wikipedia", "https://w/1")]),
      duckduckgo: vi.fn(async () => {
        throw new Error("network down");
      }),
    };
    const out = await runWebSearch({ query: "q", sources: ["wikipedia", "duckduckgo"], providerFns });
    const ddg = out.providers.find((p) => p.source === "duckduckgo");
    expect(ddg?.ok).toBe(false);
    expect(ddg?.error).toContain("network down");
  });

  it("honours maxResults cap", async () => {
    const providerFns = {
      searxng: vi.fn(async () =>
        Array.from({ length: 30 }, (_, i) => hit("searxng", `https://x/${i}`))
      ),
    };
    const out = await runWebSearch({ query: "q", sources: ["searxng"], maxResults: 5, providerFns });
    expect(out.results).toHaveLength(5);
  });

  it("empty query short-circuits", async () => {
    const out = await runWebSearch({ query: "" });
    expect(out.results).toEqual([]);
    expect(out.providers).toEqual([]);
  });
});
