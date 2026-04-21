/**
 * Tests for the web-side providers (SearXNG, DuckDuckGo, Wikipedia).
 * Parsers verified standalone; end-to-end fetch layer is stubbed.
 */

import { describe, expect, it, vi } from "vitest";
import {
  parseSearxngJson,
  parseDuckDuckGoHtml,
  parseOpenSearchTitles,
  parseWikipediaSummary,
  WEB_PROVIDERS_INTERNAL,
  searchSearxng,
  searchDuckDuckGo,
  searchWikipedia,
} from "../services/searchBrain/webProviders";

// ─── SearXNG parser ───────────────────────────────────────────────────────

describe("parseSearxngJson", () => {
  it("extracts title + url + snippet with rank", () => {
    const out = parseSearxngJson(
      {
        results: [
          { title: "Alpha", url: "https://a.example/x", content: "s1" },
          { title: "Beta", url: "https://b.example/y", content: "s2" },
        ],
      },
      10
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.source).toBe("searxng");
    expect(out[0]!.host).toBe("a.example");
    expect(out[0]!.providerRank).toBe(0);
    expect(out[1]!.providerRank).toBe(1);
  });

  it("ignores malformed rows and respects maxResults", () => {
    const out = parseSearxngJson(
      {
        results: [
          { title: "A", url: "https://a/x" },
          { title: "", url: "https://b/x" }, // dropped: empty title
          { title: "C" }, // dropped: missing url
          { title: "D", url: "https://d/x" },
          { title: "E", url: "https://e/x" },
        ],
      },
      2
    );
    expect(out.map((r) => r.title)).toEqual(["A", "D"]);
  });

  it("returns [] on non-array body", () => {
    expect(parseSearxngJson({}, 5)).toEqual([]);
    expect(parseSearxngJson(null, 5)).toEqual([]);
  });
});

// ─── SearXNG rotation ─────────────────────────────────────────────────────

describe("searchSearxng rotation", () => {
  it("falls over from a failing instance to the next one", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      calls.push(url);
      if (calls.length === 1) return null; // first instance down
      return new Response(JSON.stringify({ results: [{ title: "OK", url: "https://ok/x" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const out = await searchSearxng({
      query: "test",
      instances: ["https://down", "https://up"],
      fetcher,
    });
    expect(calls).toHaveLength(2);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("OK");
  });

  it("returns [] when all instances fail", async () => {
    const fetcher = vi.fn(async () => null);
    const out = await searchSearxng({
      query: "test",
      instances: ["https://a", "https://b"],
      fetcher,
    });
    expect(out).toEqual([]);
  });
});

// ─── DuckDuckGo parser ────────────────────────────────────────────────────

describe("parseDuckDuckGoHtml", () => {
  it("extracts anchors + snippets, unwraps uddg redirects", () => {
    const html = `
      <html><body>
        <div class="result">
          <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ftarget.example%2Fpage">Target Page</a></h2>
          <a class="result__snippet">A useful snippet</a>
        </div>
        <div class="result">
          <h2><a class="result__a" href="https://direct.example">Direct</a></h2>
        </div>
      </body></html>`;
    const out = parseDuckDuckGoHtml(html, 10);
    expect(out).toHaveLength(2);
    expect(out[0]!.url).toBe("https://target.example/page");
    expect(out[1]!.url).toBe("https://direct.example");
  });

  it("skips hits without title or href", () => {
    const html = `
      <html><body>
        <div class="result"><h2></h2></div>
        <div class="result"><h2><a class="result__a">no href</a></h2></div>
        <div class="result"><h2><a class="result__a" href="/x">ok</a></h2></div>
      </body></html>`;
    const out = parseDuckDuckGoHtml(html, 10);
    expect(out).toHaveLength(1);
  });

  it("respects maxResults", () => {
    const blocks = Array.from(
      { length: 6 },
      (_, i) => `<div class="result"><h2><a class="result__a" href="https://x/${i}">T${i}</a></h2></div>`
    ).join("");
    const out = parseDuckDuckGoHtml(`<html><body>${blocks}</body></html>`, 3);
    expect(out).toHaveLength(3);
  });
});

describe("searchDuckDuckGo with fetcher stub", () => {
  it("passes through HTML", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        `<html><body><div class="result"><h2><a class="result__a" href="https://x">X</a></h2></div></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      )
    );
    const out = await searchDuckDuckGo({ query: "x", fetcher });
    expect(out).toHaveLength(1);
    expect(out[0]!.url).toBe("https://x");
  });

  it("returns [] on non-OK status", async () => {
    const fetcher = vi.fn(async () => new Response("fail", { status: 503 }));
    const out = await searchDuckDuckGo({ query: "x", fetcher });
    expect(out).toEqual([]);
  });
});

// ─── Wikipedia parsers ────────────────────────────────────────────────────

describe("parseOpenSearchTitles", () => {
  it("reads body[1] array of titles", () => {
    expect(parseOpenSearchTitles(["query", ["Alpha", "Beta", "Gamma"]], 2)).toEqual(["Alpha", "Beta"]);
  });

  it("empty/malformed → []", () => {
    expect(parseOpenSearchTitles(null, 5)).toEqual([]);
    expect(parseOpenSearchTitles([], 5)).toEqual([]);
    expect(parseOpenSearchTitles(["q"], 5)).toEqual([]);
  });
});

describe("parseWikipediaSummary", () => {
  it("extracts title + snippet + URL", () => {
    const r = parseWikipediaSummary(
      {
        title: "Melatonin",
        extract: "A hormone...",
        content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Melatonin" } },
      },
      "Melatonin",
      0
    );
    expect(r).toBeTruthy();
    expect(r!.source).toBe("wikipedia");
    expect(r!.title).toBe("Melatonin");
    expect(r!.url).toBe("https://en.wikipedia.org/wiki/Melatonin");
    expect(r!.snippet).toContain("hormone");
  });

  it("falls back to computed URL when content_urls missing", () => {
    const r = parseWikipediaSummary({ title: "X", extract: "" }, "Example Title", 1);
    expect(r!.url).toBe("https://en.wikipedia.org/wiki/Example_Title");
  });

  it("returns null for non-object input", () => {
    expect(parseWikipediaSummary(null, "X", 0)).toBeNull();
  });
});

describe("searchWikipedia end-to-end with stub", () => {
  it("runs opensearch then summary per title", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("action=opensearch")) {
        return new Response(JSON.stringify(["q", ["Alpha", "Beta"], [], []]), { status: 200 });
      }
      const titleMatch = url.match(/summary\/(.+)$/);
      const title = titleMatch ? decodeURIComponent(titleMatch[1]) : "unknown";
      return new Response(
        JSON.stringify({
          title,
          extract: `Summary for ${title}`,
          content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${title}` } },
        }),
        { status: 200 }
      );
    });
    const out = await searchWikipedia({ query: "q", fetcher });
    expect(out.map((r) => r.title)).toEqual(["Alpha", "Beta"]);
    expect(out[0]!.providerRank).toBe(0);
  });

  it("returns [] when opensearch fails", async () => {
    const fetcher = vi.fn(async () => null);
    const out = await searchWikipedia({ query: "q", fetcher });
    expect(out).toEqual([]);
  });
});

// ─── safeHost ─────────────────────────────────────────────────────────────

describe("safeHost", () => {
  it("extracts hostname or returns undefined on bad URL", () => {
    expect(WEB_PROVIDERS_INTERNAL.safeHost("https://example.com/path")).toBe("example.com");
    expect(WEB_PROVIDERS_INTERNAL.safeHost("not a url")).toBeUndefined();
  });
});
