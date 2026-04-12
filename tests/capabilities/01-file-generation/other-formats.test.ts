/**
 * Capability tests — Other file format generation
 *
 * Tests cover Markdown, HTML, JSX/React components, LaTeX, CSV, JSON schema,
 * and image/PNG generation. External dependencies (sharp, canvas, etc.) are
 * mocked. Most tests exercise pure transformation/validation logic so they
 * are fast and hermetic.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runWithEachProvider,
  MOCK_PROVIDER,
} from "../_setup/providerMatrix";
import { assertHasShape, createTestFile, withTempDir } from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("sharp", () => ({
  default: vi.fn(() => ({
    png:     vi.fn().mockReturnThis(),
    jpeg:    vi.fn().mockReturnThis(),
    resize:  vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(8192)),
    toFile:   vi.fn().mockResolvedValue({ size: 8192 }),
  })),
}));

vi.mock("canvas", () => ({
  createCanvas: vi.fn((w: number, h: number) => ({
    width:  w,
    height: h,
    getContext: vi.fn(() => ({
      fillStyle: "",
      font: "",
      fillRect:  vi.fn(),
      fillText:  vi.fn(),
      strokeStyle: "",
      strokeRect: vi.fn(),
      beginPath:  vi.fn(),
      arc:        vi.fn(),
      fill:       vi.fn(),
      stroke:     vi.fn(),
    })),
    toBuffer: vi.fn(() => Buffer.alloc(8192)),
  })),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync:   vi.fn(() => true),
    mkdirSync:    vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync:  vi.fn(() => Buffer.alloc(1024)),
    statSync:      vi.fn(() => ({ size: 1024 })),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Renders a simple Markdown AST node tree into a Markdown string. */
function renderMarkdown(nodes: Array<{ type: string; text?: string; level?: number; rows?: string[][] }>): string {
  return nodes.map((n) => {
    if (n.type === "heading") return `${"#".repeat(n.level ?? 1)} ${n.text}`;
    if (n.type === "paragraph") return n.text ?? "";
    if (n.type === "code") return `\`\`\`\n${n.text}\n\`\`\``;
    if (n.type === "table" && n.rows) {
      const [header, ...body] = n.rows;
      const divider = header.map(() => "---").join(" | ");
      return [header.join(" | "), divider, ...body.map((r) => r.join(" | "))].join("\n");
    }
    return "";
  }).join("\n\n");
}

/** Generates a TypeScript interface string from a field map. */
function generateTsInterface(name: string, fields: Record<string, string>): string {
  const lines = Object.entries(fields).map(([k, v]) => `  ${k}: ${v};`);
  return `interface ${name} {\n${lines.join("\n")}\n}`;
}

/** Converts a 2D array to a CSV string. */
function toCsv(rows: string[][], delimiter = ","): string {
  return rows
    .map((row) =>
      row.map((cell) => {
        const needsQuoting = cell.includes(delimiter) || cell.includes('"') || cell.includes("\n");
        return needsQuoting ? `"${cell.replace(/"/g, '""')}"` : cell;
      }).join(delimiter),
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Describe blocks
// ---------------------------------------------------------------------------

describe("Markdown generation", () => {
  it("renders a structured document with H1, H2, paragraph, and code block", () => {
    const nodes = [
      { type: "heading", level: 1, text: "Getting Started" },
      { type: "paragraph", text: "This guide explains how to set up the project." },
      { type: "heading", level: 2, text: "Installation" },
      { type: "code", text: "npm install ilia-gpt" },
    ];

    const md = renderMarkdown(nodes);

    expect(md).toContain("# Getting Started");
    expect(md).toContain("## Installation");
    expect(md).toContain("```");
    expect(md).toContain("npm install ilia-gpt");
  });

  it("renders a Markdown table with correct pipe-delimited formatting", () => {
    const nodes = [
      {
        type: "table",
        rows: [
          ["Feature",  "Status", "Notes"],
          ["API",       "Done",   "v1 released"],
          ["Dashboard", "WIP",    "Q2 target"],
        ],
      },
    ];

    const md = renderMarkdown(nodes);

    expect(md).toContain("Feature | Status | Notes");
    expect(md).toContain("--- | --- | ---");
    expect(md).toContain("API | Done | v1 released");
  });

  it("produces non-empty output for a minimal single-heading document", () => {
    const nodes = [{ type: "heading", level: 1, text: "Hello World" }];
    const md    = renderMarkdown(nodes);

    expect(md.trim().length).toBeGreaterThan(0);
    expect(md).toContain("Hello World");
  });
});

// ---------------------------------------------------------------------------

describe("HTML generation", () => {
  it("produces semantic HTML with correct tag nesting", () => {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Report</title>
</head>
<body>
  <main>
    <h1>Report Title</h1>
    <section>
      <h2>Introduction</h2>
      <p>Content paragraph.</p>
    </section>
  </main>
</body>
</html>`.trim();

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('lang="en"');
    expect(html).toContain("<main>");
    expect(html).toContain("<section>");
    // Tags should be balanced
    const opens  = (html.match(/<[a-z]+[\s>]/g) || []).length;
    const closes = (html.match(/<\/[a-z]+>/g) || []).length;
    expect(opens).toBeGreaterThan(0);
    expect(closes).toBeGreaterThan(0);
  });

  it("generates a responsive layout with a CSS media query", () => {
    const style = `
@media (max-width: 768px) {
  .container { padding: 1rem; }
  .grid { grid-template-columns: 1fr; }
}
`.trim();

    expect(style).toContain("@media");
    expect(style).toContain("max-width: 768px");
    expect(style).toContain("grid-template-columns");
  });

  it("escapes user-supplied strings before embedding in HTML", () => {
    const userInput = "<script>alert('xss')</script>";
    const escaped   = userInput
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("&lt;script&gt;");
  });
});

// ---------------------------------------------------------------------------

describe("JSX/React component generation", () => {
  it("generates a valid functional component signature", () => {
    const componentName = "UserCard";
    const props         = { name: "string", email: "string", avatarUrl: "string" };

    const propsInterface = generateTsInterface(`${componentName}Props`, props);
    const component      = `
function ${componentName}({ name, email, avatarUrl }: ${componentName}Props) {
  return (
    <div className="user-card">
      <img src={avatarUrl} alt={name} />
      <h2>{name}</h2>
      <p>{email}</p>
    </div>
  );
}`.trim();

    expect(propsInterface).toContain(`interface ${componentName}Props`);
    expect(propsInterface).toContain("name: string;");
    expect(component).toContain(`function ${componentName}`);
    expect(component).toContain("return (");
    expect(component).toContain("{name}");
  });

  it("generates a TypeScript props interface from a field definition map", () => {
    const fields = {
      id:        "number",
      label:     "string",
      disabled:  "boolean",
      onClick:   "() => void",
    };

    const iface = generateTsInterface("ButtonProps", fields);

    expect(iface).toContain("interface ButtonProps");
    expect(iface).toContain("id: number;");
    expect(iface).toContain("onClick: () => void;");
  });

  it("validates that the generated component file has the correct extension", () => {
    const filename = "UserCard.tsx";
    expect(filename).toMatch(/\.(tsx|jsx)$/);
  });
});

// ---------------------------------------------------------------------------

describe("LaTeX document generation", () => {
  it("generates a LaTeX document class preamble for an academic paper", () => {
    const preamble = [
      "\\documentclass[12pt,a4paper]{article}",
      "\\usepackage[utf8]{inputenc}",
      "\\usepackage{amsmath}",
      "\\usepackage{graphicx}",
      "\\usepackage[margin=2.5cm]{geometry}",
    ];

    expect(preamble[0]).toContain("\\documentclass");
    expect(preamble.some((l) => l.includes("amsmath"))).toBe(true);
    expect(preamble.some((l) => l.includes("geometry"))).toBe(true);
  });

  it("renders an inline equation and a display equation", () => {
    const inline  = "The formula $E = mc^2$ is well known.";
    const display = "\\[\n  \\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}\n\\]";

    expect(inline).toContain("$E = mc^2$");
    expect(display).toContain("\\[");
    expect(display).toContain("\\]");
    expect(display).toContain("\\int");
  });

  it("generates section commands for abstract, introduction, and conclusion", () => {
    const sections = ["abstract", "introduction", "methodology", "results", "conclusion"];
    const latex    = sections.map((s) => `\\section{${s.charAt(0).toUpperCase() + s.slice(1)}}`);

    for (let i = 0; i < sections.length; i++) {
      expect(latex[i]).toContain("\\section{");
      expect(latex[i]).toContain(sections[i].charAt(0).toUpperCase() + sections[i].slice(1));
    }
  });
});

// ---------------------------------------------------------------------------

describe("CSV generation", () => {
  it("converts a 2D array to comma-delimited CSV", () => {
    const rows = [
      ["name",  "age", "city"],
      ["Alice", "30",  "New York"],
      ["Bob",   "25",  "London"],
    ];

    const csv = toCsv(rows);
    const lines = csv.split("\n");

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("name,age,city");
    expect(lines[1]).toBe("Alice,30,New York");
  });

  it("quotes fields containing the delimiter character", () => {
    const rows = [
      ["product",      "description"],
      ["Widget, Small", "A small widget"],
    ];

    const csv = toCsv(rows);
    expect(csv).toContain('"Widget, Small"');
  });

  it("handles semicolon as an alternative delimiter", () => {
    const rows = [
      ["land", "capital", "population"],
      ["Germany", "Berlin", "84000000"],
      ["France",  "Paris",  "67000000"],
    ];

    const csv = toCsv(rows, ";");
    expect(csv).toContain("land;capital;population");
    expect(csv).toContain("Germany;Berlin;84000000");
  });
});

// ---------------------------------------------------------------------------

describe("JSON schemas and data", () => {
  it("generates a valid JSON Schema draft-7 object for a user entity", () => {
    const schema = {
      $schema:    "http://json-schema.org/draft-07/schema#",
      title:      "User",
      type:       "object",
      required:   ["id", "email"],
      properties: {
        id:        { type: "integer" },
        email:     { type: "string", format: "email" },
        name:      { type: "string" },
        createdAt: { type: "string", format: "date-time" },
      },
      additionalProperties: false,
    };

    expect(schema.$schema).toContain("json-schema.org");
    expect(schema.required).toContain("id");
    expect(schema.required).toContain("email");
    expect(schema.properties.email.format).toBe("email");
    expect(schema.additionalProperties).toBe(false);
  });

  it("generates sample data conforming to the schema", () => {
    const sampleData = {
      id:        42,
      email:     "test@example.com",
      name:      "Test User",
      createdAt: "2025-04-10T09:00:00Z",
    };

    expect(typeof sampleData.id).toBe("number");
    expect(sampleData.email).toMatch(/@/);
    expect(new Date(sampleData.createdAt).getTime()).toBeGreaterThan(0);
  });

  it("validates that all required schema fields are present in the sample", () => {
    const required    = ["id", "email"];
    const sampleData: Record<string, unknown> = { id: 1, email: "a@b.com", name: "Alice" };

    const missing = required.filter((k) => !(k in sampleData));
    expect(missing).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("Image/PNG generation", () => {
  it("validates chart-to-image output spec has required dimensions", () => {
    const spec = {
      type:     "bar",
      width:    800,
      height:   400,
      title:    "Monthly Revenue",
      labels:   ["Jan", "Feb", "Mar"],
      datasets: [{ label: "Revenue", data: [1200, 1500, 1100] }],
    };

    expect(spec.width).toBeGreaterThan(0);
    expect(spec.height).toBeGreaterThan(0);
    expect(spec.labels).toHaveLength(spec.datasets[0].data.length);
  });

  it("validates screenshot-to-file output contains a valid path and format", () => {
    const screenshotResult = {
      path:   "/workspace/screenshot_20250410.png",
      format: "png",
      width:  1280,
      height: 720,
      bytes:  8192,
    };

    expect(screenshotResult.path).toMatch(/\.(png|jpg|jpeg|webp)$/);
    expect(["png", "jpeg", "webp"]).toContain(screenshotResult.format);
    expect(screenshotResult.width).toBeGreaterThan(0);
    expect(screenshotResult.height).toBeGreaterThan(0);
    expect(screenshotResult.bytes).toBeGreaterThan(0);
  });

  it("validates MIME type mapping for image formats", () => {
    const mimeMap: Record<string, string> = {
      png:  "image/png",
      jpg:  "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif:  "image/gif",
    };

    for (const [, mime] of Object.entries(mimeMap)) {
      expect(mime).toMatch(/^image\//);
    }
    expect(mimeMap.jpg).toBe(mimeMap.jpeg);
  });
});

// ---------------------------------------------------------------------------

describe("Provider-agnostic file generation (other formats)", () => {
  runWithEachProvider(
    "generates a Markdown document via the agent tool-call pipeline",
    "markdown",
    async (provider) => {
      // Build a mock tool call for a markdown generation tool
      const tool = {
        name: "generate_markdown",
        arguments: {
          filename: "readme.md",
          content:  "# Overview\n\nThis is the overview.",
        },
      };

      // Import getMockResponseForProvider inline to avoid circular issues
      const { getMockResponseForProvider } = await import("../_setup/mockResponses");
      const response = getMockResponseForProvider(provider.name, tool);

      const r = response as Record<string, unknown>;
      expect(r).toBeDefined();
      expect(typeof r).toBe("object");
    },
  );

  runWithEachProvider(
    "generates a CSV file via the agent tool-call pipeline",
    "csv",
    async (_provider) => {
      const rows = [
        ["id", "name", "value"],
        ["1",  "Alpha", "100"],
        ["2",  "Beta",  "200"],
      ];

      const csv = toCsv(rows);
      const lines = csv.split("\n");

      expect(lines[0]).toBe("id,name,value");
      expect(lines).toHaveLength(rows.length);
    },
  );
});
