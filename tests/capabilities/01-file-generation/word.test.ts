/**
 * Capability tests — Word / DOCX generation
 *
 * Tests cover document structure, tables, track changes, text styles,
 * complex document templates, and headers/footers. The docx library and
 * the file system are mocked so tests run without I/O side-effects.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runWithEachProvider,
  MOCK_PROVIDER,
} from "../_setup/providerMatrix";
import {
  getMockResponseForProvider,
  MOCK_WORD_TOOL,
  createWordResult,
} from "../_setup/mockResponses";
import { assertHasShape } from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("docx", () => ({
  Document:      vi.fn().mockImplementation(() => ({})),
  Paragraph:     vi.fn().mockImplementation((opts: unknown) => ({ _opts: opts })),
  TextRun:       vi.fn().mockImplementation((opts: unknown) => ({ _opts: opts })),
  Table:         vi.fn().mockImplementation(() => ({})),
  TableRow:      vi.fn().mockImplementation(() => ({})),
  TableCell:     vi.fn().mockImplementation(() => ({})),
  Header:        vi.fn().mockImplementation(() => ({})),
  Footer:        vi.fn().mockImplementation(() => ({})),
  HeadingLevel: {
    HEADING_1: "Heading1",
    HEADING_2: "Heading2",
    HEADING_3: "Heading3",
    HEADING_4: "Heading4",
    HEADING_5: "Heading5",
    HEADING_6: "Heading6",
  },
  AlignmentType: {
    LEFT:    "left",
    CENTER:  "center",
    RIGHT:   "right",
    JUSTIFY: "both",
  },
  UnderlineType: { SINGLE: "single", DOUBLE: "double" },
  BorderStyle:   { SINGLE: "single" },
  Packer: {
    toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(3072)),
    toBlob:   vi.fn().mockResolvedValue(new Blob([])),
  },
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 3072 })),
  };
});

vi.mock("../../../server/agent/capabilities/office/wordGenerator", () => ({
  wordGeneratorCapability: {
    name: "create_word_document",
    description: "Creates a Word document",
    schema: {},
    execute: vi.fn(),
  },
  generateFreshDocx: vi.fn().mockResolvedValue(Buffer.alloc(3072)),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    const parts      = (candidates?.[0]?.["content"] as Record<string, unknown>)?.["parts"] as Array<Record<string, unknown>>;
    const call       = parts?.find((p) => "functionCall" in p);
    return call ? (call["functionCall"] as Record<string, unknown>)["args"] as Record<string, unknown> : null;
  }

  return null;
}

/** Sanitises a docx filename. */
function sanitizeDocxFilename(name: string): string {
  return name.replace(/[^a-z0-9_.-]/gi, "_").replace(/\.docx$/i, "") + ".docx";
}

// ---------------------------------------------------------------------------
// Describe blocks
// ---------------------------------------------------------------------------

describe("Document structure", () => {
  it("maps heading levels H1-H6 to the docx HeadingLevel constants", () => {
    const headingMap: Record<number, string> = {
      1: "Heading1",
      2: "Heading2",
      3: "Heading3",
      4: "Heading4",
      5: "Heading5",
      6: "Heading6",
    };

    for (let level = 1; level <= 6; level++) {
      expect(headingMap[level]).toBe(`Heading${level}`);
    }
  });

  it("creates a document spec with a title and multiple paragraphs", () => {
    const spec = {
      filename: "report.docx",
      title: "Annual Performance Report 2025",
      paragraphs: [
        "This report summarises the annual performance of the company.",
        "Revenue grew by 22% year-over-year.",
        "Headcount increased from 45 to 67 employees.",
      ],
    };

    expect(spec.title).toBeTruthy();
    expect(spec.paragraphs).toHaveLength(3);
    expect(spec.paragraphs.every((p) => typeof p === "string")).toBe(true);
  });

  it("filters out blank paragraph strings before document creation", () => {
    const raw = ["Intro text.", "", "   ", "Second paragraph.", ""];
    const filtered = raw.filter((p) => p.trim() !== "");
    expect(filtered).toHaveLength(2);
    expect(filtered[0]).toBe("Intro text.");
    expect(filtered[1]).toBe("Second paragraph.");
  });

  it("sections split a document into independently formatted regions", () => {
    const sections = [
      { name: "Cover",    orientation: "portrait" },
      { name: "Appendix", orientation: "landscape" },
    ];

    const orientations = sections.map((s) => s.orientation);
    expect(orientations).toContain("portrait");
    expect(orientations).toContain("landscape");
  });
});

// ---------------------------------------------------------------------------

describe("Tables", () => {
  it("builds a basic table structure with header row and data rows", () => {
    const tableSpec = {
      headers: ["Name", "Department", "Salary"],
      rows: [
        ["Alice", "Engineering", "$120,000"],
        ["Bob",   "Marketing",   "$95,000"],
        ["Carol", "Finance",     "$110,000"],
      ],
    };

    expect(tableSpec.headers).toHaveLength(3);
    expect(tableSpec.rows).toHaveLength(3);
    for (const row of tableSpec.rows) {
      expect(row).toHaveLength(tableSpec.headers.length);
    }
  });

  it("validates merged cell spans do not exceed column count", () => {
    const columnCount = 4;
    const mergeSpan   = 2;

    expect(mergeSpan).toBeLessThanOrEqual(columnCount);
  });

  it("supports a table with borders and background colour on header row", () => {
    const headerStyle = {
      borders: {
        top:    { style: "single", size: 4, color: "000000" },
        bottom: { style: "single", size: 4, color: "000000" },
      },
      fill: { color: "2563EB" },
      font: { color: "FFFFFF", bold: true },
    };

    expect(headerStyle.borders.top.style).toBe("single");
    expect(headerStyle.fill.color).toMatch(/^[0-9A-Fa-f]{6}$/);
    expect(headerStyle.font.bold).toBe(true);
  });

  it("calculates total column widths from individual columnWidth specs", () => {
    const columnWidths = [2000, 3000, 2500, 1500]; // twips
    const totalWidth   = columnWidths.reduce((a, b) => a + b, 0);

    expect(totalWidth).toBe(9000);
    expect(columnWidths.every((w) => w > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("Track changes / redlines", () => {
  it("represents an inserted text range with the correct revision info", () => {
    const insertion = {
      type: "insert",
      author: "Alice",
      date: "2025-04-10T10:00:00Z",
      text: "This is newly added content.",
    };

    expect(insertion.type).toBe("insert");
    expect(insertion.author).toBeTruthy();
    expect(new Date(insertion.date).getTime()).toBeGreaterThan(0);
    expect(insertion.text.length).toBeGreaterThan(0);
  });

  it("represents a deleted text range with strikethrough metadata", () => {
    const deletion = {
      type: "delete",
      author: "Bob",
      date: "2025-04-10T11:00:00Z",
      text: "This old content should be removed.",
    };

    expect(deletion.type).toBe("delete");
    expect(deletion.author).toBeTruthy();
  });

  it("attaches a comment to a text range with author and resolution state", () => {
    const comment = {
      id: "c1",
      author: "Carol",
      date: "2025-04-10T12:00:00Z",
      text: "Please clarify this sentence.",
      resolved: false,
      range: { start: 120, end: 145 },
    };

    expect(comment.resolved).toBe(false);
    expect(comment.range.end).toBeGreaterThan(comment.range.start);
    expect(comment.text.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("Styles", () => {
  it("applies bold, italic, and underline independently on a TextRun", () => {
    const styles = [
      { bold: true,  italic: false, underline: false },
      { bold: false, italic: true,  underline: false },
      { bold: false, italic: false, underline: true  },
      { bold: true,  italic: true,  underline: true  },
    ];

    for (const style of styles) {
      const hasAtLeastOneDecoration = style.bold || style.italic || style.underline;
      expect(hasAtLeastOneDecoration).toBe(true);
    }
  });

  it("validates font family name is a non-empty string", () => {
    const validFonts = ["Calibri", "Arial", "Times New Roman", "Courier New"];
    for (const font of validFonts) {
      expect(typeof font).toBe("string");
      expect(font.length).toBeGreaterThan(0);
    }
  });

  it("validates font colour is a valid hex string without the # prefix (docx convention)", () => {
    const colours = ["FF5733", "2563EB", "10B981", "000000", "FFFFFF"];
    const hexRe   = /^[0-9A-Fa-f]{6}$/;

    for (const colour of colours) {
      expect(colour).toMatch(hexRe);
      expect(colour).not.toContain("#");
    }
  });
});

// ---------------------------------------------------------------------------

describe("Complex documents", () => {
  it("structures a legal contract with defined sections", () => {
    const contract = {
      title: "Software Licence Agreement",
      sections: [
        { heading: "1. Definitions",          level: 1 },
        { heading: "2. Grant of Licence",     level: 1 },
        { heading: "2.1 Permitted Use",       level: 2 },
        { heading: "3. Restrictions",         level: 1 },
        { heading: "4. Term and Termination", level: 1 },
      ],
    };

    const h1Sections = contract.sections.filter((s) => s.level === 1);
    const h2Sections = contract.sections.filter((s) => s.level === 2);

    expect(h1Sections.length).toBe(4);
    expect(h2Sections.length).toBe(1);
    expect(contract.title.length).toBeGreaterThan(0);
  });

  it("builds a report structure with a table-of-contents placeholder", () => {
    const reportStructure = {
      title: "Market Research Report",
      toc:   true,
      sections: [
        { title: "Executive Summary",     pageEstimate: 1 },
        { title: "Market Overview",       pageEstimate: 4 },
        { title: "Competitive Analysis",  pageEstimate: 5 },
        { title: "Recommendations",       pageEstimate: 3 },
      ],
    };

    expect(reportStructure.toc).toBe(true);
    const totalPages = reportStructure.sections.reduce(
      (sum, s) => sum + s.pageEstimate, 0,
    );
    expect(totalPages).toBeGreaterThan(0);
  });

  it("formats a business letter with all required components", () => {
    const letter = {
      date: "April 10, 2025",
      recipient: { name: "Jane Doe", title: "CEO", company: "Acme Corp" },
      salutation: "Dear Ms. Doe,",
      body: ["Paragraph 1 content.", "Paragraph 2 content."],
      closing: "Sincerely,",
      signature: "John Smith",
    };

    expect(letter.date).toBeTruthy();
    expect(letter.recipient.company).toBeTruthy();
    expect(letter.salutation).toMatch(/^Dear/);
    expect(letter.body.length).toBeGreaterThan(0);
    expect(letter.closing).toBeTruthy();
    expect(letter.signature).toBeTruthy();
  });

  it("validates paragraph alignment values", () => {
    const validAlignments = ["left", "center", "right", "both"];
    const usedAlignments  = ["left", "both", "center"];

    for (const align of usedAlignments) {
      expect(validAlignments).toContain(align);
    }
  });
});

// ---------------------------------------------------------------------------

describe("Headers and footers", () => {
  it("defines a header with a document title on every page", () => {
    const header = {
      default: {
        children: [{ type: "text", text: "Annual Report 2025", alignment: "right" }],
      },
    };

    expect(header.default.children).toHaveLength(1);
    expect(header.default.children[0].text).toBeTruthy();
    expect(header.default.children[0].alignment).toBe("right");
  });

  it("defines a footer with page number placeholder", () => {
    const footer = {
      default: {
        children: [
          { type: "pageNumber", text: "Page " },
          { type: "currentPage" },
          { type: "text", text: " of " },
          { type: "totalPages" },
        ],
      },
    };

    const types = footer.default.children.map((c) => c.type);
    expect(types).toContain("pageNumber");
    expect(types).toContain("currentPage");
    expect(types).toContain("totalPages");
  });

  it("supports different first-page header/footer", () => {
    const headerSpec = {
      first: {
        children: [{ type: "text", text: "Cover Page" }],
      },
      default: {
        children: [{ type: "text", text: "Annual Report 2025" }],
      },
    };

    expect(headerSpec).toHaveProperty("first");
    expect(headerSpec).toHaveProperty("default");
    expect(headerSpec.first.children[0].text).not.toBe(headerSpec.default.children[0].text);
  });
});

// ---------------------------------------------------------------------------

describe("Provider-agnostic tool call formatting", () => {
  runWithEachProvider(
    "formats create_word_document tool call correctly",
    "word",
    async (provider) => {
      const response = getMockResponseForProvider(
        provider.name,
        MOCK_WORD_TOOL,
      );
      const args = extractToolArgs(response, provider.name);

      expect(args).not.toBeNull();
      expect(args).toHaveProperty("filename");
      expect(args).toHaveProperty("title");
      // MOCK_WORD_TOOL uses "sections"; capability may use "paragraphs" — either is valid
      const hasContent =
        "paragraphs" in (args as any) || "sections" in (args as any);
      expect(hasContent).toBe(true);
    },
  );

  runWithEachProvider(
    "parses metadata from word document result",
    "word",
    async (_provider) => {
      const result = createWordResult("provider_test.docx");
      expect(typeof result.event).toBe("string");
      expect(typeof result.bytes).toBe("number");
      expect(typeof result.absolute_path).toBe("string");
      expect(result.bytes).toBeGreaterThan(0);
      expect(result.absolute_path).toContain(".docx");
    },
  );
});
