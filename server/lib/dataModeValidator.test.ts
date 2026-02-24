import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateDataModeResponse,
  assertDataModeCompliance,
  detectFullCoverageRequirement,
  DataModeOutputViolationError,
} from "../lib/dataModeValidator";

describe("dataModeValidator", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ---------- validateDataModeResponse ----------

  describe("validateDataModeResponse", () => {
    it("passes for clean text-only payload", () => {
      const payload = {
        answer_text: "This is a plain text answer with no violations.",
        metadata: { tokens: 100 },
      };
      const result = validateDataModeResponse(payload, "req-1");
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("detects forbidden key: image", () => {
      const payload = { image: "some-url" };
      const result = validateDataModeResponse(payload, "req-2");
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations.some((v) => v.includes("image"))).toBe(true);
    });

    it("detects forbidden key: artifact", () => {
      const payload = { artifact: { type: "img" } };
      const result = validateDataModeResponse(payload, "req-3");
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes("artifact"))).toBe(true);
    });

    it("detects forbidden key: download_url", () => {
      const payload = { download_url: "https://example.com/file.bin" };
      const result = validateDataModeResponse(payload, "req-4");
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes("download_url"))).toBe(
        true,
      );
    });

    it("detects forbidden content-type: image/png", () => {
      const payload = {
        "content-type": "image/png",
      };
      const result = validateDataModeResponse(payload, "req-5");
      expect(result.valid).toBe(false);
      expect(
        result.violations.some((v) => v.includes("content-type")),
      ).toBe(true);
    });

    it("detects 'here is the image' text pattern in answer_text", () => {
      const payload = {
        answer_text: "Here is the image you requested, showing chart data.",
      };
      const result = validateDataModeResponse(payload, "req-6");
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it("detects base64 data:image URI in answer_text", () => {
      const payload = {
        answer_text: "Image data: data:image/png;base64,iVBORw0KGgo=",
      };
      const result = validateDataModeResponse(payload, "req-7");
      expect(result.valid).toBe(false);
    });

    it("detects nested forbidden key in deep object", () => {
      const payload = {
        response: {
          nested: {
            imageUrl: "https://example.com/pic.jpg",
          },
        },
      };
      const result = validateDataModeResponse(payload, "req-8");
      expect(result.valid).toBe(false);
    });

    it("does not flag clean nested objects", () => {
      const payload = {
        answer_text: "All good.",
        per_doc_findings: {
          "doc1.pdf": ["Finding 1", "Finding 2"],
        },
      };
      const result = validateDataModeResponse(payload, "req-9");
      expect(result.valid).toBe(true);
    });

    it("includes stack trace on violation", () => {
      const payload = { image: "url" };
      const result = validateDataModeResponse(payload, "req-10");
      expect(result.stack).toBeDefined();
    });
  });

  // ---------- detectFullCoverageRequirement ----------

  describe("detectFullCoverageRequirement", () => {
    it('detects "todos" keyword', () => {
      expect(detectFullCoverageRequirement("Analiza todos los documentos")).toBe(
        true,
      );
    });

    it('detects "all" keyword', () => {
      expect(detectFullCoverageRequirement("Review all the files")).toBe(true);
    });

    it('detects "completo" keyword', () => {
      expect(
        detectFullCoverageRequirement("Necesito un analisis completo"),
      ).toBe(true);
    });

    it("returns false for generic queries", () => {
      expect(detectFullCoverageRequirement("What does this document say?")).toBe(
        false,
      );
    });

    it("returns false for empty string", () => {
      expect(detectFullCoverageRequirement("")).toBe(false);
    });
  });

  // ---------- assertDataModeCompliance ----------

  describe("assertDataModeCompliance", () => {
    it("throws DataModeOutputViolationError on violation", () => {
      const payload = { image: "bad-url" };
      expect(() => assertDataModeCompliance(payload, "req-err")).toThrowError(
        DataModeOutputViolationError,
      );
    });

    it("does not throw for valid payload", () => {
      const payload = { answer_text: "Clean response." };
      expect(() =>
        assertDataModeCompliance(payload, "req-ok"),
      ).not.toThrow();
    });
  });

  // ---------- DataModeOutputViolationError ----------

  describe("DataModeOutputViolationError", () => {
    it("has correct name and properties", () => {
      const err = new DataModeOutputViolationError("req-x", [
        "violation 1",
        "violation 2",
      ]);
      expect(err.name).toBe("DataModeOutputViolationError");
      expect(err.requestId).toBe("req-x");
      expect(err.violations).toEqual(["violation 1", "violation 2"]);
      expect(err.message).toContain("DATA_MODE_OUTPUT_VIOLATION");
    });
  });
});
