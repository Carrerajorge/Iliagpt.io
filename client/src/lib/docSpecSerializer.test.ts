import { describe, it, expect } from "vitest";
import { tiptapToDocSpec } from "./docSpecSerializer";

describe("tiptapToDocSpec", () => {
  it("creates a DocSpec with title and defaults", () => {
    const doc = { type: "doc" as const, content: [] };
    const spec = tiptapToDocSpec(doc, "My Title");
    expect(spec.title).toBe("My Title");
    expect(spec.styleset).toBe("modern");
    expect(spec.blocks).toEqual([]);
    expect(spec.add_toc).toBe(false);
  });

  it("uses default title", () => {
    const doc = { type: "doc" as const, content: [] };
    const spec = tiptapToDocSpec(doc);
    expect(spec.title).toBe("Document");
  });

  it("converts headings", () => {
    const doc = {
      type: "doc" as const,
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "My Heading" }] },
      ],
    };
    const spec = tiptapToDocSpec(doc);
    expect(spec.blocks).toHaveLength(1);
    expect(spec.blocks[0].type).toBe("heading");
    expect((spec.blocks[0] as any).level).toBe(2);
    expect((spec.blocks[0] as any).text).toBe("My Heading");
  });

  it("converts paragraphs", () => {
    const doc = {
      type: "doc" as const,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
      ],
    };
    const spec = tiptapToDocSpec(doc);
    expect(spec.blocks).toHaveLength(1);
    expect(spec.blocks[0].type).toBe("paragraph");
    expect((spec.blocks[0] as any).text).toBe("Hello world");
  });

  it("skips empty paragraphs", () => {
    const doc = {
      type: "doc" as const,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "" }] },
        { type: "paragraph", content: [{ type: "text", text: "  " }] },
      ],
    };
    const spec = tiptapToDocSpec(doc);
    expect(spec.blocks).toHaveLength(0);
  });

  it("converts bullet lists", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item 1" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item 2" }] }] },
          ],
        },
      ],
    };
    const spec = tiptapToDocSpec(doc);
    expect(spec.blocks).toHaveLength(1);
    expect(spec.blocks[0].type).toBe("bullets");
    expect((spec.blocks[0] as any).items).toEqual(["Item 1", "Item 2"]);
  });

  it("converts ordered lists with numbering", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Second" }] }] },
          ],
        },
      ],
    };
    const spec = tiptapToDocSpec(doc);
    expect((spec.blocks[0] as any).items[0]).toBe("1. First");
    expect((spec.blocks[0] as any).items[1]).toBe("2. Second");
  });

  it("converts blockquotes", () => {
    const doc = {
      type: "doc" as const,
      content: [
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Quote" }] }] },
      ],
    };
    const spec = tiptapToDocSpec(doc);
    expect(spec.blocks[0].type).toBe("paragraph");
    expect((spec.blocks[0] as any).text).toContain("> Quote");
  });

  it("converts horizontal rules to page breaks", () => {
    const doc = {
      type: "doc" as const,
      content: [{ type: "horizontalRule" }],
    };
    const spec = tiptapToDocSpec(doc);
    expect(spec.blocks[0].type).toBe("page_break");
  });

  it("handles bold/italic/underline marks", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " " },
            { type: "text", text: "italic", marks: [{ type: "italic" }] },
          ],
        },
      ],
    };
    const spec = tiptapToDocSpec(doc);
    expect((spec.blocks[0] as any).text).toContain("**bold**");
    expect((spec.blocks[0] as any).text).toContain("*italic*");
  });

  it("handles links", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "click", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
          ],
        },
      ],
    };
    const spec = tiptapToDocSpec(doc);
    expect((spec.blocks[0] as any).text).toContain("[click](https://example.com)");
  });

  it("handles math nodes", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "inlineMath", attrs: { latex: "x^2" } },
          ],
        },
      ],
    };
    const spec = tiptapToDocSpec(doc);
    expect((spec.blocks[0] as any).text).toContain("$x^2$");
  });

  it("skips unknown node types", () => {
    const doc = {
      type: "doc" as const,
      content: [{ type: "unknownNode" }],
    };
    const spec = tiptapToDocSpec(doc);
    expect(spec.blocks).toHaveLength(0);
  });
});
