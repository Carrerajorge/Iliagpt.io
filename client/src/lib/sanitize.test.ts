import { describe, it, expect } from "vitest";
import { sanitizeHtml, sanitizeSvg, createSafeHtml, createSafeSvg } from "./sanitize";

describe("sanitizeHtml", () => {
  it("returns empty for null/undefined/non-string", () => {
    expect(sanitizeHtml(null as any)).toBe("");
    expect(sanitizeHtml(undefined as any)).toBe("");
    expect(sanitizeHtml("")).toBe("");
    expect(sanitizeHtml(123 as any)).toBe("");
  });

  it("removes script tags", () => {
    const input = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("<script");
    expect(result).not.toContain("alert");
    expect(result).toContain("Hello");
    expect(result).toContain("World");
  });

  it("removes on* event handlers (quoted)", () => {
    const input = '<img src="x" onerror="alert(1)">';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("alert");
  });

  it("removes on* event handlers (unquoted)", () => {
    const input = '<div onclick=alert(1)>text</div>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("onclick");
  });

  it("removes javascript: URLs", () => {
    const input = '<a href="javascript:alert(1)">click</a>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("javascript");
  });

  it("removes vbscript: URLs", () => {
    const input = '<a href="vbscript:msgbox(1)">click</a>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("vbscript");
  });

  it("removes expression() in styles", () => {
    const input = '<div style="background: expression(alert(1))">test</div>';
    const result = sanitizeHtml(input);
    expect(result).not.toMatch(/expression\s*\(/i);
  });

  it("removes -moz-binding in styles", () => {
    const input = '<div style="-moz-binding: url(evil)">test</div>';
    const result = sanitizeHtml(input);
    expect(result).not.toMatch(/-moz-binding\s*:/i);
  });

  it("removes data:text/html URLs", () => {
    const input = '<a href="data:text/html,<script>alert(1)</script>">click</a>';
    const result = sanitizeHtml(input);
    expect(result).not.toMatch(/data\s*:\s*text\/html/i);
  });

  it("preserves safe HTML content", () => {
    const input = "<p>Hello <strong>world</strong></p>";
    const result = sanitizeHtml(input);
    expect(result).toContain("Hello");
    expect(result).toContain("world");
  });
});

describe("sanitizeSvg", () => {
  it("removes foreignObject elements", () => {
    const input = '<svg><foreignObject><body><script>alert(1)</script></body></foreignObject></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain("foreignObject");
  });

  it("removes animate tags", () => {
    const input = '<svg><animate attributeName="href" values="javascript:alert(1)"></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain("<animate");
  });

  it("removes set tags", () => {
    const input = '<svg><set attributeName="onload" to="alert(1)"></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain("<set");
  });

  it("removes external xlink:href", () => {
    const input = '<svg><use xlink:href="http://evil.com/sprite.svg#icon"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain("evil.com");
  });

  it("removes script tags from SVG", () => {
    const input = '<svg><script>alert(1)</script><circle cx="50" cy="50" r="40"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain("<script");
  });
});

describe("createSafeHtml", () => {
  it("returns __html wrapper", () => {
    const result = createSafeHtml("<p>Hello</p>");
    expect(result).toHaveProperty("__html");
    expect(result.__html).toContain("Hello");
  });

  it("sanitizes dangerous content", () => {
    const result = createSafeHtml('<script>alert(1)</script><p>safe</p>');
    expect(result.__html).not.toContain("<script");
    expect(result.__html).toContain("safe");
  });
});

describe("createSafeSvg", () => {
  it("returns __html wrapper for SVG", () => {
    const result = createSafeSvg('<svg><circle cx="50" cy="50" r="40"/></svg>');
    expect(result).toHaveProperty("__html");
  });

  it("sanitizes dangerous SVG content", () => {
    const result = createSafeSvg('<svg><script>alert(1)</script></svg>');
    expect(result.__html).not.toContain("<script");
  });
});
