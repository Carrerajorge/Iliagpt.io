import { describe, it, expect } from "vitest";
import {
  removeAsciiControlChars,
  stripLikelyHtmlTags,
  decodeCommonHtmlEntities,
  collapseWhitespace,
  sanitizePlainText,
  sanitizeSearchQuery,
  sanitizeHttpUrl,
} from "./textSanitizers";

describe("removeAsciiControlChars", () => {
  it("removes NUL and other control chars", () => {
    expect(removeAsciiControlChars("he\x00llo\x01")).toBe("hello");
  });
  it("keeps tabs, newlines, and carriage returns", () => {
    expect(removeAsciiControlChars("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });
  it("removes DEL (0x7F)", () => {
    expect(removeAsciiControlChars("ab\x7Fcd")).toBe("abcd");
  });
  it("handles empty string", () => {
    expect(removeAsciiControlChars("")).toBe("");
  });
});

describe("stripLikelyHtmlTags", () => {
  it("strips simple HTML tags", () => {
    expect(stripLikelyHtmlTags("<b>bold</b>")).toBe("bold");
  });
  it("strips script tags and content between", () => {
    expect(stripLikelyHtmlTags("before<script>alert(1)</script>after")).toBe("beforealert(1)after");
  });
  it("preserves math comparisons like 2 < 3", () => {
    expect(stripLikelyHtmlTags("2 < 3")).toBe("2 < 3");
  });
  it("preserves 'x < y' because next char is not a tag-start", () => {
    expect(stripLikelyHtmlTags("x < 5")).toBe("x < 5");
  });
  it("strips tags with attributes", () => {
    expect(stripLikelyHtmlTags('<div class="x">text</div>')).toBe("text");
  });
  it("strips self-closing tags", () => {
    expect(stripLikelyHtmlTags("before<br/>after")).toBe("beforeafter");
  });
  it("strips comment tags", () => {
    expect(stripLikelyHtmlTags("a<!-- comment -->b")).toBe("ab");
  });
  it("handles empty input", () => {
    expect(stripLikelyHtmlTags("")).toBe("");
  });
});

describe("decodeCommonHtmlEntities", () => {
  it("decodes &amp;", () => {
    expect(decodeCommonHtmlEntities("a &amp; b")).toBe("a & b");
  });
  it("decodes &lt; and &gt;", () => {
    expect(decodeCommonHtmlEntities("&lt;div&gt;")).toBe("<div>");
  });
  it("decodes &quot;", () => {
    expect(decodeCommonHtmlEntities('say &quot;hi&quot;')).toBe('say "hi"');
  });
  it("decodes &#39;", () => {
    expect(decodeCommonHtmlEntities("it&#39;s")).toBe("it's");
  });
  it("decodes &#x27;", () => {
    expect(decodeCommonHtmlEntities("it&#x27;s")).toBe("it's");
  });
  it("decodes &nbsp;", () => {
    expect(decodeCommonHtmlEntities("a&nbsp;b")).toBe("a b");
  });
  it("preserves unknown entities", () => {
    expect(decodeCommonHtmlEntities("&unknown;")).toBe("&unknown;");
  });
});

describe("collapseWhitespace", () => {
  it("collapses multiple spaces", () => {
    expect(collapseWhitespace("a    b")).toBe("a b");
  });
  it("collapses mixed whitespace", () => {
    expect(collapseWhitespace("a \t\n b")).toBe("a b");
  });
  it("trims leading/trailing whitespace", () => {
    expect(collapseWhitespace("  hello  ")).toBe("hello");
  });
});

describe("sanitizePlainText", () => {
  it("returns empty string for non-string input", () => {
    expect(sanitizePlainText(123)).toBe("");
    expect(sanitizePlainText(null)).toBe("");
    expect(sanitizePlainText(undefined)).toBe("");
  });
  it("strips control chars, HTML tags, and decodes entities", () => {
    expect(sanitizePlainText("<b>test</b> &amp; more\x00")).toBe("test & more");
  });
  it("respects maxLen option", () => {
    const result = sanitizePlainText("abcdefghij", { maxLen: 5 });
    expect(result).toBe("abcde");
  });
  it("collapses whitespace by default", () => {
    expect(sanitizePlainText("a   b")).toBe("a b");
  });
  it("can disable whitespace collapsing", () => {
    const result = sanitizePlainText("  a   b  ", { collapseWs: false });
    expect(result).toBe("a   b");
  });
  it("handles nested HTML with entities", () => {
    expect(sanitizePlainText("<p>Price: &lt;$100&gt;</p>")).toBe("Price: <$100>");
  });
});

describe("sanitizeSearchQuery", () => {
  it("sanitizes and limits length", () => {
    const long = "a".repeat(600);
    const result = sanitizeSearchQuery(long);
    expect(result.length).toBeLessThanOrEqual(500);
  });
  it("strips HTML from queries", () => {
    expect(sanitizeSearchQuery("<script>alert</script>search")).toBe("alertsearch");
  });
  it("returns empty for non-string", () => {
    expect(sanitizeSearchQuery(42)).toBe("");
  });
});

describe("sanitizeHttpUrl", () => {
  it("returns valid HTTP URLs unchanged", () => {
    expect(sanitizeHttpUrl("https://example.com")).toBe("https://example.com/");
  });
  it("returns valid HTTP URL", () => {
    expect(sanitizeHttpUrl("http://example.com/path")).toBe("http://example.com/path");
  });
  it("adds https to protocol-relative URLs", () => {
    expect(sanitizeHttpUrl("//example.com/path")).toBe("https://example.com/path");
  });
  it("rejects non-HTTP protocols", () => {
    expect(sanitizeHttpUrl("ftp://example.com")).toBe("");
    expect(sanitizeHttpUrl("javascript:alert(1)")).toBe("");
  });
  it("returns empty for non-string input", () => {
    expect(sanitizeHttpUrl(123)).toBe("");
    expect(sanitizeHttpUrl(null)).toBe("");
  });
  it("returns empty for empty string", () => {
    expect(sanitizeHttpUrl("")).toBe("");
    expect(sanitizeHttpUrl("  ")).toBe("");
  });
  it("rejects invalid URLs", () => {
    expect(sanitizeHttpUrl("not a url")).toBe("");
  });
});
