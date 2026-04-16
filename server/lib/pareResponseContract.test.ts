import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractCitationsFromText,
  normalizeDocName,
  validateResponseContract,
  ResponseContractViolationError,
  assertResponseContract,
} from "../lib/pareResponseContract";

describe("pareResponseContract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ---------- extractCitationsFromText ----------

  describe("extractCitationsFromText", () => {
    it("extracts [doc:file.pdf] citation patterns", () => {
      const text = "See [doc:report.pdf] for details.";
      const citations = extractCitationsFromText(text);
      expect(citations).toEqual(["report.pdf"]);
    });

    it("extracts multiple unique citations", () => {
      const text =
        "Based on [doc:a.pdf] and [doc:b.xlsx], also [doc:a.pdf] again.";
      const citations = extractCitationsFromText(text);
      expect(citations).toEqual(["a.pdf", "b.xlsx"]);
    });

    it("returns empty array for no citations", () => {
      expect(extractCitationsFromText("No citations here.")).toEqual([]);
    });

    it("returns empty array for null/undefined input", () => {
      expect(extractCitationsFromText(null as any)).toEqual([]);
      expect(extractCitationsFromText(undefined as any)).toEqual([]);
    });
  });

  // ---------- normalizeDocName ----------

  describe("normalizeDocName", () => {
    it("lowercases the document name", () => {
      expect(normalizeDocName("Report.PDF")).toBe("report.pdf");
    });

    it("trims whitespace", () => {
      expect(normalizeDocName("  doc.txt  ")).toBe("doc.txt");
    });

    it("handles mixed case and whitespace", () => {
      expect(normalizeDocName("  My File.DOCX  ")).toBe("my file.docx");
    });
  });

  // ---------- validateResponseContract ----------

  describe("validateResponseContract", () => {
    it("returns valid for clean text-only response", () => {
      const response = {
        answer_text:
          "The data shows growth. [doc:report.pdf]",
      };
      const result = validateResponseContract(response, ["report.pdf"]);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("detects binary content (Buffer)", () => {
      const response = {
        data: Buffer.from("binary-data"),
      };
      const result = validateResponseContract(response, []);
      expect(result.valid).toBe(false);
      expect(result.hasNoBinaryFields).toBe(false);
      expect(
        result.violations.some((v) => v.code === "BINARY_CONTENT_DETECTED"),
      ).toBe(true);
    });

    it("detects base64 data exceeding threshold", () => {
      const largeBase64 =
        "data:application/pdf;base64," + "A".repeat(2000);
      const response = { content: largeBase64 };
      const result = validateResponseContract(response, []);
      expect(result.valid).toBe(false);
      expect(result.hasNoBase64Data).toBe(false);
    });

    it("detects data:image URLs", () => {
      const response = {
        url: "data:image/png;base64,iVBORw0KGgo=",
      };
      const result = validateResponseContract(response, []);
      expect(result.valid).toBe(false);
      expect(result.hasNoImageUrls).toBe(false);
    });

    it("computes coverage ratio correctly", () => {
      const response = {
        answer_text: "See [doc:a.pdf] for details.",
      };
      const result = validateResponseContract(response, [
        "a.pdf",
        "b.pdf",
      ]);
      expect(result.coverageRatio).toBe(0.5);
      expect(result.documentsWithCitations).toEqual(["a.pdf"]);
      expect(result.documentsWithoutCitations).toEqual(["b.pdf"]);
    });

    it("reports coverage violation when requireFullCoverage is true", () => {
      const response = { answer_text: "See [doc:a.pdf]." };
      const result = validateResponseContract(response, ["a.pdf", "b.pdf"], {
        requireFullCoverage: true,
      });
      expect(result.valid).toBe(false);
      expect(result.meetsCoverageRequirement).toBe(false);
      expect(
        result.violations.some((v) => v.code === "COVERAGE_INCOMPLETE"),
      ).toBe(true);
    });

    it("passes when all docs are cited with requireFullCoverage", () => {
      const response = {
        answer_text: "See [doc:a.pdf] and [doc:b.pdf].",
      };
      const result = validateResponseContract(response, ["a.pdf", "b.pdf"], {
        requireFullCoverage: true,
      });
      expect(result.valid).toBe(true);
    });
  });

  // ---------- ResponseContractViolationError ----------

  describe("ResponseContractViolationError", () => {
    it("has correct name and properties", () => {
      const validation = validateResponseContract(
        { data: Buffer.from("x") },
        [],
      );
      const error = new ResponseContractViolationError("req-1", validation);
      expect(error.name).toBe("ResponseContractViolationError");
      expect(error.requestId).toBe("req-1");
      expect(error.violations.length).toBeGreaterThan(0);
      expect(error.message).toContain("RESPONSE_CONTRACT_VIOLATION");
    });
  });

  // ---------- assertResponseContract ----------

  describe("assertResponseContract", () => {
    it("throws ResponseContractViolationError on violation", () => {
      const response = { data: Buffer.from("binary") };
      expect(() =>
        assertResponseContract(response, [], "req-123"),
      ).toThrowError(ResponseContractViolationError);
    });

    it("returns validation result when valid", () => {
      const response = { answer_text: "Clean text only." };
      const result = assertResponseContract(response, [], "req-ok");
      expect(result.valid).toBe(true);
    });
  });
});
