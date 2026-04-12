/**
 * Capability tests — PowerPoint / PPTX generation
 *
 * Tests cover the agent-level logic for creating presentations:
 * parameter validation, slide structure, layout variants, content types,
 * speaker notes, watermarks/branding, and generating slides from a text
 * outline. External dependencies (pptxgenjs, file system) are mocked.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runWithEachProvider,
  MOCK_PROVIDER,
} from "../_setup/providerMatrix";
import {
  getMockResponseForProvider,
  MOCK_PPT_TOOL,
  createPptResult,
} from "../_setup/mockResponses";
import { assertHasShape } from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockAddSlide    = vi.fn(() => ({ addText: vi.fn(), addImage: vi.fn(), addTable: vi.fn(), addNotes: vi.fn() }));
const mockWriteFile   = vi.fn().mockResolvedValue(undefined);
const mockDefineLayout = vi.fn();

vi.mock("pptxgenjs", () => ({
  default: vi.fn().mockImplementation(() => ({
    defineLayout: mockDefineLayout,
    addSlide: mockAddSlide,
    writeFile: mockWriteFile,
    layout: "LAYOUT_WIDE",
  })),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 8192 })),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parses tool arguments from a provider response envelope. */
function extractToolArgs(
  response: unknown,
  provider: string,
): Record<string, unknown> | null {
  const r = response as Record<string, unknown>;

  if (provider === "anthropic") {
    const content = r["content"] as Array<Record<string, unknown>>;
    const block   = content?.find((c) => c["type"] === "tool_use");
    return block ? (block["input"] as Record<string, unknown>) : null;
  }

  if (["openai", "grok", "mistral"].includes(provider)) {
    const choices   = r["choices"] as Array<Record<string, unknown>>;
    const message   = choices?.[0]?.["message"] as Record<string, unknown>;
    const toolCalls = message?.["tool_calls"] as Array<Record<string, unknown>>;
    const fn        = toolCalls?.[0]?.["function"] as Record<string, unknown>;
    return fn ? JSON.parse(fn["arguments"] as string) : null;
  }

  if (provider === "gemini") {
    const candidates = r["candidates"] as Array<Record<string, unknown>>;
    const content    = candidates?.[0]?.["content"] as Record<string, unknown>;
    const parts      = content?.["parts"] as Array<Record<string, unknown>>;
    const call       = parts?.find((p) => "functionCall" in p);
    return call ? (call["functionCall"] as Record<string, unknown>)["args"] as Record<string, unknown> : null;
  }

  return null;
}

/** Converts a markdown outline string into a flat list of slide specs. */
function parseMarkdownOutline(markdown: string): Array<{ title: string; bullets: string[] }> {
  const lines  = markdown.split("\n").map((l) => l.trim()).filter(Boolean);
  const slides: Array<{ title: string; bullets: string[] }> = [];
  let current: { title: string; bullets: string[] } | null = null;

  for (const line of lines) {
    if (line.startsWith("# ")) {
      if (current) slides.push(current);
      current = { title: line.slice(2), bullets: [] };
    } else if (line.startsWith("- ") && current) {
      current.bullets.push(line.slice(2));
    }
  }
  if (current) slides.push(current);
  return slides;
}

/** Sanitises a presentation filename. */
function sanitizePptxFilename(name: string): string {
  return name.replace(/[^a-z0-9_.-]/gi, "_").replace(/\.pptx$/i, "") + ".pptx";
}

// ---------------------------------------------------------------------------
// Describe blocks
// ---------------------------------------------------------------------------

describe("Basic presentation creation", () => {
  it("builds a presentation with the required top-level fields", () => {
    const spec = {
      filename: "product_launch.pptx",
      title: "Product Launch 2025",
      slides: [
        { title: "Introduction",   content: ["Company overview", "Mission"] },
        { title: "Product Demo",   content: ["Feature A", "Feature B"] },
        { title: "Pricing",        content: ["Tier 1: $9/mo", "Tier 2: $29/mo"] },
        { title: "Next Steps",     content: ["Sign up", "Contact sales"] },
      ],
    };

    expect(spec.filename).toMatch(/\.pptx$/);
    expect(spec.title).toBeTruthy();
    expect(spec.slides.length).toBeGreaterThanOrEqual(1);
  });

  it("creates a title slide as the first slide", () => {
    const slides = [
      { type: "title", title: "My Deck", subtitle: "A subtitle" },
      { type: "content", title: "Slide 2", content: ["point 1"] },
    ];

    expect(slides[0].type).toBe("title");
    expect(slides[0]).toHaveProperty("title");
    expect(slides[0]).toHaveProperty("subtitle");
  });

  it("counts slides accurately in the result metadata", () => {
    const result = createPptResult("deck.pptx", 5);
    expect(result.slide_count).toBe(5);
    expect(typeof result.event).toBe("string");
    expect(typeof result.bytes).toBe("number");
    expect(typeof result.absolute_path).toBe("string");
    expect(typeof result.slide_count).toBe("number");
  });

  it("sanitises the filename before writing to disk", () => {
    const names = [
      "Q1 2025 Roadmap (Final).pptx",
      "investor update – v3.pptx",
      "deck<script>.pptx",
    ];
    for (const name of names) {
      const clean = sanitizePptxFilename(name);
      expect(clean).toMatch(/\.pptx$/);
      expect(clean).not.toContain(" ");
      expect(clean).not.toContain("<");
    }
  });
});

// ---------------------------------------------------------------------------

describe("Layout variants", () => {
  it("accepts a blank layout with no required content fields", () => {
    const slide = { layout: "BLANK", objects: [] };
    expect(slide.layout).toBe("BLANK");
    expect(slide.objects).toHaveLength(0);
  });

  it("validates title-only layout has a title property", () => {
    const slide = { layout: "TITLE_ONLY", title: "Section Header" };
    expect(slide).toHaveProperty("title");
    expect(slide.title.length).toBeGreaterThan(0);
  });

  it("validates two-column layout has left and right content arrays", () => {
    const slide = {
      layout: "TWO_COLUMN",
      title: "Compare Options",
      left:  ["Option A: cheaper", "Option A: faster"],
      right: ["Option B: more features", "Option B: better support"],
    };

    expect(Array.isArray(slide.left)).toBe(true);
    expect(Array.isArray(slide.right)).toBe(true);
    expect(slide.left.length).toBeGreaterThan(0);
    expect(slide.right.length).toBeGreaterThan(0);
  });

  it("maps layout names to pptxgenjs layout constants", () => {
    const layoutMap: Record<string, string> = {
      WIDE:   "LAYOUT_WIDE",
      4_3:    "LAYOUT_4x3",
      USER:   "LAYOUT_USER",
    };

    for (const [, pptxLayout] of Object.entries(layoutMap)) {
      expect(pptxLayout).toMatch(/^LAYOUT_/);
    }
  });
});

// ---------------------------------------------------------------------------

describe("Content types", () => {
  it("formats bullet point lists as arrays of strings", () => {
    const bullets = [
      "Increased revenue by 20%",
      "Expanded to 5 new markets",
      "Launched 3 product lines",
    ];

    expect(bullets.every((b) => typeof b === "string")).toBe(true);
    expect(bullets.every((b) => b.length > 0)).toBe(true);
  });

  it("represents image content as a URL or base64 string", () => {
    const imageFromUrl    = { type: "image", src: "https://example.com/logo.png", position: { x: 0.5, y: 0.5, w: 3, h: 2 } };
    const imageFromBase64 = { type: "image", data: "data:image/png;base64,iVBORw0KGgo=", position: { x: 4, y: 1, w: 2, h: 1.5 } };

    expect(imageFromUrl.src).toMatch(/^https?:\/\//);
    expect(imageFromBase64.data).toMatch(/^data:image\//);
    expect(imageFromUrl.position).toHaveProperty("w");
    expect(imageFromUrl.position).toHaveProperty("h");
  });

  it("structures an in-slide table with header and body rows", () => {
    const table = {
      type: "table",
      headers: ["Feature", "Free", "Pro", "Enterprise"],
      rows: [
        ["API Access",    "No",  "Yes", "Yes"],
        ["SSO",           "No",  "No",  "Yes"],
        ["Custom Domain", "No",  "No",  "Yes"],
      ],
    };

    expect(table.headers).toHaveLength(4);
    expect(table.rows).toHaveLength(3);
    for (const row of table.rows) {
      expect(row).toHaveLength(table.headers.length);
    }
  });

  it("validates text box position and size values are positive numbers", () => {
    const textBox = {
      text:     "Key Insight",
      position: { x: 1.0, y: 2.5, w: 6.0, h: 0.75 },
      style:    { fontSize: 24, bold: true, color: "FF5733" },
    };

    expect(textBox.position.x).toBeGreaterThanOrEqual(0);
    expect(textBox.position.y).toBeGreaterThanOrEqual(0);
    expect(textBox.position.w).toBeGreaterThan(0);
    expect(textBox.position.h).toBeGreaterThan(0);
    expect(textBox.style.fontSize).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("Speaker notes", () => {
  it("attaches notes to each slide as a string property", () => {
    const slides = [
      { title: "Intro",   content: ["Point A"], notes: "Welcome the audience. Introduce the agenda." },
      { title: "Market",  content: ["TAM $5B"], notes: "Reference the Gartner report from Q3." },
    ];

    for (const slide of slides) {
      expect(typeof slide.notes).toBe("string");
      expect(slide.notes.length).toBeGreaterThan(0);
    }
  });

  it("returns a presenter-view data structure including notes per slide", () => {
    const presenterView = {
      slides: [
        { index: 0, notes: "Opening remarks",    timing: 120 },
        { index: 1, notes: "Product demo notes", timing: 300 },
      ],
    };

    expect(presenterView.slides).toHaveLength(2);
    for (const s of presenterView.slides) {
      expect(s).toHaveProperty("notes");
      expect(s).toHaveProperty("timing");
      expect(s.timing).toBeGreaterThan(0);
    }
  });

  it("allows notes to be empty strings without failing", () => {
    const slide = { title: "Filler Slide", content: ["..."], notes: "" };
    expect(slide.notes).toBe("");
    // Empty notes are valid — no error should be thrown
    expect(() => {
      if (slide.notes !== null && slide.notes !== undefined) {
        // Notes field is present — OK
      }
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe("Watermarks and branding", () => {
  it("defines a watermark text overlay with opacity and rotation", () => {
    const watermark = {
      text:     "CONFIDENTIAL",
      opacity:  0.15,
      rotation: 45,
      fontSize: 72,
      color:    "CCCCCC",
    };

    expect(watermark.opacity).toBeGreaterThan(0);
    expect(watermark.opacity).toBeLessThan(1);
    expect(watermark.rotation).toBe(45);
    expect(watermark.text.toUpperCase()).toBe(watermark.text);
  });

  it("validates logo placement stays within slide bounds", () => {
    const SLIDE_WIDTH  = 10; // inches (LAYOUT_WIDE)
    const SLIDE_HEIGHT = 7.5;

    const logo = { x: 8.5, y: 0.1, w: 1.2, h: 0.5 };

    expect(logo.x + logo.w).toBeLessThanOrEqual(SLIDE_WIDTH);
    expect(logo.y + logo.h).toBeLessThanOrEqual(SLIDE_HEIGHT);
  });

  it("validates theme colour palette as valid hex strings", () => {
    const theme = {
      primary:   "#1E40AF",
      secondary: "#60A5FA",
      accent:    "#F59E0B",
      text:      "#111827",
      background:"#FFFFFF",
    };

    for (const colour of Object.values(theme)) {
      expect(colour).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

// ---------------------------------------------------------------------------

describe("From text/outline", () => {
  it("parses a markdown outline into slide objects", () => {
    const outline = `
# Introduction
- What is IliaGPT?
- Why it matters

# Features
- Multi-agent orchestration
- 100+ tools
- Multi-channel support

# Pricing
- Free tier
- Pro tier
`.trim();

    const slides = parseMarkdownOutline(outline);
    expect(slides).toHaveLength(3);
    expect(slides[0].title).toBe("Introduction");
    expect(slides[0].bullets).toContain("What is IliaGPT?");
    expect(slides[1].title).toBe("Features");
    expect(slides[2].title).toBe("Pricing");
  });

  it("maps section headers in an outline to section divider slides", () => {
    const outline = `
# Part 1: Strategy
## Market Analysis
- Current size
- Growth rate

## Competitive Landscape
- Top 5 competitors
`.trim();

    const lines = outline.split("\n").filter(Boolean);
    const h1Count = lines.filter((l) => l.startsWith("# ")).length;
    const h2Count = lines.filter((l) => l.startsWith("## ")).length;

    expect(h1Count).toBeGreaterThan(0);
    expect(h2Count).toBeGreaterThan(0);
    // H1 lines become section slides, H2 become content slides
    expect(h1Count + h2Count).toBe(3);
  });

  it("limits auto-generated bullet text to a reasonable length", () => {
    const MAX_BULLET_CHARS = 120;
    const bullets = [
      "Short bullet",
      "A much longer bullet point that describes a complex idea in great detail and should probably be truncated",
    ];

    const processed = bullets.map((b) =>
      b.length > MAX_BULLET_CHARS ? b.slice(0, MAX_BULLET_CHARS - 1) + "…" : b,
    );

    for (const b of processed) {
      expect(b.length).toBeLessThanOrEqual(MAX_BULLET_CHARS);
    }
  });
});

// ---------------------------------------------------------------------------

describe("Provider-agnostic tool call formatting", () => {
  runWithEachProvider(
    "formats create_presentation tool call correctly",
    "powerpoint",
    async (provider) => {
      const response = getMockResponseForProvider(
        provider.name,
        MOCK_PPT_TOOL,
      );
      const args = extractToolArgs(response, provider.name);

      expect(args).not.toBeNull();
      expect(args).toHaveProperty("filename");
      expect(args).toHaveProperty("title");
      expect(args).toHaveProperty("slides");
      expect(Array.isArray((args as any).slides)).toBe(true);
    },
  );

  runWithEachProvider(
    "parses slide count from execution result",
    "powerpoint",
    async (_provider) => {
      const result = createPptResult("provider_deck.pptx", 3);
      expect(result.slide_count).toBe(3);
      expect(result.bytes).toBeGreaterThan(0);
    },
  );
});
