/**
 * Tests for documentAnalyzer.ts — Document Analysis Engine
 */

import { describe, it, expect } from "vitest";
import { analyzeDocument, buildDocumentContextForLLM } from "../services/documentAnalyzer";

describe("documentAnalyzer — TXT format", () => {
  it("parses plain text content", async () => {
    const text = "Introduction\n\nThis is a test document.\nIt has multiple lines.\n\nConclusion\n\nEnd of document.";
    const buffer = Buffer.from(text, "utf-8");

    const result = await analyzeDocument({ buffer, filename: "test.txt", mimeType: "text/plain" });

    expect(result.format).toBe("TXT");
    expect(result.fullText).toContain("Introduction");
    expect(result.wordCount).toBeGreaterThan(5);
    expect(result.filename).toBe("test.txt");
    expect(result.extractionErrors).toHaveLength(0);
  });

  it("detects English language in plain text", async () => {
    const text = "The quick brown fox jumps over the lazy dog. The cat sat on the mat.";
    const buffer = Buffer.from(text, "utf-8");

    const result = await analyzeDocument({ buffer, filename: "english.txt" });

    expect(result.language).toBe("en");
  });

  it("detects Spanish language", async () => {
    const text = "Los datos muestran que el producto tiene una alta tasa de conversión. Los clientes están satisfechos con el servicio.";
    const buffer = Buffer.from(text, "utf-8");

    const result = await analyzeDocument({ buffer, filename: "spanish.txt" });

    expect(result.language).toBe("es");
  });
});

describe("documentAnalyzer — CSV format", () => {
  it("parses CSV and extracts table structure", async () => {
    const csv = "Name,Sales,Region\nAlice,1200,North\nBob,900,South\nCarol,1500,East\nDave,800,West";
    const buffer = Buffer.from(csv, "utf-8");

    const result = await analyzeDocument({ buffer, filename: "data.csv", mimeType: "text/csv" });

    expect(result.format).toBe("CSV");
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].headers).toContain("Name");
    expect(result.tables[0].headers).toContain("Sales");
    expect(result.tables[0].rowCount).toBe(4);
  });

  it("detects CSV with semicolon delimiter", async () => {
    const csv = "Nombre;Ventas;Región\nAlicia;1200;Norte\nBob;900;Sur";
    const buffer = Buffer.from(csv, "utf-8");

    const result = await analyzeDocument({ buffer, filename: "datos.csv" });

    expect(result.tables.length).toBeGreaterThanOrEqual(1);
  });
});

describe("documentAnalyzer — Markdown format", () => {
  it("parses markdown and extracts heading structure", async () => {
    const md = `# Introduction\n\nThis is the intro.\n\n## Methods\n\nDescribe methods here.\n\n### Results\n\nResults shown here.\n\n## Conclusion\n\nFinal thoughts.`;
    const buffer = Buffer.from(md, "utf-8");

    const result = await analyzeDocument({ buffer, filename: "report.md", mimeType: "text/markdown" });

    expect(result.format).toBe("Markdown");
    expect(result.structure.length).toBeGreaterThanOrEqual(4);
    expect(result.structure.some((s) => s.title === "Introduction")).toBe(true);
    expect(result.structure.some((s) => s.title === "Methods")).toBe(true);
  });
});

describe("documentAnalyzer — Table detection in plain text", () => {
  it("detects pipe-separated tables", async () => {
    const text = `Report Data\n\n| Name | Score | Grade |\n|------|-------|-------|\n| Alice | 95 | A |\n| Bob | 78 | B |\n| Carol | 88 | B+ |\n\nEnd of report.`;
    const buffer = Buffer.from(text, "utf-8");

    const result = await analyzeDocument({ buffer, filename: "report.txt" });

    expect(result.tables.length).toBeGreaterThanOrEqual(1);
  });
});

describe("documentAnalyzer — Key Topic Extraction", () => {
  it("extracts relevant key topics", async () => {
    const text = "Machine learning algorithms are transforming artificial intelligence. Neural networks process large amounts of data efficiently. Deep learning models achieve impressive accuracy on complex classification tasks.";
    const buffer = Buffer.from(text, "utf-8");

    const result = await analyzeDocument({ buffer, filename: "ai.txt" });

    expect(result.keyTopics.length).toBeGreaterThan(0);
    // At least one AI-related topic should appear
    const hasRelevantTopic = result.keyTopics.some((t) =>
      ["machine", "learning", "algorithms", "neural", "networks", "artificial", "intelligence", "deep"].includes(t)
    );
    expect(hasRelevantTopic).toBe(true);
  });
});

describe("documentAnalyzer — Entity Extraction", () => {
  it("extracts dates", async () => {
    const text = "The report was published on January 15, 2024. The deadline is 03/31/2024.";
    const buffer = Buffer.from(text, "utf-8");

    const result = await analyzeDocument({ buffer, filename: "report.txt" });

    const dateEntities = result.entities.filter((e) => e.type === "date");
    expect(dateEntities.length).toBeGreaterThan(0);
  });

  it("extracts monetary values", async () => {
    const text = "The project budget is $500,000 and the revenue was $2.3 million in 2023.";
    const buffer = Buffer.from(text, "utf-8");

    const result = await analyzeDocument({ buffer, filename: "finance.txt" });

    const numberEntities = result.entities.filter((e) => e.type === "number");
    expect(numberEntities.length).toBeGreaterThan(0);
  });
});

describe("documentAnalyzer — Context Builder", () => {
  it("builds LLM context string correctly", async () => {
    const text = "# Report\n\nThis is a test report with data.\n\n## Data Section\n\nSome data here.";
    const buffer = Buffer.from(text, "utf-8");

    const result = await analyzeDocument({ buffer, filename: "report.md" });
    const context = buildDocumentContextForLLM(result);

    expect(context).toContain("[DOCUMENT:");
    expect(context).toContain("report.md");
    expect(context).toContain("[SUMMARY]");
  });
});

describe("documentAnalyzer — Actionable Insights", () => {
  it("generates actionable insights for documents with tables", async () => {
    const csv = "Product,Revenue,Growth\nA,10000,15%\nB,8000,10%\nC,12000,20%";
    const buffer = Buffer.from(csv, "utf-8");

    const result = await analyzeDocument({ buffer, filename: "sales.csv" });

    expect(result.actionableInsights.length).toBeGreaterThan(0);
  });

  it("generates actionable insights for large documents", async () => {
    // Create a large text document: each repeat is "Lorem ipsum dolor sit amet. " = 5 words
    // 1200 * 5 = 6000 words > 5000
    const text = "Lorem ipsum dolor sit amet. ".repeat(1200);
    const buffer = Buffer.from(text, "utf-8");

    const result = await analyzeDocument({ buffer, filename: "large.txt" });

    expect(result.wordCount).toBeGreaterThan(5000);
    expect(result.actionableInsights.some((i) => /long|section|summary/i.test(i))).toBe(true);
  });
});
