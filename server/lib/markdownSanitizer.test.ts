import { describe, it, expect, vi, beforeEach } from "vitest";
import { sanitizeMarkdown, sanitizeMessageContent } from "./markdownSanitizer";

// ============================================================================
// sanitizeMarkdown
// ============================================================================

describe("sanitizeMarkdown", () => {
  // ---- Empty / falsy input ----

  it("should return empty string for empty input", () => {
    expect(sanitizeMarkdown("")).toBe("");
  });

  it("should return empty string for null/undefined coerced input", () => {
    expect(sanitizeMarkdown(null as any)).toBe("");
    expect(sanitizeMarkdown(undefined as any)).toBe("");
  });

  it("should return empty string for whitespace-only input", () => {
    expect(sanitizeMarkdown("   \n\t  ")).toBe("");
  });

  it("should return empty string for non-string input", () => {
    expect(sanitizeMarkdown(123 as any)).toBe("");
    expect(sanitizeMarkdown({} as any)).toBe("");
  });

  // ---- Length limit ----

  it("should return empty string when content exceeds MAX_MARKDOWN_LENGTH", () => {
    const long = "a".repeat(20_001);
    expect(sanitizeMarkdown(long)).toBe("");
  });

  it("should process content exactly at MAX_MARKDOWN_LENGTH", () => {
    const exact = "a".repeat(20_000);
    const result = sanitizeMarkdown(exact);
    // Should NOT be empty -- the content is exactly at the boundary
    expect(result.length).toBeGreaterThan(0);
  });

  // ---- XSS prevention ----

  it("should strip <script> tags completely", () => {
    const input = '<p>Hello</p><script>alert("xss")</script>';
    const result = sanitizeMarkdown(input);
    expect(result).not.toContain("<script");
    expect(result).not.toContain("alert");
    expect(result).toContain("Hello");
  });

  it("should strip <iframe> tags", () => {
    const input = '<iframe src="https://evil.com"></iframe><p>safe</p>';
    const result = sanitizeMarkdown(input);
    expect(result).not.toContain("<iframe");
    expect(result).toContain("safe");
  });

  it("should strip <style> tags", () => {
    const input = "<style>body { display: none; }</style><p>visible</p>";
    const result = sanitizeMarkdown(input);
    expect(result).not.toContain("<style");
    expect(result).toContain("visible");
  });

  it("should strip on* event attributes", () => {
    const input = '<img src="x" onerror="alert(1)" alt="pic">';
    const result = sanitizeMarkdown(input);
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("alert");
  });

  it("should strip style attributes", () => {
    const input = '<p style="color:red">text</p>';
    const result = sanitizeMarkdown(input);
    expect(result).not.toContain("style=");
    expect(result).toContain("text");
  });

  // ---- Allowed HTML ----

  it("should preserve safe HTML tags", () => {
    const input = "<h1>Title</h1><p>Paragraph</p><ul><li>Item</li></ul>";
    const result = sanitizeMarkdown(input);
    expect(result).toContain("<h1>");
    expect(result).toContain("<p>");
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>");
  });

  it("should preserve <a> tags with safe href", () => {
    const input = '<a href="https://example.com" title="Link">click</a>';
    const result = sanitizeMarkdown(input);
    expect(result).toContain("<a");
    expect(result).toContain("https://example.com");
    expect(result).toContain("click");
  });

  it("should preserve <code> and <pre> tags", () => {
    const input = "<pre><code>const x = 1;</code></pre>";
    const result = sanitizeMarkdown(input);
    expect(result).toContain("<pre>");
    expect(result).toContain("<code>");
  });

  it("should preserve <table> related tags", () => {
    const input = "<table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>";
    const result = sanitizeMarkdown(input);
    expect(result).toContain("<table>");
    expect(result).toContain("<th>");
    expect(result).toContain("<td>");
  });

  // ---- URL sanitization ----

  it("should strip javascript: protocol from hrefs", () => {
    const input = '<a href="javascript:alert(1)">click</a>';
    const result = sanitizeMarkdown(input);
    expect(result).not.toContain("javascript:");
  });

  it("should allow mailto: links", () => {
    const input = '<a href="mailto:user@example.com">email</a>';
    const result = sanitizeMarkdown(input);
    expect(result).toContain("mailto:user@example.com");
  });

  it("should allow relative URLs starting with /", () => {
    const input = '<a href="/page">internal</a>';
    const result = sanitizeMarkdown(input);
    expect(result).toContain('href="/page"');
  });

  it("should strip data: URIs on hrefs (not allowed for links)", () => {
    const input = '<a href="data:text/html,<script>alert(1)</script>">evil</a>';
    const result = sanitizeMarkdown(input);
    expect(result).not.toContain("data:text/html");
  });

  it("should allow data:image URIs on <img> src", () => {
    const input = '<img src="data:image/png;base64,iVBOR..." alt="img">';
    const result = sanitizeMarkdown(input);
    expect(result).toContain("data:image/png;base64,");
  });

  // ---- Forbidden elements ----

  it("should strip <form> and <input> elements", () => {
    const input = '<form action="/"><input type="text"><button>Submit</button></form>';
    const result = sanitizeMarkdown(input);
    expect(result).not.toContain("<form");
    expect(result).not.toContain("<input");
    expect(result).not.toContain("<button");
  });

  it("should strip <object> and <embed> elements", () => {
    const input = '<object data="exploit.swf"></object><embed src="bad.swf">';
    const result = sanitizeMarkdown(input);
    expect(result).not.toContain("<object");
    expect(result).not.toContain("<embed");
  });
});

// ============================================================================
// sanitizeMessageContent
// ============================================================================

describe("sanitizeMessageContent", () => {
  it("should delegate to sanitizeMarkdown", () => {
    const result = sanitizeMessageContent("<p>hello</p>");
    expect(result).toContain("hello");
    expect(result).toContain("<p>");
  });

  it("should return empty string for empty input", () => {
    expect(sanitizeMessageContent("")).toBe("");
  });

  it("should strip XSS from message content", () => {
    const input = '<b>bold</b><script>alert("x")</script>';
    const result = sanitizeMessageContent(input);
    expect(result).toContain("<b>bold</b>");
    expect(result).not.toContain("<script");
  });
});
