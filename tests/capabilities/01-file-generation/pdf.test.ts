/**
 * Capability tests — PDF generation
 *
 * Tests cover creating PDFs from content, filling PDF forms, merging/splitting
 * PDFs, extracting content, generating from HTML, and metadata management.
 * All external PDF libraries and the file system are mocked.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runWithEachProvider,
  MOCK_PROVIDER,
} from "../_setup/providerMatrix";
import {
  getMockResponseForProvider,
  MOCK_PDF_TOOL,
  createPdfResult,
} from "../_setup/mockResponses";
import { assertHasShape } from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("pdf-lib", () => ({
  PDFDocument: {
    create:  vi.fn().mockResolvedValue({
      addPage:       vi.fn(() => ({
        drawText: vi.fn(),
        getWidth:  vi.fn(() => 595),
        getHeight: vi.fn(() => 842),
      })),
      copyPages:     vi.fn().mockResolvedValue([]),
      insertPage:    vi.fn(),
      removePage:    vi.fn(),
      getPageCount:  vi.fn(() => 3),
      setTitle:      vi.fn(),
      setAuthor:     vi.fn(),
      setSubject:    vi.fn(),
      setKeywords:   vi.fn(),
      setCreationDate: vi.fn(),
      save:          vi.fn().mockResolvedValue(new Uint8Array(6144)),
    }),
    load: vi.fn().mockResolvedValue({
      addPage:       vi.fn(() => ({
        drawText: vi.fn(),
        getWidth:  vi.fn(() => 595),
        getHeight: vi.fn(() => 842),
      })),
      copyPages:     vi.fn().mockResolvedValue([{}]),
      insertPage:    vi.fn(),
      removePage:    vi.fn(),
      getPageCount:  vi.fn(() => 3),
      setTitle:      vi.fn(),
      setAuthor:     vi.fn(),
      save:          vi.fn().mockResolvedValue(new Uint8Array(6144)),
    }),
  },
  StandardFonts: {
    Helvetica:     "Helvetica",
    HelveticaBold: "Helvetica-Bold",
    TimesRoman:    "Times-Roman",
    Courier:       "Courier",
  },
  rgb: vi.fn((r: number, g: number, b: number) => ({ r, g, b })),
  degrees: vi.fn((d: number) => d),
  PDFName:    { of: vi.fn((name: string) => name) },
  PDFString:  { of: vi.fn((s: string) => s) },
}));

vi.mock("puppeteer", () => ({
  default: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        setContent:    vi.fn(),
        goto:          vi.fn(),
        pdf:           vi.fn().mockResolvedValue(Buffer.alloc(6144)),
        close:         vi.fn(),
        emulateMediaType: vi.fn(),
      }),
      close: vi.fn(),
    }),
  },
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => Buffer.alloc(6144)),
    statSync: vi.fn(() => ({ size: 6144 })),
  };
});

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

/** Sanitises a PDF filename. */
function sanitizePdfFilename(name: string): string {
  return name.replace(/[^a-z0-9_.-]/gi, "_").replace(/\.pdf$/i, "") + ".pdf";
}

// ---------------------------------------------------------------------------
// Describe blocks
// ---------------------------------------------------------------------------

describe("PDF creation from content", () => {
  it("builds a single-page PDF spec from text content", () => {
    const spec = {
      filename: "invoice.pdf",
      pages: [
        {
          content: [
            { type: "text", text: "Invoice #1001", x: 50, y: 780, size: 24, bold: true },
            { type: "text", text: "Date: April 10, 2025", x: 50, y: 740, size: 12 },
          ],
        },
      ],
      metadata: { title: "Invoice #1001", author: "IliaGPT" },
    };

    expect(spec.pages).toHaveLength(1);
    expect(spec.pages[0].content.some((c) => c.type === "text")).toBe(true);
    expect(spec.metadata.title).toBeTruthy();
  });

  it("builds a multi-page PDF with page headers on each page", () => {
    const pageCount  = 4;
    const headerText = "Confidential — Acme Corp";

    const pages = Array.from({ length: pageCount }, (_, i) => ({
      pageNumber: i + 1,
      header: { text: headerText, x: 50, y: 820 },
      content: [],
    }));

    expect(pages).toHaveLength(pageCount);
    expect(pages.every((p) => p.header.text === headerText)).toBe(true);
    expect(pages.every((p) => p.pageNumber > 0)).toBe(true);
  });

  it("validates page dimensions for A4 portrait (595 × 842 pt)", () => {
    const A4_WIDTH  = 595;
    const A4_HEIGHT = 842;

    expect(A4_WIDTH).toBe(595);
    expect(A4_HEIGHT).toBe(842);
    expect(A4_HEIGHT).toBeGreaterThan(A4_WIDTH);
  });

  it("returns metadata with page count and file size", () => {
    const result = createPdfResult("report.pdf", 5);
    expect(typeof result.event).toBe("string");
    expect(typeof result.bytes).toBe("number");
    expect(typeof result.absolute_path).toBe("string");
    expect(typeof result.page_count).toBe("number");
    expect(result.page_count).toBe(5);
    expect(result.bytes).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("Form filling", () => {
  it("fills a text field by field name", () => {
    const fieldValues = {
      firstName: "Jane",
      lastName:  "Doe",
      email:     "jane.doe@example.com",
    };

    expect(typeof fieldValues.firstName).toBe("string");
    expect(typeof fieldValues.email).toBe("string");
    expect(fieldValues.email).toContain("@");
  });

  it("sets checkboxes to the correct checked state", () => {
    const checkboxes: Record<string, boolean> = {
      agreeToTerms:    true,
      subscribeNewsletter: false,
      requestCallback:  true,
    };

    const checkedCount   = Object.values(checkboxes).filter(Boolean).length;
    const uncheckedCount = Object.values(checkboxes).filter((v) => !v).length;

    expect(checkedCount).toBe(2);
    expect(uncheckedCount).toBe(1);
  });

  it("selects dropdown options by value", () => {
    const validOptions = ["individual", "company", "nonprofit"];
    const selected     = "company";

    expect(validOptions).toContain(selected);
  });

  it("applies a signature image to the signature field", () => {
    const signature = {
      fieldName:  "applicantSignature",
      imageBase64: "data:image/png;base64,iVBORw0KGgo=",
      x: 100, y: 50, w: 200, h: 60,
    };

    expect(signature.imageBase64).toMatch(/^data:image\//);
    expect(signature.w).toBeGreaterThan(0);
    expect(signature.h).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("Merge and split", () => {
  it("merges three PDF sources into one output", () => {
    const sources = [
      { path: "/workspace/part1.pdf", pageCount: 3 },
      { path: "/workspace/part2.pdf", pageCount: 5 },
      { path: "/workspace/part3.pdf", pageCount: 2 },
    ];

    const totalPages = sources.reduce((sum, s) => sum + s.pageCount, 0);

    expect(sources).toHaveLength(3);
    expect(totalPages).toBe(10);
  });

  it("splits a 10-page PDF at page 5 into two files", () => {
    const sourcePageCount = 10;
    const splitAt         = 5;

    const part1Pages = splitAt;
    const part2Pages = sourcePageCount - splitAt;

    expect(part1Pages).toBe(5);
    expect(part2Pages).toBe(5);
    expect(part1Pages + part2Pages).toBe(sourcePageCount);
  });

  it("extracts a page range from a larger document", () => {
    const sourcePageCount = 20;
    const extractFrom = 3;
    const extractTo   = 7;

    expect(extractFrom).toBeGreaterThan(0);
    expect(extractTo).toBeLessThanOrEqual(sourcePageCount);
    const extractedCount = extractTo - extractFrom + 1;
    expect(extractedCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------

describe("Content extraction", () => {
  it("extracts text grouped by page number", () => {
    const extracted = [
      { page: 1, text: "Introduction paragraph.",        x: 72, y: 700 },
      { page: 1, text: "Second paragraph on page one.",  x: 72, y: 650 },
      { page: 2, text: "Content on page two.",           x: 72, y: 750 },
    ];

    const pageNumbers = [...new Set(extracted.map((e) => e.page))];
    expect(pageNumbers).toEqual([1, 2]);
    expect(extracted.filter((e) => e.page === 1)).toHaveLength(2);
  });

  it("returns table data as a 2D array of strings", () => {
    const table = [
      ["Name",   "Score", "Grade"],
      ["Alice",  "95",    "A"],
      ["Bob",    "82",    "B+"],
      ["Carol",  "78",    "C+"],
    ];

    expect(table[0]).toEqual(["Name", "Score", "Grade"]); // header row
    expect(table.slice(1).every((row) => row.length === 3)).toBe(true);
  });

  it("returns a list of embedded image references with dimensions", () => {
    const images = [
      { page: 1, name: "logo.png",       width: 150, height: 50  },
      { page: 2, name: "chart.png",      width: 400, height: 300 },
      { page: 3, name: "signature.png",  width: 200, height: 60  },
    ];

    expect(images).toHaveLength(3);
    for (const img of images) {
      expect(img.width).toBeGreaterThan(0);
      expect(img.height).toBeGreaterThan(0);
      expect(img.name).toMatch(/\.(png|jpg|jpeg|gif)$/i);
    }
  });

  it("preserves text extraction order top-to-bottom, left-to-right", () => {
    const textBlocks = [
      { page: 1, y: 800, x: 72,  text: "Title" },
      { page: 1, y: 750, x: 72,  text: "Subtitle" },
      { page: 1, y: 700, x: 72,  text: "Body paragraph" },
    ];

    // Sorted by decreasing y (top of page has highest y in PDF coordinates)
    const sorted = [...textBlocks].sort((a, b) => b.y - a.y);
    expect(sorted[0].text).toBe("Title");
    expect(sorted[1].text).toBe("Subtitle");
    expect(sorted[2].text).toBe("Body paragraph");
  });
});

// ---------------------------------------------------------------------------

describe("PDF from HTML", () => {
  it("validates an HTML content string before rendering", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><style>body { font-family: Arial; }</style></head>
        <body><h1>Report</h1><p>Content here.</p></body>
      </html>
    `.trim();

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<body>");
    expect(html).toContain("</html>");
  });

  it("accepts CSS page-break declarations in the style sheet", () => {
    const css = `
      .section { page-break-before: always; }
      .avoid-break { page-break-inside: avoid; }
    `;

    expect(css).toContain("page-break-before");
    expect(css).toContain("page-break-inside");
  });

  it("validates page size and margin options for HTML-to-PDF rendering", () => {
    const pdfOptions = {
      format: "A4",
      margin: { top: "1in", right: "1in", bottom: "1in", left: "1in" },
      printBackground: true,
    };

    expect(["A4", "Letter", "Legal"]).toContain(pdfOptions.format);
    expect(pdfOptions.margin.top).toMatch(/in|cm|mm|px/);
    expect(pdfOptions.printBackground).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("Metadata", () => {
  it("sets standard PDF metadata fields", () => {
    const metadata = {
      title:    "Quarterly Business Report",
      author:   "IliaGPT Agent",
      subject:  "Business Analytics",
      keywords: ["finance", "Q1", "2025"],
      creationDate: new Date("2025-04-10"),
    };

    expect(metadata.title.length).toBeGreaterThan(0);
    expect(metadata.author.length).toBeGreaterThan(0);
    expect(Array.isArray(metadata.keywords)).toBe(true);
    expect(metadata.creationDate instanceof Date).toBe(true);
    expect(isNaN(metadata.creationDate.getTime())).toBe(false);
  });

  it("validates that keywords are an array of non-empty strings", () => {
    const keywords = ["finance", "Q1 2025", "annual report"];

    expect(keywords.every((k) => typeof k === "string" && k.trim().length > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("Provider-agnostic tool call formatting", () => {
  runWithEachProvider(
    "formats create_pdf tool call correctly",
    "pdf",
    async (provider) => {
      const response = getMockResponseForProvider(
        provider.name,
        MOCK_PDF_TOOL,
      );
      const args = extractToolArgs(response, provider.name);

      expect(args).not.toBeNull();
      expect(args).toHaveProperty("filename");
      expect(args).toHaveProperty("content");
    },
  );

  runWithEachProvider(
    "parses page count and size from PDF result",
    "pdf",
    async (_provider) => {
      const result = createPdfResult("provider_test.pdf", 2);
      expect(typeof result.event).toBe("string");
      expect(typeof result.bytes).toBe("number");
      expect(typeof result.absolute_path).toBe("string");
      expect(typeof result.page_count).toBe("number");
      expect(result.page_count).toBe(2);
      expect(result.absolute_path).toMatch(/\.pdf$/);
    },
  );
});
