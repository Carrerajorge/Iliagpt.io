import { describe, it, expect } from "vitest";
import { detectFormat, parseRst, parseDocument } from "./rstParser";

describe("detectFormat", () => {
  it("detects by filename extension", () => {
    expect(detectFormat("", "readme.rst")).toBe("rst");
    expect(detectFormat("", "readme.rest")).toBe("rst");
    expect(detectFormat("", "readme.md")).toBe("markdown");
    expect(detectFormat("", "readme.markdown")).toBe("markdown");
    expect(detectFormat("", "readme.mdx")).toBe("markdown");
  });

  it("detects RST content patterns", () => {
    const rst = "Title\n=====\n\n.. note:: Something\n\n:field: value";
    expect(detectFormat(rst)).toBe("rst");
  });

  it("detects Markdown content patterns", () => {
    const md = "# Title\n\n[link](url)\n\n> blockquote\n\n```code```";
    expect(detectFormat(md)).toBe("markdown");
  });

  it("defaults to markdown for ambiguous content", () => {
    expect(detectFormat("just plain text")).toBe("markdown");
  });
});

describe("parseRst", () => {
  it("returns empty for empty input", () => {
    const result = parseRst("");
    expect(result.format).toBe("rst");
    expect(result.html).toBe("");
  });

  it("parses headings with underlines", () => {
    const input = "My Title\n========\n\nSubtitle\n--------";
    const result = parseRst(input);
    expect(result.html).toContain("<h1");
    expect(result.html).toContain("My Title");
    expect(result.html).toContain("<h2");
    expect(result.html).toContain("Subtitle");
    expect(result.toc).toBeDefined();
    expect(result.toc!.length).toBe(2);
    expect(result.toc![0].level).toBe(1);
    expect(result.toc![1].level).toBe(2);
  });

  it("parses bullet lists", () => {
    const input = "* Item one\n* Item two\n* Item three";
    const result = parseRst(input);
    expect(result.html).toContain("<ul>");
    expect(result.html).toContain("<li>Item one</li>");
    expect(result.html).toContain("<li>Item two</li>");
  });

  it("parses numbered lists", () => {
    const input = "1. First\n2. Second\n3. Third";
    const result = parseRst(input);
    expect(result.html).toContain("<ol>");
    expect(result.html).toContain("<li>First</li>");
  });

  it("parses admonitions (note, warning, etc.)", () => {
    const input = ".. note:: Important\n   This is a note.";
    const result = parseRst(input);
    expect(result.html).toContain("admonition note");
    expect(result.html).toContain("Important");
  });

  it("parses code blocks", () => {
    const input = ".. code-block:: python\n\n   print('hello')";
    const result = parseRst(input);
    expect(result.html).toContain("<pre>");
    expect(result.html).toContain("<code");
    expect(result.html).toContain("language-python");
  });

  it("parses images", () => {
    const input = ".. image:: /path/to/image.png\n   :alt: My Image";
    const result = parseRst(input);
    expect(result.html).toContain("<img");
    expect(result.html).toContain("/path/to/image.png");
    expect(result.html).toContain("My Image");
  });

  it("parses inline markup", () => {
    const input = "This is **bold** and *italic* text with ``code``.";
    const result = parseRst(input);
    expect(result.html).toContain("<strong>bold</strong>");
    expect(result.html).toContain("<em>italic</em>");
    expect(result.html).toContain("<code>code</code>");
  });

  it("escapes HTML in content", () => {
    const input = 'A <script>alert("xss")</script> test';
    const result = parseRst(input);
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
  });
});

describe("parseDocument", () => {
  it("auto-detects RST and parses", () => {
    const rst = "Title\n=====\n\nParagraph.";
    const result = parseDocument(rst, "auto", "doc.rst");
    expect(result.format).toBe("rst");
    expect(result.html).toContain("Title");
  });

  it("returns markdown content as-is", () => {
    const md = "# Title\n\nParagraph.";
    const result = parseDocument(md, "markdown");
    expect(result.format).toBe("markdown");
    expect(result.html).toBe(md);
  });

  it("forces RST format when specified", () => {
    const content = "Some text";
    const result = parseDocument(content, "rst");
    expect(result.format).toBe("rst");
  });
});
