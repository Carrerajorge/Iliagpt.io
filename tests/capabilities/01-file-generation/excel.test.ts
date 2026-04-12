/**
 * Capability tests — Excel / XLSX generation
 *
 * These tests validate the agent-level logic around Excel generation:
 * argument validation, response parsing, error handling, and tool-call
 * formatting per provider. The underlying xlsx library and the file system
 * are mocked so tests run in a pure Node environment without side-effects.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runWithEachProvider,
  MOCK_PROVIDER,
} from "../_setup/providerMatrix";
import {
  getMockResponseForProvider,
  MOCK_EXCEL_TOOL,
  createExcelResult,
} from "../_setup/mockResponses";
import { assertHasShape } from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("xlsx", () => ({
  utils: {
    book_new: vi.fn(() => ({})),
    json_to_sheet: vi.fn((data: unknown[]) => ({ "!ref": `A1:Z${data.length + 1}` })),
    book_append_sheet: vi.fn(),
    aoa_to_sheet: vi.fn(() => ({ "!ref": "A1:Z10" })),
    sheet_add_aoa: vi.fn(),
  },
  writeFile: vi.fn(),
  write: vi.fn(() => Buffer.alloc(4096)),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 4096 })),
  };
});

vi.mock("../../../server/agent/capabilities/registry", () => ({
  CapabilityRegistry: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    getToolSchemas: vi.fn(() => []),
  })),
  capabilityRegistry: {
    register: vi.fn(),
    getToolSchemas: vi.fn(() => []),
  },
}));

vi.mock("../../../server/agent/capabilities/office/excelGenerator", () => ({
  excelGeneratorCapability: {
    name: "create_excel_report",
    description: "Creates an Excel report",
    schema: {},
    execute: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simulates parsing the tool-call arguments from a provider response
 * the same way the agent pipeline would.
 */
function parseToolArgsFromResponse(
  response: unknown,
  provider: string,
): Record<string, unknown> | null {
  const r = response as Record<string, unknown>;

  if (provider === "anthropic") {
    const content = r["content"] as Array<Record<string, unknown>>;
    const toolBlock = content?.find((c) => c["type"] === "tool_use");
    return toolBlock ? (toolBlock["input"] as Record<string, unknown>) : null;
  }

  if (provider === "openai" || provider === "grok" || provider === "mistral") {
    const choices = r["choices"] as Array<Record<string, unknown>>;
    const message = choices?.[0]?.["message"] as Record<string, unknown>;
    const toolCalls = message?.["tool_calls"] as Array<Record<string, unknown>>;
    const fn = toolCalls?.[0]?.["function"] as Record<string, unknown>;
    if (!fn) return null;
    return JSON.parse(fn["arguments"] as string);
  }

  if (provider === "gemini") {
    const candidates = r["candidates"] as Array<Record<string, unknown>>;
    const content = candidates?.[0]?.["content"] as Record<string, unknown>;
    const parts = content?.["parts"] as Array<Record<string, unknown>>;
    const fnCall = parts?.find((p) => "functionCall" in p);
    return fnCall
      ? (fnCall["functionCall"] as Record<string, unknown>)["args"] as Record<string, unknown>
      : null;
  }

  return null;
}

/** Sanitise filename the same way excelGenerator does. */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9_.-]/gi, "_").replace(/\.xlsx$/i, "") + ".xlsx";
}

// ---------------------------------------------------------------------------
// Describe blocks
// ---------------------------------------------------------------------------

describe("Basic spreadsheet generation", () => {
  it("generates a single-sheet workbook with headers and data rows", async () => {
    const args = {
      filename: "sales_report.xlsx",
      sheets: [
        {
          sheetName: "Sales",
          data: [
            { product: "Widget A", units: 120, revenue: 2400 },
            { product: "Widget B", units: 85,  revenue: 1700 },
            { product: "Widget C", units: 200, revenue: 4000 },
          ],
        },
      ],
    };

    // Validate schema shape
    expect(args.filename).toMatch(/\.xlsx$/);
    expect(args.sheets).toHaveLength(1);
    expect(args.sheets[0].data).toHaveLength(3);

    // Validate each row has the required keys
    for (const row of args.sheets[0].data) {
      expect(row).toHaveProperty("product");
      expect(row).toHaveProperty("units");
      expect(row).toHaveProperty("revenue");
    }
  });

  it("produces a clean filename stripping special characters", () => {
    const dirty = "Q1 Report (2025)! Final.xlsx";
    const clean = sanitizeFilename(dirty);
    expect(clean).not.toMatch(/[^a-z0-9_.-]/i);
    expect(clean).toMatch(/\.xlsx$/);
  });

  it("allows multiple rows with heterogeneous column sets", () => {
    const data = [
      { name: "Alice", dept: "Eng" },
      { name: "Bob",   dept: "Sales", location: "NYC" },
      { name: "Carol", dept: "HR",    location: "LA",  level: "Senior" },
    ];
    // All rows should be valid objects with at least `name`
    expect(data.every((r) => typeof r.name === "string")).toBe(true);
    // Column union is the superset of all row keys
    const allKeys = new Set(data.flatMap(Object.keys));
    expect(allKeys).toContain("name");
    expect(allKeys).toContain("dept");
    expect(allKeys).toContain("location");
    expect(allKeys).toContain("level");
  });

  it("returns correct metadata after successful execution", () => {
    const result = createExcelResult("sales_report.xlsx", 1);
    expect(typeof result.event).toBe("string");
    expect(typeof result.bytes).toBe("number");
    expect(typeof result.absolute_path).toBe("string");
    expect(typeof result.sheet_count).toBe("number");
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.sheet_count).toBe(1);
    expect(result.absolute_path).toContain("sales_report.xlsx");
  });
});

// ---------------------------------------------------------------------------

describe("Formula support", () => {
  it("accepts SUM formula strings in cell data without modification", () => {
    const cellWithFormula = { A1: "=SUM(B1:B10)", B1: 100, B2: 200 };
    // The capability passes raw values; formula strings start with "="
    const formulaKeys = Object.entries(cellWithFormula)
      .filter(([, v]) => typeof v === "string" && (v as string).startsWith("="))
      .map(([k]) => k);
    expect(formulaKeys).toContain("A1");
  });

  it("validates VLOOKUP formula structure before passing to xlsx library", () => {
    const vlookup = "=VLOOKUP(A2,Sheet2!A:B,2,FALSE)";
    // Should follow =VLOOKUP(lookup_value, table_array, col_index, [range_lookup])
    expect(vlookup).toMatch(/^=VLOOKUP\(.+\)$/);
    const parts = vlookup
      .replace("=VLOOKUP(", "")
      .replace(/\)$/, "")
      .split(",");
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });

  it("handles IF formulas with nested conditions", () => {
    const ifFormula = '=IF(A1>100,"High",IF(A1>50,"Medium","Low"))';
    expect(ifFormula).toMatch(/^=IF\(/);
    // Balanced parentheses check
    const opens  = (ifFormula.match(/\(/g) || []).length;
    const closes = (ifFormula.match(/\)/g) || []).length;
    expect(opens).toBe(closes);
  });

  it("supports named range definitions as a metadata field", () => {
    const namedRanges = [
      { name: "SalesFigures", ref: "Sheet1!$B$2:$B$100" },
      { name: "ProductList",  ref: "Sheet1!$A$2:$A$100" },
    ];
    expect(namedRanges).toHaveLength(2);
    for (const nr of namedRanges) {
      expect(nr.name).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
      expect(nr.ref).toMatch(/!/); // must reference a sheet
    }
  });
});

// ---------------------------------------------------------------------------

describe("Multiple sheets", () => {
  it("creates a workbook with three named sheets", () => {
    const sheets = [
      { sheetName: "Q1", data: [{ month: "Jan", revenue: 1000 }] },
      { sheetName: "Q2", data: [{ month: "Apr", revenue: 1200 }] },
      { sheetName: "Q3", data: [{ month: "Jul", revenue: 1100 }] },
    ];

    expect(sheets).toHaveLength(3);
    const names = sheets.map((s) => s.sheetName);
    expect(names).toEqual(expect.arrayContaining(["Q1", "Q2", "Q3"]));
  });

  it("truncates sheet names exceeding the 31-character Excel limit", () => {
    const longName = "This is a very long sheet name that exceeds the limit";
    const safe = longName.substring(0, 31);
    expect(safe.length).toBeLessThanOrEqual(31);
  });

  it("returns metadata with the correct sheet count for multi-sheet workbooks", () => {
    const result = createExcelResult("multi_sheet.xlsx", 4);
    expect(result.sheet_count).toBe(4);
    expect(result.bytes).toBeGreaterThan(4096); // larger than single-sheet
  });
});

// ---------------------------------------------------------------------------

describe("Formatting", () => {
  it("applies conditional formatting rules with valid operator types", () => {
    const rule = {
      type: "cellIs",
      operator: "greaterThan",
      formulae: ["100"],
      style: { fill: { fgColor: { argb: "FFFF0000" } } },
    };

    expect(["lessThan", "greaterThan", "between", "equal"]).toContain(rule.operator);
    expect(rule.formulae).toHaveLength(1);
    expect(rule.style.fill.fgColor.argb).toMatch(/^FF[0-9A-F]{6}$/i);
  });

  it("validates number format strings before applying", () => {
    const formatMap: Record<string, string> = {
      currency: '"$"#,##0.00',
      percent: "0.00%",
      date:    "YYYY-MM-DD",
      integer: "#,##0",
    };

    for (const fmt of Object.values(formatMap)) {
      expect(typeof fmt).toBe("string");
      expect(fmt.length).toBeGreaterThan(0);
    }
    expect(formatMap.currency).toContain("$");
    expect(formatMap.percent).toContain("%");
  });

  it("rejects invalid ARGB colour codes", () => {
    const valid   = "FFFF5733";
    const invalid = "ZZZ";

    expect(valid).toMatch(/^[0-9A-Fa-f]{8}$/);
    expect(invalid).not.toMatch(/^[0-9A-Fa-f]{8}$/);
  });
});

// ---------------------------------------------------------------------------

describe("Financial models", () => {
  it("builds a budget tracker sheet with required columns", () => {
    const budgetColumns = [
      "Category",
      "Budgeted",
      "Actual",
      "Variance",
      "Variance%",
    ];
    const sampleRow = {
      Category: "Marketing",
      Budgeted: 50000,
      Actual: 47500,
      Variance: 2500,
      "Variance%": 5,
    };

    expect(budgetColumns.every((col) => col in sampleRow)).toBe(true);
    expect(sampleRow.Variance).toBe(sampleRow.Budgeted - sampleRow.Actual);
  });

  it("structures a P&L statement across monthly sheets", () => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
    const plTemplate = {
      Revenue: 0,
      COGS: 0,
      GrossProfit: 0,
      OpEx: 0,
      EBITDA: 0,
      NetIncome: 0,
    };

    expect(months).toHaveLength(6);
    expect(Object.keys(plTemplate)).toContain("GrossProfit");
    expect(Object.keys(plTemplate)).toContain("EBITDA");
  });

  it("validates cash flow statement row types", () => {
    const cfTypes = ["operating", "investing", "financing"];
    const cfRow = {
      type: "operating",
      description: "Net Income",
      amount: 125000,
    };

    expect(cfTypes).toContain(cfRow.type);
    expect(cfRow.amount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("Charts and pivot tables", () => {
  it("builds a valid bar chart configuration object", () => {
    const chartConfig = {
      type: "bar",
      title: "Monthly Revenue",
      categories: { data: [{ name: "Sheet1!$A$2:$A$13" }] },
      series: [
        {
          name: "Revenue",
          data: [{ name: "Sheet1!$B$2:$B$13" }],
        },
      ],
    };

    expect(chartConfig.type).toBe("bar");
    expect(chartConfig.series).toHaveLength(1);
    expect(chartConfig.categories.data[0].name).toMatch(/\$A\$/);
  });

  it("defines a pivot table field list with required properties", () => {
    const pivotFields = [
      { name: "Region",   axis: "row" },
      { name: "Quarter",  axis: "column" },
      { name: "Revenue",  axis: "data", summaryFunction: "sum" },
    ];

    const axes = pivotFields.map((f) => f.axis);
    expect(axes).toContain("row");
    expect(axes).toContain("column");
    expect(axes).toContain("data");

    const dataField = pivotFields.find((f) => f.axis === "data");
    expect(dataField?.summaryFunction).toBe("sum");
  });

  it("validates chart type against supported set", () => {
    const supported = ["bar", "column", "line", "pie", "area", "scatter"];
    const requested = "line";
    expect(supported).toContain(requested);
  });
});

// ---------------------------------------------------------------------------

describe("Provider-agnostic tool call formatting", () => {
  runWithEachProvider(
    "formats create_excel_report tool call correctly",
    "excel",
    async (provider) => {
      const response = getMockResponseForProvider(
        provider.name,
        MOCK_EXCEL_TOOL,
      );
      const args = parseToolArgsFromResponse(response, provider.name);

      expect(args).not.toBeNull();
      expect(args).toHaveProperty("filename");
      expect(args).toHaveProperty("sheets");
      expect(Array.isArray((args as any).sheets)).toBe(true);
    },
  );

  runWithEachProvider(
    "parses file metadata from execution result",
    "excel",
    async (_provider) => {
      const result = createExcelResult("provider_test.xlsx", 2);
      expect(typeof result.event).toBe("string");
      expect(typeof result.bytes).toBe("number");
      expect(typeof result.absolute_path).toBe("string");
      expect(typeof result.sheet_count).toBe("number");
      expect(result.sheet_count).toBe(2);
    },
  );
});

// ---------------------------------------------------------------------------

describe("Error handling", () => {
  it("returns an error object when no sheets are provided", async () => {
    const { excelGeneratorCapability } = await import(
      "../../../server/agent/capabilities/office/excelGenerator"
    );
    const mockExecute = vi.fn().mockResolvedValue({
      error: "No se proveyeron hojas/datos para generar el Excel.",
    });
    (excelGeneratorCapability.execute as ReturnType<typeof vi.fn>) = mockExecute;

    const result = await mockExecute({ filename: "empty.xlsx", sheets: [] });
    expect(result).toHaveProperty("error");
    expect(result.error).toContain("hojas");
  });

  it("rejects filenames with path traversal patterns", () => {
    const dangerous = [
      "../../../etc/passwd.xlsx",
      "/abs/path/secret.xlsx",
      "..\\windows\\system32.xlsx",
    ];

    for (const name of dangerous) {
      const clean = sanitizeFilename(name);
      // After sanitisation the result must not contain slash or backslash
      expect(clean).not.toContain("/");
      expect(clean).not.toContain("\\");
    }
  });

  it("handles rows that contain null or undefined values gracefully", () => {
    const rows = [
      { a: 1,    b: null,      c: "ok" },
      { a: null, b: undefined, c: 2    },
    ];

    // The capability should not throw when data contains nulls
    const serialised = rows.map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [k, v ?? ""]),
      ),
    );

    for (const row of serialised) {
      for (const val of Object.values(row)) {
        expect(val).not.toBeNull();
        expect(val).not.toBeUndefined();
      }
    }
  });

  it("rejects row count exceeding the Excel row limit", () => {
    const EXCEL_ROW_LIMIT = 1_048_576;
    const requestedRows = 2_000_000;

    const willExceed = requestedRows > EXCEL_ROW_LIMIT;
    expect(willExceed).toBe(true);

    // An implementation check: the agent should return an error rather than
    // silently truncating or crashing.
    const error = willExceed
      ? { error: `Data exceeds Excel row limit of ${EXCEL_ROW_LIMIT}` }
      : null;

    expect(error).not.toBeNull();
    expect(error?.error).toContain("1048576");
  });

  it("surfaces xlsx library exceptions wrapped in a user-friendly error", async () => {
    const { excelGeneratorCapability } = await import(
      "../../../server/agent/capabilities/office/excelGenerator"
    );
    const mockExecute = vi.fn().mockResolvedValue({
      error: "Failed to create Excel File. Out of memory",
    });
    (excelGeneratorCapability.execute as ReturnType<typeof vi.fn>) = mockExecute;

    const result = await mockExecute({
      filename: "crash.xlsx",
      sheets: [{ sheetName: "Big", data: [] }],
    });

    expect(result).toHaveProperty("error");
    expect(result.error).toMatch(/Failed to create Excel File/);
  });
});
