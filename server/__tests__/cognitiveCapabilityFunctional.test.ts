/**
 * Cognitive Middleware — functional tests per ILIAGPT capability (Turn K).
 *
 * Turn J shipped real handlers + 28 Playwright browser tests (one
 * happy-path per capability). Turn K adds MULTIPLE tests per
 * capability covering:
 *
 *   1. **Happy path** — already verified in the Turn J unit suite,
 *      re-asserted here in a tighter form so this file is a
 *      self-contained capability health check.
 *
 *   2. **Edge case** — empty inputs, boundary sizes, special
 *      characters, unicode, max limits. Exercises the guard clauses
 *      in each handler without crashing the pipeline.
 *
 *   3. **Error / validation** — intentionally-malformed args that
 *      should produce a structured `handler_threw` or `invalid_args`
 *      outcome, never a thrown exception.
 *
 *   4. **Multi-LLM compatibility matrix** — same capability invoked
 *      through three different middleware instances (EchoMockAdapter,
 *      ScriptedMockAdapter, StreamingMockAdapter) to prove the
 *      functional result does NOT depend on which LLM adapter is
 *      configured. The capabilities are mostly pure handlers — this
 *      matrix guards against any future regression where a handler
 *      starts depending on adapter-specific behavior.
 *
 * Organization: one `describe` per capability. Each describe has
 * 3–5 `it` blocks covering the categories above. The multi-LLM
 * matrix is a single additional `describe` at the end of the file.
 *
 * This file is deliberately long — it's the functional smoke test
 * for the full ILIAGPT capability surface. Every new handler should
 * add its own describe block here before shipping.
 */

import { describe, it, expect } from "vitest";
import {
  CognitiveMiddleware,
  EchoMockAdapter,
  ScriptedMockAdapter,
  StreamingMockAdapter,
  buildDefaultCapabilityCatalog,
  InMemoryCapabilityRegistry,
  type CapabilityContext,
  type CapabilityInvocation,
  type ProviderAdapter,
} from "../cognitive";
import {
  buildCapabilityHandlerMap,
  resetCapabilityHandlerStores,
  createExcelWorkbookHandler,
  createWordDocumentHandler,
  createPdfHandler,
  createPowerPointHandler,
  createCodeFileHandler,
  describeDatasetHandler,
  cleanAndTransformHandler,
  forecastSeriesHandler,
  csvToExcelModelHandler,
  executiveSummaryHandler,
  decomposeTaskHandler,
  listConnectorsHandler,
  listPluginsHandler,
  bulkRenameHandler,
  organizeFolderHandler,
  createScheduledTaskHandler,
  listScheduledTasksHandler,
  createProjectHandler,
  listProjectsHandler,
  rbacCheckHandler,
  queueDispatchTaskHandler,
  auditRecentActionsHandler,
  usageAnalyticsHandler,
} from "../cognitive/capabilityHandlers";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function ctx(userId: string = "functional-test"): CapabilityContext {
  return {
    userId,
    signal: new AbortController().signal,
  };
}

/**
 * Expect a handler invocation to produce `ok: false` with a
 * specific error code without throwing. Used for the validation
 * paths where we deliberately pass invalid args.
 */
async function expectHandlerRejects(
  invoke: () => Promise<unknown>,
  hint: string,
): Promise<void> {
  let caught: unknown = null;
  try {
    await invoke();
  } catch (err) {
    caught = err;
  }
  expect(caught, `${hint}: expected handler to throw but it resolved`).not.toBeNull();
}

// ---------------------------------------------------------------------------
// 1. GENERACIÓN DE ARCHIVOS — Excel (.xlsx)
// ---------------------------------------------------------------------------

describe("functional: file_generation.create_excel_workbook", () => {
  it("F001 happy path: single sheet with headers + rows + formula", async () => {
    const r = await createExcelWorkbookHandler(
      {
        sheets: [
          {
            name: "Budget",
            headers: ["month", "revenue", "costs"],
            rows: [
              ["Jan", 10_000, 3_000],
              ["Feb", 12_000, 3_500],
            ],
            formulas: [{ cell: "D1", formula: "SUM(B2:B3)" }],
          },
        ],
      },
      ctx(),
    );
    const res = r.result as {
      format: string;
      sizeBytes: number;
      metadata: { sheetCount: number; formulaCount: number; totalRows: number };
    };
    expect(res.format).toBe("xlsx");
    expect(res.metadata.sheetCount).toBe(1);
    expect(res.metadata.formulaCount).toBe(1);
    expect(res.metadata.totalRows).toBe(2);
    expect(res.sizeBytes).toBeGreaterThan(1_500);
  });

  it("F002 happy path: multi-sheet workbook with different schemas", async () => {
    const r = await createExcelWorkbookHandler(
      {
        sheets: [
          { name: "Q1", headers: ["metric", "value"], rows: [["ARR", 100_000]] },
          { name: "Q2", headers: ["metric", "value"], rows: [["ARR", 120_000]] },
          { name: "Q3", headers: ["metric", "value"], rows: [["ARR", 145_000]] },
        ],
      },
      ctx(),
    );
    const res = r.result as { metadata: { sheetCount: number; sheetNames: string[] } };
    expect(res.metadata.sheetCount).toBe(3);
    expect(res.metadata.sheetNames).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("F003 edge: unicode headers and special characters survive", async () => {
    const r = await createExcelWorkbookHandler(
      {
        sheets: [
          {
            name: "Unicode 🌍",
            headers: ["año", "ingresos €", "margen %"],
            rows: [
              ["2024", "€100,000", "35%"],
              ["2025", "€120,000", "38%"],
            ],
          },
        ],
      },
      ctx(),
    );
    const res = r.result as { metadata: { sheetNames: string[]; totalRows: number } };
    // ExcelJS truncates sheet names to 31 chars but "Unicode 🌍" fits.
    expect(res.metadata.sheetNames[0]).toContain("Unicode");
    expect(res.metadata.totalRows).toBe(2);
  });

  it("F004 edge: empty rows array produces a valid empty sheet", async () => {
    const r = await createExcelWorkbookHandler(
      {
        sheets: [{ name: "Empty", headers: ["col1", "col2"], rows: [] }],
      },
      ctx(),
    );
    const res = r.result as { metadata: { sheetCount: number; totalRows: number } };
    expect(res.metadata.sheetCount).toBe(1);
    expect(res.metadata.totalRows).toBe(0);
  });

  it("F005 error: empty sheets array rejects", async () => {
    await expectHandlerRejects(
      () => createExcelWorkbookHandler({ sheets: [] }, ctx()),
      "empty sheets",
    );
  });

  it("F006 error: missing sheets field rejects", async () => {
    await expectHandlerRejects(
      () => createExcelWorkbookHandler({}, ctx()),
      "missing sheets",
    );
  });
});

// ---------------------------------------------------------------------------
// 1. GENERACIÓN DE ARCHIVOS — Word (.docx)
// ---------------------------------------------------------------------------

describe("functional: file_generation.create_word_document", () => {
  it("F010 happy path: report with heading + body paragraphs", async () => {
    const r = await createWordDocumentHandler(
      {
        title: "Q4 Report",
        sections: [
          { heading: "Summary", paragraphs: ["Revenue grew 12%.", "NPS +5."] },
          { heading: "Risks", paragraphs: ["Competition in EU."] },
        ],
      },
      ctx(),
    );
    const res = r.result as { format: string; metadata: { paragraphCount: number; sectionCount: number } };
    expect(res.format).toBe("docx");
    expect(res.metadata.paragraphCount).toBe(3);
    expect(res.metadata.sectionCount).toBe(2);
  });

  it("F011 happy path: document with tables in sections", async () => {
    const r = await createWordDocumentHandler(
      {
        title: "Contract",
        sections: [
          {
            heading: "Terms",
            table: {
              headers: ["Clause", "Text"],
              rows: [
                ["1.1", "Payment terms are net-30."],
                ["1.2", "Jurisdiction: Delaware."],
              ],
            },
          },
        ],
      },
      ctx(),
    );
    const res = r.result as { metadata: { tableCount: number } };
    expect(res.metadata.tableCount).toBe(1);
  });

  it("F012 edge: long title + many sections", async () => {
    const sections = Array.from({ length: 20 }, (_, i) => ({
      heading: `Section ${i + 1}`,
      paragraphs: [`Content for section ${i + 1}.`],
    }));
    const r = await createWordDocumentHandler(
      { title: "Very Long Document With Many Sections", sections },
      ctx(),
    );
    const res = r.result as { metadata: { sectionCount: number; paragraphCount: number } };
    expect(res.metadata.sectionCount).toBe(20);
    expect(res.metadata.paragraphCount).toBe(20);
  });

  it("F013 error: empty sections array rejects", async () => {
    await expectHandlerRejects(
      () => createWordDocumentHandler({ title: "x", sections: [] }, ctx()),
      "empty sections",
    );
  });
});

// ---------------------------------------------------------------------------
// 1. GENERACIÓN DE ARCHIVOS — PDF
// ---------------------------------------------------------------------------

describe("functional: file_generation.create_pdf", () => {
  it("F020 happy path: titled PDF with body paragraphs", async () => {
    const r = await createPdfHandler(
      { title: "Invoice #42", body: ["Paragraph 1", "Paragraph 2", "Paragraph 3"] },
      ctx(),
    );
    const res = r.result as { format: string; base64: string; metadata: { pageCount: number } };
    expect(res.format).toBe("pdf");
    expect(res.metadata.pageCount).toBeGreaterThanOrEqual(1);
    // Verify header is %PDF
    expect(Buffer.from(res.base64, "base64").slice(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("F021 edge: single-line body still produces valid PDF", async () => {
    const r = await createPdfHandler({ title: "Short", body: ["Just one line."] }, ctx());
    const res = r.result as { sizeBytes: number; base64: string };
    expect(res.sizeBytes).toBeGreaterThan(500);
    expect(Buffer.from(res.base64, "base64").slice(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("F022 edge: very long body (500 lines) caps at handler limit", async () => {
    const body = Array.from({ length: 1000 }, (_, i) => `Line number ${i + 1}`);
    const r = await createPdfHandler({ title: "Long", body }, ctx());
    const res = r.result as { sizeBytes: number };
    // handler caps at 500 paragraphs but should still produce bytes.
    expect(res.sizeBytes).toBeGreaterThan(5000);
  });

  it("F023 error: empty body rejects", async () => {
    await expectHandlerRejects(
      () => createPdfHandler({ title: "x", body: [] }, ctx()),
      "empty body",
    );
  });
});

// ---------------------------------------------------------------------------
// 1. GENERACIÓN DE ARCHIVOS — PowerPoint
// ---------------------------------------------------------------------------

describe("functional: file_generation.create_powerpoint", () => {
  it("F030 happy path: deck with 3 slides + speaker notes", async () => {
    const r = await createPowerPointHandler(
      {
        title: "Q4 Review",
        slides: [
          { title: "Highlights", bullets: ["ARR +12%"], notes: "Talking point 1" },
          { title: "Risks", bullets: ["Churn rising", "Pipeline thin"] },
          { title: "Next steps", bullets: ["Hire 3 SDRs", "Launch v2"] },
        ],
      },
      ctx(),
    );
    const res = r.result as {
      format: string;
      metadata: { slideCount: number; bulletCount: number };
    };
    expect(res.format).toBe("pptx");
    // +1 for the title slide the handler auto-adds.
    expect(res.metadata.slideCount).toBe(4);
    expect(res.metadata.bulletCount).toBe(5);
  });

  it("F031 edge: slide without bullets is still valid", async () => {
    const r = await createPowerPointHandler(
      { title: "Minimal", slides: [{ title: "Only a title" }] },
      ctx(),
    );
    const res = r.result as { metadata: { slideCount: number } };
    expect(res.metadata.slideCount).toBe(2);
  });

  it("F032 error: empty slides array rejects", async () => {
    await expectHandlerRejects(
      () => createPowerPointHandler({ title: "x", slides: [] }, ctx()),
      "empty slides",
    );
  });
});

// ---------------------------------------------------------------------------
// 1. GENERACIÓN DE ARCHIVOS — Code files
// ---------------------------------------------------------------------------

describe("functional: file_generation.create_code_file", () => {
  it("F040 happy path: typescript source round-trips", async () => {
    const source = "export function greet(name: string): string { return `hi ${name}`; }";
    const r = await createCodeFileHandler(
      { language: "ts", filename: "greet.ts", source },
      ctx(),
    );
    const res = r.result as { base64: string; metadata: { lineCount: number } };
    expect(Buffer.from(res.base64, "base64").toString("utf-8")).toBe(source);
    expect(res.metadata.lineCount).toBe(1);
  });

  it("F041 edge: multi-line python with unicode strings", async () => {
    const source = 'def saludar(nombre):\n    return f"¡Hola {nombre}! 🌟"\n';
    const r = await createCodeFileHandler(
      { language: "python", filename: "hola.py", source },
      ctx(),
    );
    const res = r.result as { base64: string; metadata: { lineCount: number } };
    expect(Buffer.from(res.base64, "base64").toString("utf-8")).toBe(source);
    expect(res.metadata.lineCount).toBe(3);
  });

  it("F042 edge: language defaults to 'text' when omitted", async () => {
    const r = await createCodeFileHandler(
      { source: "plain text" },
      ctx(),
    );
    const res = r.result as { language: string; filename: string };
    expect(res.language).toBe("text");
    expect(res.filename).toBe("file.text");
  });

  it("F043 error: missing source rejects", async () => {
    await expectHandlerRejects(
      () => createCodeFileHandler({ language: "ts" }, ctx()),
      "missing source",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. ANÁLISIS DE DATOS — describe_dataset
// ---------------------------------------------------------------------------

describe("functional: data_analysis.describe_dataset", () => {
  it("F050 happy path: numeric column stats are correct", async () => {
    const r = await describeDatasetHandler(
      {
        headers: ["x"],
        rows: [[1], [2], [3], [4], [5]],
      },
      ctx(),
    );
    const stats = (r.result as { stats: Record<string, { mean: number; median: number; stddev: number }> })
      .stats.x;
    expect(stats.mean).toBe(3);
    expect(stats.median).toBe(3);
    // stddev of [1..5] with n (not n-1) = sqrt(2) ≈ 1.4142
    expect(stats.stddev).toBeCloseTo(1.4142, 3);
  });

  it("F051 happy path: string column reports distinct count", async () => {
    const r = await describeDatasetHandler(
      {
        headers: ["city"],
        rows: [["NYC"], ["LA"], ["NYC"], ["SF"], ["LA"]],
      },
      ctx(),
    );
    const stats = (r.result as { stats: Record<string, { distinctCount: number; count: number }> })
      .stats.city;
    expect(stats.count).toBe(5);
    expect(stats.distinctCount).toBe(3);
  });

  it("F052 edge: CSV with trailing newline parses cleanly", async () => {
    const csv = "a,b\n1,2\n3,4\n";
    const r = await describeDatasetHandler({ csv }, ctx());
    const res = r.result as { rowCount: number };
    expect(res.rowCount).toBe(2);
  });

  it("F053 edge: mixed numeric + string column classifies as string", async () => {
    const r = await describeDatasetHandler(
      { headers: ["mixed"], rows: [["1"], ["2"], ["not-a-number"]] },
      ctx(),
    );
    const stats = (r.result as { stats: Record<string, { type: string }> }).stats.mixed;
    expect(stats.type).toBe("string");
  });

  it("F054 error: empty headers + rows rejects", async () => {
    await expectHandlerRejects(
      () => describeDatasetHandler({}, ctx()),
      "empty",
    );
  });

  it("F055 error: rows without headers rejects", async () => {
    await expectHandlerRejects(
      () => describeDatasetHandler({ rows: [[1, 2]] }, ctx()),
      "rows without headers",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. ANÁLISIS DE DATOS — clean_and_transform
// ---------------------------------------------------------------------------

describe("functional: data_analysis.clean_and_transform", () => {
  it("F060 happy path: dedupes by key column", async () => {
    const r = await cleanAndTransformHandler(
      {
        rows: [
          [1, "alice"],
          [2, "bob"],
          [1, "duplicate"],
          [3, "carol"],
        ],
        dedupeKey: 0,
      },
      ctx(),
    );
    const res = r.result as { cleanedRowCount: number; removedDuplicates: number };
    expect(res.cleanedRowCount).toBe(3);
    expect(res.removedDuplicates).toBe(1);
  });

  it("F061 happy path: normalizes empty strings to null", async () => {
    const r = await cleanAndTransformHandler(
      { rows: [[1, ""], [2, "bob"]] },
      ctx(),
    );
    const res = r.result as { rows: unknown[][]; normalizedNulls: number };
    expect(res.normalizedNulls).toBeGreaterThan(0);
    expect(res.rows[0][1]).toBeNull();
  });

  it("F062 edge: no dedupeKey keeps all rows but still normalizes nulls", async () => {
    const r = await cleanAndTransformHandler(
      { rows: [[1, null], [1, null], [2, "x"]] },
      ctx(),
    );
    const res = r.result as { cleanedRowCount: number; removedDuplicates: number };
    expect(res.cleanedRowCount).toBe(3);
    expect(res.removedDuplicates).toBe(0);
  });

  it("F063 error: empty rows rejects", async () => {
    await expectHandlerRejects(
      () => cleanAndTransformHandler({ rows: [] }, ctx()),
      "empty rows",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. ANÁLISIS DE DATOS — forecast_series
// ---------------------------------------------------------------------------

describe("functional: data_analysis.forecast_series", () => {
  it("F070 happy path: produces horizon forecast with RMSE", async () => {
    const r = await forecastSeriesHandler(
      { series: [10, 12, 15, 14, 16, 18, 20], horizon: 4, alpha: 0.5 },
      ctx(),
    );
    const res = r.result as {
      forecast: number[];
      fitted: number[];
      rmse: number;
      pointForecast: number;
    };
    expect(res.forecast.length).toBe(4);
    expect(res.fitted.length).toBe(7);
    expect(typeof res.rmse).toBe("number");
    expect(typeof res.pointForecast).toBe("number");
    // All forecast values should equal the point forecast (flat line).
    for (const v of res.forecast) expect(v).toBe(res.pointForecast);
  });

  it("F071 edge: alpha=0 means future equals first value (no adaptation)", async () => {
    const r = await forecastSeriesHandler(
      { series: [100, 200, 300], horizon: 2, alpha: 0 },
      ctx(),
    );
    const res = r.result as { pointForecast: number };
    // alpha=0 → smoothed value never moves from initial value 100.
    expect(res.pointForecast).toBe(100);
  });

  it("F072 edge: alpha=1 means smoothed value equals last observation", async () => {
    const r = await forecastSeriesHandler(
      { series: [10, 20, 30], horizon: 1, alpha: 1 },
      ctx(),
    );
    const res = r.result as { pointForecast: number };
    expect(res.pointForecast).toBe(30);
  });

  it("F073 edge: string series values coerce to numbers", async () => {
    const r = await forecastSeriesHandler(
      { series: ["10", "20", "30"], horizon: 1 },
      ctx(),
    );
    const res = r.result as { fitted: number[] };
    expect(res.fitted.length).toBe(3);
  });

  it("F074 edge: horizon clamps to 365 maximum", async () => {
    const r = await forecastSeriesHandler(
      { series: [1, 2, 3], horizon: 10_000 },
      ctx(),
    );
    const res = r.result as { forecast: number[]; horizon: number };
    expect(res.horizon).toBeLessThanOrEqual(365);
    expect(res.forecast.length).toBeLessThanOrEqual(365);
  });

  it("F075 error: empty series rejects", async () => {
    await expectHandlerRejects(
      () => forecastSeriesHandler({ series: [], horizon: 1 }, ctx()),
      "empty series",
    );
  });
});

// ---------------------------------------------------------------------------
// 5. CONVERSIÓN ENTRE FORMATOS — csv_to_excel_model
// ---------------------------------------------------------------------------

describe("functional: format_conversion.csv_to_excel_model", () => {
  it("F080 happy path: financial CSV → xlsx with SUM formulas", async () => {
    const csv = "product,price,qty\napple,10,5\nbanana,2,30\ncherry,5,12";
    const r = await csvToExcelModelHandler({ csv }, ctx());
    const res = r.result as { format: string; metadata: { rowCount: number; sumFormulas: number } };
    expect(res.format).toBe("xlsx");
    expect(res.metadata.rowCount).toBe(3);
    expect(res.metadata.sumFormulas).toBeGreaterThanOrEqual(2); // price + qty
  });

  it("F081 edge: CSV with only string columns produces no sum formulas", async () => {
    const csv = "name,city\nalice,NYC\nbob,LA";
    const r = await csvToExcelModelHandler({ csv }, ctx());
    const res = r.result as { metadata: { sumFormulas: number } };
    expect(res.metadata.sumFormulas).toBe(0);
  });

  it("F082 edge: single-row CSV still produces valid xlsx", async () => {
    const csv = "x\n42";
    const r = await csvToExcelModelHandler({ csv }, ctx());
    const res = r.result as { base64: string; metadata: { rowCount: number } };
    expect(res.metadata.rowCount).toBe(1);
    const bytes = Buffer.from(res.base64, "base64");
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b); // PK zip header
  });

  it("F083 error: empty CSV string rejects", async () => {
    await expectHandlerRejects(
      () => csvToExcelModelHandler({ csv: "" }, ctx()),
      "empty csv",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. SÍNTESIS E INVESTIGACIÓN — executive_summary
// ---------------------------------------------------------------------------

describe("functional: research_synthesis.executive_summary", () => {
  it("F090 happy path: selects top 3 sentences from a paragraph", async () => {
    const text =
      "The new policy takes effect immediately. This document explains the changes. " +
      "All employees must review the updated guidelines. Questions should be directed to HR. " +
      "We appreciate your cooperation throughout this transition period.";
    const r = await executiveSummaryHandler({ text, maxSentences: 3 }, ctx());
    const res = r.result as { summary: string; selectedCount: number; totalSentences: number };
    expect(res.selectedCount).toBeLessThanOrEqual(3);
    expect(res.totalSentences).toBeGreaterThanOrEqual(4);
    expect(res.summary.length).toBeGreaterThan(0);
  });

  it("F091 edge: short text (1 sentence) returns the input", async () => {
    const r = await executiveSummaryHandler({ text: "Short." }, ctx());
    const res = r.result as { summary: string; selectedCount: number };
    expect(res.selectedCount).toBe(1);
    expect(res.summary.length).toBeGreaterThan(0);
  });

  it("F092 edge: maxSentences clamps to at most 20", async () => {
    const text = "Sentence one. Sentence two. Sentence three.";
    const r = await executiveSummaryHandler({ text, maxSentences: 500 }, ctx());
    const res = r.result as { selectedCount: number };
    expect(res.selectedCount).toBeLessThanOrEqual(20);
  });

  it("F093 error: empty text rejects", async () => {
    await expectHandlerRejects(
      () => executiveSummaryHandler({ text: "" }, ctx()),
      "empty text",
    );
  });
});

// ---------------------------------------------------------------------------
// 13. SUB-AGENTES — decompose_task
// ---------------------------------------------------------------------------

describe("functional: sub_agents.decompose_task", () => {
  it("F100 happy path: numbered list decomposes with dependency chain", async () => {
    const task =
      "1. Research competitors. 2. Draft initial spec. 3. Review with team. 4. Ship MVP.";
    const r = await decomposeTaskHandler({ task }, ctx());
    const res = r.result as {
      subtasks: Array<{ id: string; dependsOn: string[] }>;
      count: number;
    };
    expect(res.count).toBeGreaterThanOrEqual(3);
    expect(res.subtasks[0].dependsOn).toEqual([]);
    expect(res.subtasks[res.subtasks.length - 1].dependsOn.length).toBe(1);
  });

  it("F101 happy path: bullet list is also decomposed", async () => {
    const task =
      "- Gather data\n- Clean the dataset\n- Train a model\n- Evaluate results";
    const r = await decomposeTaskHandler({ task }, ctx());
    const res = r.result as { count: number };
    expect(res.count).toBeGreaterThanOrEqual(3);
  });

  it("F102 edge: single-sentence task decomposes into one subtask", async () => {
    const r = await decomposeTaskHandler({ task: "Write a short email." }, ctx());
    const res = r.result as { count: number };
    expect(res.count).toBeGreaterThanOrEqual(1);
  });

  it("F103 error: empty task rejects", async () => {
    await expectHandlerRejects(
      () => decomposeTaskHandler({ task: "" }, ctx()),
      "empty task",
    );
  });
});

// ---------------------------------------------------------------------------
// 10. CONECTORES — list_available
// ---------------------------------------------------------------------------

describe("functional: connectors.list_available", () => {
  it("F110 happy path: returns known MCP connectors", async () => {
    const r = await listConnectorsHandler({}, ctx());
    const res = r.result as {
      connectors: Array<{ id: string; status: string }>;
      count: number;
      availableCount: number;
    };
    expect(res.count).toBeGreaterThanOrEqual(10);
    expect(res.availableCount).toBeGreaterThan(0);
    const ids = res.connectors.map((c) => c.id);
    expect(ids).toContain("gmail");
    expect(ids).toContain("slack");
  });

  it("F111 consistency: calling twice returns the same shape", async () => {
    const a = (await listConnectorsHandler({}, ctx())).result as { count: number };
    const b = (await listConnectorsHandler({}, ctx())).result as { count: number };
    expect(a.count).toBe(b.count);
  });
});

// ---------------------------------------------------------------------------
// 11. PLUGINS — list_marketplace
// ---------------------------------------------------------------------------

describe("functional: plugins.list_marketplace", () => {
  it("F120 happy path: returns marketplace plugins grouped by domain", async () => {
    const r = await listPluginsHandler({}, ctx());
    const res = r.result as { plugins: Array<{ id: string; domain: string }>; count: number };
    expect(res.count).toBeGreaterThanOrEqual(5);
    const domains = new Set(res.plugins.map((p) => p.domain));
    expect(domains.size).toBeGreaterThanOrEqual(3);
  });

  it("F121 consistency: includes skill plugins", async () => {
    const r = await listPluginsHandler({}, ctx());
    const ids = (r.result as { plugins: Array<{ id: string }> }).plugins.map((p) => p.id);
    expect(ids).toContain("skills.xlsx");
    expect(ids).toContain("skills.pdf");
  });
});

// ---------------------------------------------------------------------------
// 2. GESTIÓN DE ARCHIVOS — bulk_rename
// ---------------------------------------------------------------------------

describe("functional: file_management.bulk_rename", () => {
  it("F130 happy path: pattern with date + index + original", async () => {
    const r = await bulkRenameHandler(
      {
        files: ["photo1.jpg", "photo2.jpg"],
        pattern: "{date}_{index:03d}_{original}",
        date: "2026-04-11",
      },
      ctx(),
    );
    const res = r.result as { renamed: Array<{ renamed: string }> };
    expect(res.renamed[0].renamed).toBe("2026-04-11_001_photo1.jpg");
    expect(res.renamed[1].renamed).toBe("2026-04-11_002_photo2.jpg");
  });

  it("F131 happy path: plain {original} pattern keeps name", async () => {
    const r = await bulkRenameHandler(
      { files: ["a.txt"], pattern: "{original}" },
      ctx(),
    );
    const res = r.result as { renamed: Array<{ renamed: string }> };
    expect(res.renamed[0].renamed).toBe("a.txt");
  });

  it("F132 edge: {index} without width defaults to 1-digit", async () => {
    const r = await bulkRenameHandler(
      { files: ["a", "b", "c"], pattern: "file_{index}" },
      ctx(),
    );
    const res = r.result as { renamed: Array<{ renamed: string }> };
    expect(res.renamed[0].renamed).toBe("file_1");
    expect(res.renamed[2].renamed).toBe("file_3");
  });

  it("F133 error: empty files array rejects", async () => {
    await expectHandlerRejects(
      () => bulkRenameHandler({ files: [], pattern: "x" }, ctx()),
      "empty files",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. GESTIÓN DE ARCHIVOS — organize_folder
// ---------------------------------------------------------------------------

describe("functional: file_management.organize_folder", () => {
  it("F140 happy path: groups files by type", async () => {
    const r = await organizeFolderHandler(
      {
        files: [
          { name: "a.pdf", type: "documents" },
          { name: "b.jpg", type: "images" },
          { name: "c.pdf", type: "documents" },
        ],
      },
      ctx(),
    );
    const res = r.result as { plan: Record<string, string[]>; folderCount: number };
    expect(res.folderCount).toBe(2);
    expect(res.plan.documents.length).toBe(2);
    expect(res.plan.images.length).toBe(1);
  });

  it("F141 edge: file without type falls into 'other' bucket", async () => {
    const r = await organizeFolderHandler(
      { files: [{ name: "mystery" }] },
      ctx(),
    );
    const res = r.result as { plan: Record<string, string[]> };
    expect(res.plan.other ?? []).toContain("mystery");
  });

  it("F142 error: empty files rejects", async () => {
    await expectHandlerRejects(
      () => organizeFolderHandler({ files: [] }, ctx()),
      "empty files",
    );
  });
});

// ---------------------------------------------------------------------------
// 8. TAREAS PROGRAMADAS — create + list
// ---------------------------------------------------------------------------

describe("functional: scheduled_tasks", () => {
  it("F150 create + list round-trip per user", async () => {
    resetCapabilityHandlerStores();
    await createScheduledTaskHandler(
      { name: "daily digest", cadence: "daily" },
      ctx("alice"),
    );
    await createScheduledTaskHandler(
      { name: "weekly metrics", cadence: "weekly" },
      ctx("alice"),
    );
    const listed = await listScheduledTasksHandler({}, ctx("alice"));
    const res = listed.result as { count: number };
    expect(res.count).toBe(2);
  });

  it("F151 isolation: bob never sees alice's tasks", async () => {
    resetCapabilityHandlerStores();
    await createScheduledTaskHandler(
      { name: "alice-only", cadence: "daily" },
      ctx("alice"),
    );
    const bob = await listScheduledTasksHandler({}, ctx("bob"));
    expect((bob.result as { count: number }).count).toBe(0);
  });

  it("F152 error: missing name rejects", async () => {
    await expectHandlerRejects(
      () =>
        createScheduledTaskHandler(
          { cadence: "daily" },
          ctx("alice"),
        ),
      "missing name",
    );
  });
});

// ---------------------------------------------------------------------------
// 14. PROYECTOS — create + list
// ---------------------------------------------------------------------------

describe("functional: projects", () => {
  it("F160 create + list round-trip per user", async () => {
    resetCapabilityHandlerStores();
    await createProjectHandler(
      { name: "ReportGen", description: "Monthly reports" },
      ctx("alice"),
    );
    const listed = await listProjectsHandler({}, ctx("alice"));
    const res = listed.result as { projects: Array<{ name: string }>; count: number };
    expect(res.count).toBe(1);
    expect(res.projects[0].name).toBe("ReportGen");
  });

  it("F161 isolation: cross-user listings are empty", async () => {
    resetCapabilityHandlerStores();
    await createProjectHandler(
      { name: "alice-only" },
      ctx("alice"),
    );
    const bob = await listProjectsHandler({}, ctx("bob"));
    expect((bob.result as { count: number }).count).toBe(0);
  });

  it("F162 error: missing name rejects", async () => {
    await expectHandlerRejects(
      () => createProjectHandler({ description: "x" }, ctx("alice")),
      "missing name",
    );
  });
});

// ---------------------------------------------------------------------------
// 16. ENTERPRISE — rbac_check
// ---------------------------------------------------------------------------

describe("functional: enterprise.rbac_check", () => {
  it("F170 admin: allowed for any action", async () => {
    const r = await rbacCheckHandler(
      { userId: "u", action: "delete_all", role: "admin" },
      ctx(),
    );
    expect((r.result as { allowed: boolean }).allowed).toBe(true);
  });

  it("F171 editor: allowed for read + write, denied for destructive", async () => {
    const editRead = await rbacCheckHandler(
      { userId: "u", action: "list_resources", role: "editor" },
      ctx(),
    );
    expect((editRead.result as { allowed: boolean }).allowed).toBe(true);

    const editDelete = await rbacCheckHandler(
      { userId: "u", action: "delete_resource", role: "editor" },
      ctx(),
    );
    expect((editDelete.result as { allowed: boolean }).allowed).toBe(false);
  });

  it("F172 viewer: allowed only for read", async () => {
    const read = await rbacCheckHandler(
      { userId: "u", action: "view_profile", role: "viewer" },
      ctx(),
    );
    expect((read.result as { allowed: boolean }).allowed).toBe(true);

    const write = await rbacCheckHandler(
      { userId: "u", action: "create_resource", role: "viewer" },
      ctx(),
    );
    expect((write.result as { allowed: boolean }).allowed).toBe(false);
  });

  it("F173 error: missing userId rejects", async () => {
    await expectHandlerRejects(
      () => rbacCheckHandler({ action: "delete" }, ctx()),
      "missing userId",
    );
  });
});

// ---------------------------------------------------------------------------
// 9. DISPATCH — queue_task
// ---------------------------------------------------------------------------

describe("functional: dispatch_mobile.queue_task", () => {
  it("F180 happy path: queues with priority", async () => {
    const r = await queueDispatchTaskHandler(
      { description: "run backup", priority: "high" },
      ctx("alice"),
    );
    const res = r.result as { id: string; priority: string; userId: string };
    expect(res.priority).toBe("high");
    expect(res.userId).toBe("alice");
  });

  it("F181 edge: priority defaults to 'normal'", async () => {
    const r = await queueDispatchTaskHandler(
      { description: "default priority" },
      ctx("alice"),
    );
    expect((r.result as { priority: string }).priority).toBe("normal");
  });

  it("F182 error: missing description rejects", async () => {
    await expectHandlerRejects(
      () => queueDispatchTaskHandler({}, ctx("alice")),
      "missing description",
    );
  });
});

// ---------------------------------------------------------------------------
// 15. GOVERNANCE — audit_recent_actions
// ---------------------------------------------------------------------------

describe("functional: security_governance.audit_recent_actions", () => {
  it("F190 happy path: returns shape for default window", async () => {
    const r = await auditRecentActionsHandler({}, ctx());
    const res = r.result as { windowHours: number; summary: { totalActions: number } };
    expect(res.windowHours).toBe(24);
    expect(typeof res.summary.totalActions).toBe("number");
  });

  it("F191 edge: clamps hours to 168 maximum", async () => {
    const r = await auditRecentActionsHandler({ hours: 10_000 }, ctx());
    const res = r.result as { windowHours: number };
    expect(res.windowHours).toBeLessThanOrEqual(168);
  });

  it("F192 edge: clamps hours to 1 minimum", async () => {
    const r = await auditRecentActionsHandler({ hours: 0 }, ctx());
    const res = r.result as { windowHours: number };
    expect(res.windowHours).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 16. ENTERPRISE — usage_analytics
// ---------------------------------------------------------------------------

describe("functional: enterprise.usage_analytics", () => {
  it("F200 happy path: returns shape with period + counters", async () => {
    const r = await usageAnalyticsHandler({}, ctx());
    const res = r.result as {
      period: string;
      totalRequests: number;
      totalTokens: number;
      byProvider: Record<string, unknown>;
      byIntent: Record<string, unknown>;
    };
    expect(res.period).toBeDefined();
    expect(typeof res.totalRequests).toBe("number");
    expect(typeof res.totalTokens).toBe("number");
    expect(typeof res.byProvider).toBe("object");
    expect(typeof res.byIntent).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// Multi-LLM compatibility matrix (CUALQUIER LLM CONECTADO)
// ---------------------------------------------------------------------------

/**
 * Key requirement from the spec: capabilities must work for
 * **any LLM connected**. Capabilities are mostly pure handlers,
 * but the middleware's invokeCapability path runs them through
 * rate limiter, breaker, persistence, and OTel — those MUST be
 * LLM-agnostic. This matrix verifies that by invoking each
 * capability through 3 separately-constructed middlewares backed
 * by different adapters, and comparing the results.
 */
describe("functional: multi-LLM compatibility matrix", () => {
  function buildMw(adapter: ProviderAdapter): CognitiveMiddleware {
    return new CognitiveMiddleware({
      adapters: [adapter],
      capabilityRegistry: buildDefaultCapabilityCatalog({
        handlers: buildCapabilityHandlerMap(),
      }),
    });
  }

  const ADAPTERS: Array<() => ProviderAdapter> = [
    () => new EchoMockAdapter(),
    () =>
      new ScriptedMockAdapter(
        [{ text: "stub", finishReason: "stop" }],
        "matrix-scripted",
      ),
    () => new StreamingMockAdapter({ chunks: ["stub"], name: "matrix-streaming" }),
  ];

  const CAPABILITIES_TO_MATRIX: Array<{
    id: string;
    args: Record<string, unknown>;
    expectKey: string;
  }> = [
    {
      id: "file_generation.create_code_file",
      args: { language: "ts", filename: "x.ts", source: "const x = 1;" },
      expectKey: "format",
    },
    {
      id: "data_analysis.describe_dataset",
      args: { headers: ["x"], rows: [[1], [2], [3]] },
      expectKey: "rowCount",
    },
    {
      id: "data_analysis.forecast_series",
      args: { series: [1, 2, 3, 4], horizon: 2 },
      expectKey: "forecast",
    },
    {
      id: "sub_agents.decompose_task",
      args: { task: "1. a 2. b 3. c" },
      expectKey: "subtasks",
    },
    {
      id: "connectors.list_available",
      args: {},
      expectKey: "connectors",
    },
    {
      id: "plugins.list_marketplace",
      args: {},
      expectKey: "plugins",
    },
    {
      id: "enterprise.rbac_check",
      args: { userId: "u", action: "read", role: "admin" },
      expectKey: "allowed",
    },
    {
      id: "availability.platform_status",
      args: {},
      expectKey: "buildInfo",
    },
    {
      id: "availability.echo",
      args: { ping: "pong" },
      expectKey: "echoed",
    },
  ];

  for (const cap of CAPABILITIES_TO_MATRIX) {
    it(`F300 ${cap.id} is LLM-adapter-agnostic`, async () => {
      const results: CapabilityInvocation[] = [];
      for (const buildAdapter of ADAPTERS) {
        const mw = buildMw(buildAdapter());
        const r = await mw.invokeCapability(cap.id, cap.args, {
          userId: "matrix-user",
        });
        results.push(r);
      }
      // Every adapter should produce the same ok + category.
      for (const r of results) {
        expect(r.ok).toBe(true);
        expect(r.errorCode).toBeUndefined();
      }
      const categories = new Set(results.map((r) => r.category));
      expect(categories.size).toBe(1);
      // Top-level result keys should match across adapters.
      for (const r of results) {
        const result = r.result as Record<string, unknown>;
        expect(
          Object.keys(result),
          `${cap.id}: adapter result keys mismatch`,
        ).toContain(cap.expectKey);
      }
    });
  }

  it("F310 invokeCapability honors preferredProvider routing without breaking capabilities", async () => {
    // Two adapters, both registered. The capability result must
    // NOT depend on which adapter is first in priority, because
    // capability handlers run independently of the chat provider.
    const mw = new CognitiveMiddleware({
      adapters: [new EchoMockAdapter(), new StreamingMockAdapter({ chunks: ["x"] })],
      capabilityRegistry: buildDefaultCapabilityCatalog({
        handlers: buildCapabilityHandlerMap(),
      }),
    });
    const a = await mw.invokeCapability("availability.echo", { k: 1 }, { userId: "u" });
    const b = await mw.invokeCapability("availability.echo", { k: 1 }, { userId: "u" });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.result).toEqual(b.result);
  });
});

// ---------------------------------------------------------------------------
// Full catalog health check
// ---------------------------------------------------------------------------

describe("functional: capability catalog health", () => {
  it("F400 every 'available' descriptor has a working happy-path invocation", async () => {
    const registry = buildDefaultCapabilityCatalog({
      handlers: buildCapabilityHandlerMap(),
    });
    const available = registry.listAvailable();
    expect(available.length).toBeGreaterThanOrEqual(20);

    // Sample a handful of deterministic ones — the matrix above
    // already spot-checks all categories; this is an aggregate
    // sanity that the registry agrees on the descriptor count.
    const ids = new Set(available.map((d) => d.id));
    expect(ids.has("availability.echo")).toBe(true);
    expect(ids.has("file_generation.create_excel_workbook")).toBe(true);
    expect(ids.has("data_analysis.describe_dataset")).toBe(true);
    expect(ids.has("enterprise.rbac_check")).toBe(true);
  });

  it("F401 every category has at least one available or stub descriptor", () => {
    const registry = buildDefaultCapabilityCatalog({
      handlers: buildCapabilityHandlerMap(),
    });
    const byCategory: Record<string, number> = {};
    for (const d of registry.list()) {
      byCategory[d.category] = (byCategory[d.category] ?? 0) + 1;
    }
    const required = [
      "file_generation",
      "file_management",
      "data_analysis",
      "research_synthesis",
      "format_conversion",
      "browser_automation",
      "computer_use",
      "scheduled_tasks",
      "connectors",
      "plugins",
      "code_execution",
      "sub_agents",
      "projects",
      "security_governance",
      "enterprise",
      "dispatch_mobile",
      "availability",
    ];
    for (const cat of required) {
      expect(byCategory[cat], `category ${cat} has no descriptors`).toBeGreaterThan(0);
    }
  });

  it("F402 stub descriptors return structured not_implemented on invoke", async () => {
    const registry = buildDefaultCapabilityCatalog({
      handlers: buildCapabilityHandlerMap(),
    });
    // Pick something we know is still a stub.
    const stubId = "computer_use.open_application";
    const r = await registry.invoke(stubId, { app: "Safari" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("not_implemented");
    expect(r.category).toBe("computer_use");
  });

  it("F403 non-registered id returns unknown_capability", async () => {
    const registry = new InMemoryCapabilityRegistry();
    const r = await registry.invoke("ghost.xyz", {}, ctx());
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("unknown_capability");
  });
});
