/**
 * Tests for the deep content extractor.
 * Fetch, PDF parse, and Readability are all injected so no network
 * or heavy libraries load during tests.
 */

import { describe, expect, it, vi } from "vitest";
import {
  extractContent,
  CONTENT_EXTRACTOR_INTERNAL,
} from "../services/searchBrain/contentExtractor";

function bufOf(s: string): Buffer {
  return Buffer.from(s, "utf8");
}

describe("contentExtractor helpers", () => {
  it("truncate respects maxChars", () => {
    const { text, truncated } = CONTENT_EXTRACTOR_INTERNAL.truncate("x".repeat(100), 50);
    expect(text.length).toBe(50);
    expect(truncated).toBe(true);
    const pass = CONTENT_EXTRACTOR_INTERNAL.truncate("hello", 50);
    expect(pass.text).toBe("hello");
    expect(pass.truncated).toBe(false);
  });

  it("isPdf detects by content-type OR magic bytes", () => {
    expect(CONTENT_EXTRACTOR_INTERNAL.isPdf("application/pdf", Buffer.alloc(0))).toBe(true);
    expect(CONTENT_EXTRACTOR_INTERNAL.isPdf("text/plain", bufOf("%PDF-1.4 ..."))).toBe(true);
    expect(CONTENT_EXTRACTOR_INTERNAL.isPdf("text/html", bufOf("<html></html>"))).toBe(false);
  });

  it("isHtml accepts common content types", () => {
    expect(CONTENT_EXTRACTOR_INTERNAL.isHtml("text/html; charset=utf-8")).toBe(true);
    expect(CONTENT_EXTRACTOR_INTERNAL.isHtml("application/xhtml+xml")).toBe(true);
    expect(CONTENT_EXTRACTOR_INTERNAL.isHtml("application/pdf")).toBe(false);
  });
});

describe("extractContent", () => {
  it("returns type=pdf when the fetch returns a PDF with parseable text", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      buffer: bufOf("%PDF-1.4 fake"),
      contentType: "application/pdf",
    }));
    const pdfParser = vi.fn(async () => ({ text: "Full paper body here." }));
    const out = await extractContent({
      pdfUrl: "https://example.org/paper.pdf",
      fetcher,
      pdfParser,
    });
    expect(out.type).toBe("pdf");
    expect(out.content).toContain("Full paper body");
    expect(out.truncated).toBe(false);
    expect(pdfParser).toHaveBeenCalledTimes(1);
  });

  it("falls back to the abstract when PDF fetch returns non-OK", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 403,
      buffer: Buffer.alloc(0),
      contentType: "application/pdf",
    }));
    const out = await extractContent({
      pdfUrl: "https://example.org/paywall.pdf",
      abstract: "short abstract fallback",
      fetcher,
    });
    expect(out.type).toBe("fallback");
    expect(out.content).toBe("short abstract fallback");
  });

  it("falls back when PDF parser throws", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      buffer: bufOf("%PDF-malformed"),
      contentType: "application/pdf",
    }));
    const pdfParser = vi.fn(async () => {
      throw new Error("invalid pdf");
    });
    const out = await extractContent({
      pdfUrl: "https://example.org/bad.pdf",
      abstract: "fallback abstract",
      fetcher,
      pdfParser,
    });
    expect(out.type).toBe("fallback");
  });

  it("parses HTML via injected Readability", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      buffer: bufOf("<html><body><article>Article body</article></body></html>"),
      contentType: "text/html",
    }));
    const htmlExtractor = vi.fn(async () => "Extracted article body text.");
    const out = await extractContent({
      htmlUrl: "https://example.org/paper",
      fetcher,
      htmlExtractor,
    });
    expect(out.type).toBe("html");
    expect(out.content).toContain("Extracted article body");
    expect(htmlExtractor).toHaveBeenCalledTimes(1);
  });

  it("respects maxChars and marks truncated", async () => {
    const longText = "a".repeat(1000);
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      buffer: bufOf("%PDF-x"),
      contentType: "application/pdf",
    }));
    const pdfParser = vi.fn(async () => ({ text: longText }));
    const out = await extractContent({
      pdfUrl: "https://example.org/big.pdf",
      fetcher,
      pdfParser,
      maxChars: 100,
    });
    expect(out.content.length).toBe(100);
    expect(out.truncated).toBe(true);
  });

  it("returns type=empty when nothing can be fetched and no abstract", async () => {
    const fetcher = vi.fn(async () => null);
    const out = await extractContent({ pdfUrl: "https://example.org/x.pdf", fetcher });
    expect(out.type).toBe("empty");
    expect(out.content).toBe("");
  });

  it("prefers PDF over HTML when both URLs supplied", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith(".pdf")) {
        return {
          ok: true,
          status: 200,
          buffer: bufOf("%PDF-1.4"),
          contentType: "application/pdf",
        };
      }
      return {
        ok: true,
        status: 200,
        buffer: bufOf("<html><body>html body</body></html>"),
        contentType: "text/html",
      };
    });
    const pdfParser = vi.fn(async () => ({ text: "pdf wins" }));
    const htmlExtractor = vi.fn(async () => "html loser");
    const out = await extractContent({
      pdfUrl: "https://example.org/paper.pdf",
      htmlUrl: "https://example.org/paper.html",
      fetcher,
      pdfParser,
      htmlExtractor,
    });
    expect(out.type).toBe("pdf");
    expect(out.content).toBe("pdf wins");
    expect(htmlExtractor).not.toHaveBeenCalled();
  });
});
