/**
 * Tests for the citation validator — critical for user trust. Every
 * case represents a real failure mode we've seen in LLM-generated
 * academic responses.
 */

import { describe, expect, it } from "vitest";
import {
  validateCitations,
  CITATION_VALIDATOR_INTERNAL,
  normaliseDoi,
  normaliseUrl,
} from "../services/searchBrain/citationValidator";

describe("normaliseUrl", () => {
  it("lowercases host, strips trailing slash + fragment", () => {
    expect(normaliseUrl("HTTPS://Example.COM/path/#frag")).toBe("https://example.com/path");
  });
  it("returns unchanged on malformed input", () => {
    expect(normaliseUrl("not a url")).toBe("not a url");
  });
});

describe("normaliseDoi", () => {
  it.each([
    ["https://doi.org/10.1/abc", "10.1/abc"],
    ["https://DX.doi.org/10.1/abc", "10.1/abc"],
    ["doi:10.1/abc", "10.1/abc"],
    ["10.1/abc.", "10.1/abc"],
    ["10.1/abc,", "10.1/abc"],
  ])("normalises %s → %s", (input, expected) => {
    expect(normaliseDoi(input)).toBe(expected);
  });
});

describe("trimTrailingPunct", () => {
  it("strips trailing . , ; ] ) etc", () => {
    const fn = CITATION_VALIDATOR_INTERNAL.trimTrailingPunct;
    expect(fn("https://example.com/path.")).toBe("https://example.com/path");
    expect(fn("https://example.com/path).")).toBe("https://example.com/path");
    expect(fn("https://example.com/path];")).toBe("https://example.com/path");
  });
});

// ─── validateCitations — end-to-end behaviour ────────────────────────────

describe("validateCitations", () => {
  it("clean response (all URLs allow-listed) → no rewrites", () => {
    const r = validateCitations({
      text: "See paper at https://example.org/paper for details [1].",
      allowedUrls: ["https://example.org/paper"],
    });
    expect(r.report.clean).toBe(true);
    expect(r.report.invalidUrls).toEqual([]);
    expect(r.text).toContain("https://example.org/paper");
  });

  it("fabricated URL → rewritten to [cita no verificada]", () => {
    const r = validateCitations({
      text: "Available at https://fake.example/made-up.pdf",
      allowedUrls: ["https://real.example/article"],
    });
    expect(r.report.clean).toBe(false);
    expect(r.report.invalidUrls).toEqual(["https://fake.example/made-up.pdf"]);
    expect(r.text).toContain("[cita no verificada]");
    expect(r.text).not.toContain("https://fake.example/made-up.pdf");
  });

  it("fabricated DOI → flagged + rewritten", () => {
    const r = validateCitations({
      text: "DOI: 10.1234/fake",
      allowedUrls: ["https://real.example/x"],
      allowedDois: ["10.1/legit"],
    });
    expect(r.report.clean).toBe(false);
    expect(r.report.invalidDois).toEqual(["10.1234/fake"]);
    expect(r.text).toContain("[cita no verificada]");
  });

  it("allow-list accepts via DOI substring (handles redirectors)", () => {
    const r = validateCitations({
      text: "See https://some.redirector.io/?doi=10.1/legit",
      allowedUrls: [],
      allowedDois: ["10.1/legit"],
    });
    expect(r.report.clean).toBe(true);
  });

  it("URL with trailing punctuation is normalised before compare", () => {
    const r = validateCitations({
      text: "See https://example.org/paper, it's great!",
      allowedUrls: ["https://example.org/paper"],
    });
    expect(r.report.invalidUrls).toEqual([]);
  });

  it("dedupes extracted URLs + DOIs", () => {
    const r = validateCitations({
      text: "https://x/y and later https://x/y again",
      allowedUrls: ["https://x/y"],
    });
    expect(r.report.extractedUrls).toHaveLength(1);
  });

  it("rewrite=false → returns original text but reports invalids", () => {
    const r = validateCitations({
      text: "https://fake.example/x",
      allowedUrls: [],
      rewrite: false,
    });
    expect(r.text).toBe("https://fake.example/x");
    expect(r.report.invalidUrls).toHaveLength(1);
  });

  it("mixed valid + invalid: keeps valid, strips invalid", () => {
    const r = validateCitations({
      text: "First paper: https://real.example/a. Second paper: https://fake.example/b.",
      allowedUrls: ["https://real.example/a"],
    });
    expect(r.text).toContain("https://real.example/a");
    expect(r.text).not.toContain("https://fake.example/b");
    expect(r.text).toContain("[cita no verificada]");
  });

  it("captures DOIs embedded inside doi.org URLs as DOIs", () => {
    const r = validateCitations({
      text: "See https://doi.org/10.1234/abc for reference.",
      allowedUrls: [],
      allowedDois: ["10.1234/abc"],
    });
    // The doi.org URL should pass via the DOI-substring allowlist.
    expect(r.report.clean).toBe(true);
  });

  it("empty text → clean + empty extracted arrays", () => {
    const r = validateCitations({ text: "", allowedUrls: [] });
    expect(r.report.clean).toBe(true);
    expect(r.report.extractedUrls).toEqual([]);
  });

  it("text with no URLs/DOIs → clean", () => {
    const r = validateCitations({
      text: "The authors argue that X leads to Y [1].",
      allowedUrls: ["https://x"],
    });
    expect(r.report.clean).toBe(true);
  });

  it("handles URLs in parentheses / brackets common in academic prose", () => {
    const r = validateCitations({
      text: "La gestión administrativa mejora la toma de decisiones (https://example.org/paper).",
      allowedUrls: ["https://example.org/paper"],
    });
    expect(r.report.invalidUrls).toEqual([]);
  });
});
