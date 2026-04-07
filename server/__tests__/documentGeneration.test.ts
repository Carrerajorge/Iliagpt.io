import { describe, expect, it } from "vitest";

/**
 * Document Generation Tests
 *
 * Tests the professional file generator to verify each output format
 * produces valid binary data with proper headers.
 */

import { ProfessionalFileGenerator } from "../services/skillHandlers/professionalFileGenerator";

const generator = new ProfessionalFileGenerator();

describe("ProfessionalFileGenerator", () => {
  describe("Word document generation", () => {
    it("generates a valid DOCX buffer from markdown string", async () => {
      const result = await generator.generateWord(
        "# Executive Summary\n\nThis is a test report.\n\n## Key Metrics\n- Revenue: $10M\n- Growth: 45%",
        { title: "Test Report" },
      );

      expect(result).toBeInstanceOf(Buffer);
      expect((result as Buffer).length).toBeGreaterThan(100);
      // DOCX files start with PK (zip signature)
      expect((result as Buffer)[0]).toBe(0x50);
      expect((result as Buffer)[1]).toBe(0x4b);
    });

    it("generates from structured DocumentContent", async () => {
      const result = await generator.generateWord({
        title: "Structured Doc",
        sections: [
          { heading: "Section A", content: "Content of section A", level: 1 },
          { heading: "Section B", content: "Content of section B", level: 2 },
        ],
        style: "formal",
      });

      expect(result).toBeDefined();
      // Full DocumentContent returns FileResult
      const fileResult = result as { buffer: Buffer; filename: string; mimeType: string };
      expect(fileResult.buffer).toBeInstanceOf(Buffer);
      expect(fileResult.buffer.length).toBeGreaterThan(100);
      expect(fileResult.filename).toMatch(/\.docx$/);
    });
  });

  describe("Excel spreadsheet generation", () => {
    it("generates a valid XLSX from headers and rows", async () => {
      const result = await generator.generateExcel(
        ["Product", "Q1", "Q2", "Q3"],
        [
          ["Alpha", 100, 150, 200],
          ["Beta", 50, 75, 100],
        ],
        { title: "Sales Data", sheetName: "Q1 Report" },
      );

      expect(result).toBeInstanceOf(Buffer);
      expect((result as Buffer).length).toBeGreaterThan(100);
      // XLSX is also zip
      expect((result as Buffer)[0]).toBe(0x50);
      expect((result as Buffer)[1]).toBe(0x4b);
    });

    it("generates from structured StructuredData", async () => {
      const result = await generator.generateExcel({
        title: "Multi-sheet Report",
        sheets: [
          {
            name: "Revenue",
            headers: ["Month", "Revenue"],
            rows: [
              ["Jan", 1000],
              ["Feb", 1500],
            ],
          },
        ],
        theme: "professional",
      });

      const fileResult = result as { buffer: Buffer; filename: string };
      expect(fileResult.buffer).toBeInstanceOf(Buffer);
      expect(fileResult.buffer.length).toBeGreaterThan(100);
      expect(fileResult.filename).toMatch(/\.xlsx$/);
    });
  });

  describe("PowerPoint generation", () => {
    it("generates a valid PPTX from PresentationContent", async () => {
      const result = await generator.generatePowerPoint({
        title: "Product Launch",
        slides: [
          { title: "Introduction", body: "Our AI Platform" },
          { title: "Features", body: "- Smart chat\n- Document generation" },
        ],
      });

      expect(result).toBeDefined();
      const fileResult = result as { buffer: Buffer; filename: string };
      expect(fileResult.buffer).toBeInstanceOf(Buffer);
      expect(fileResult.buffer.length).toBeGreaterThan(100);
      // PPTX is also zip
      expect(fileResult.buffer[0]).toBe(0x50);
      expect(fileResult.buffer[1]).toBe(0x4b);
      expect(fileResult.filename).toMatch(/\.pptx$/);
    });
  });

  describe("CSV generation", () => {
    it("generates CSV from structured data", async () => {
      const result = await generator.generateCSV({
        headers: ["Name", "Email", "Role"],
        rows: [
          ["Alice", "alice@test.com", "Admin"],
          ["Bob", "bob@test.com", "User"],
        ],
        title: "Users",
      });

      expect(result).toBeDefined();
      const fileResult = result as { buffer: Buffer; filename: string };
      expect(fileResult.buffer).toBeInstanceOf(Buffer);
      const csv = fileResult.buffer.toString("utf-8");
      expect(csv).toContain("Name");
      expect(csv).toContain("alice@test.com");
    });

    it("generates CSV from raw string", async () => {
      const result = await generator.generateCSV("Name,Email\nAlice,alice@test.com");

      expect(result).toBeInstanceOf(Buffer);
      const csv = (result as Buffer).toString("utf-8");
      expect(csv).toContain("Alice");
    });
  });

  describe("handleDocument dispatcher", () => {
    it("dispatches word format correctly", async () => {
      const { handleDocument } = await import(
        "../services/skillHandlers/documentHandler"
      );

      const result = await handleDocument(
        {
          message: "Create a simple report about testing",
          userId: "test-user",
          chatId: "test-chat",
          locale: "en",
        },
        "word",
      );

      expect(result.skillId).toBe("create-word");
      expect(result.category).toBe("document-creation");
      // If generation succeeded, artifacts should have a docx
      if (result.handled) {
        expect(result.artifacts.length).toBeGreaterThan(0);
        expect(result.artifacts[0].mimeType).toContain("word");
      }
    });

    it("returns error for unsupported format", async () => {
      const { handleDocument } = await import(
        "../services/skillHandlers/documentHandler"
      );

      const result = await handleDocument(
        {
          message: "Create something",
          userId: "test-user",
          chatId: "test-chat",
          locale: "en",
        },
        "mp3",
      );

      expect(result.handled).toBe(false);
      expect(result.textResponse).toContain("Unsupported");
    });
  });
});
