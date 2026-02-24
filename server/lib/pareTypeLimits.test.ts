import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkTypeLimits,
  estimateLimitsFromSize,
  formatViolationMessage,
} from "./pareTypeLimits";

describe("checkTypeLimits", () => {
  describe("PDF limits", () => {
    it("should fail when PDF page count exceeds limit", () => {
      const attachment = { name: "report.pdf", mimeType: "application/pdf", size: 1000 };
      const metadata = { pageCount: 600 };
      const result = checkTypeLimits(attachment, metadata);
      expect(result.passed).toBe(false);
      expect(result.violation?.type).toBe("pdf");
      expect(result.violation?.metric).toBe("pages");
    });

    it("should pass when PDF page count is within limits", () => {
      const attachment = { name: "report.pdf", mimeType: "application/pdf", size: 1000 };
      const metadata = { pageCount: 100 };
      const result = checkTypeLimits(attachment, metadata);
      expect(result.passed).toBe(true);
    });

    it("should warn when PDF page count approaches the limit (>80%)", () => {
      const attachment = { name: "report.pdf", mimeType: "application/pdf", size: 1000 };
      // Default max is 500, 80% = 400, so 420 should trigger warning
      const metadata = { pageCount: 420 };
      const result = checkTypeLimits(attachment, metadata);
      expect(result.passed).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
      expect(result.warnings![0].type).toBe("pdf");
    });
  });

  describe("Excel limits", () => {
    it("should fail when Excel cell count exceeds limit", () => {
      const attachment = { name: "data.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 1000 };
      const metadata = { cellCount: 2000000 };
      const result = checkTypeLimits(attachment, metadata);
      expect(result.passed).toBe(false);
      expect(result.violation?.type).toBe("xlsx");
      expect(result.violation?.metric).toBe("cells");
    });

    it("should fail when Excel row count exceeds limit", () => {
      const attachment = { name: "data.xlsx", size: 1000 };
      const metadata = { rowCount: 200000 };
      const result = checkTypeLimits(attachment, metadata);
      expect(result.passed).toBe(false);
      expect(result.violation?.type).toBe("xlsx");
      expect(result.violation?.metric).toBe("rows");
    });

    it("should pass when Excel metrics are within limits", () => {
      const attachment = { name: "data.xlsx", size: 1000 };
      const metadata = { rowCount: 1000, cellCount: 5000, sheetCount: 3 };
      const result = checkTypeLimits(attachment, metadata);
      expect(result.passed).toBe(true);
    });
  });

  describe("CSV limits", () => {
    it("should fail when CSV row count exceeds limit", () => {
      const attachment = { name: "export.csv", mimeType: "text/csv", size: 1000 };
      const metadata = { rowCount: 200000 };
      const result = checkTypeLimits(attachment, metadata);
      expect(result.passed).toBe(false);
      expect(result.violation?.type).toBe("csv");
      expect(result.violation?.metric).toBe("rows");
    });

    it("should fail when CSV column count exceeds limit", () => {
      const attachment = { name: "export.csv", size: 1000 };
      const metadata = { columnCount: 1500 };
      const result = checkTypeLimits(attachment, metadata);
      expect(result.passed).toBe(false);
      expect(result.violation?.type).toBe("csv");
      expect(result.violation?.metric).toBe("columns");
    });
  });

  describe("PowerPoint limits", () => {
    it("should fail when slide count exceeds limit", () => {
      const attachment = { name: "deck.pptx", size: 1000 };
      const metadata = { slideCount: 300 };
      const result = checkTypeLimits(attachment, metadata);
      expect(result.passed).toBe(false);
      expect(result.violation?.type).toBe("pptx");
      expect(result.violation?.metric).toBe("slides");
    });

    it("should pass when slide count is within limits", () => {
      const attachment = { name: "deck.pptx", size: 1000 };
      const metadata = { slideCount: 50 };
      const result = checkTypeLimits(attachment, metadata);
      expect(result.passed).toBe(true);
    });
  });

  describe("unknown file types", () => {
    it("should pass for unknown extensions", () => {
      const attachment = { name: "file.xyz", size: 1000 };
      const result = checkTypeLimits(attachment, {});
      expect(result.passed).toBe(true);
    });
  });
});

describe("formatViolationMessage", () => {
  it("should format a byte-based violation with human-readable sizes", () => {
    const msg = formatViolationMessage({
      type: "pdf",
      metric: "size",
      limit: 50 * 1024 * 1024,
      actual: 60 * 1024 * 1024,
      unit: "bytes",
    });
    expect(msg).toContain("PDF");
    expect(msg).toContain("maximum size");
    expect(msg).toContain("MB");
  });

  it("should format a non-byte violation with metric name", () => {
    const msg = formatViolationMessage({
      type: "csv",
      metric: "rows",
      limit: 100000,
      actual: 200000,
      unit: "rows",
    });
    expect(msg).toContain("CSV");
    expect(msg).toContain("maximum rows");
    expect(msg).toContain("200,000");
    expect(msg).toContain("100,000");
  });
});

describe("estimateLimitsFromSize", () => {
  it("should estimate that a very large PDF would exceed limits", () => {
    // Default max pages = 500, at ~50KB per page, 1.5x threshold means > 500*50000*1.5 = 37.5MB
    const attachment = { name: "huge.pdf", size: 40 * 1024 * 1024 };
    const result = estimateLimitsFromSize(attachment);
    expect(result.wouldExceed).toBe(true);
    expect(result.reason).toContain("PDF");
  });

  it("should not flag a small PDF", () => {
    const attachment = { name: "small.pdf", size: 50000 };
    const result = estimateLimitsFromSize(attachment);
    expect(result.wouldExceed).toBe(false);
  });

  it("should return wouldExceed false for unknown types", () => {
    const attachment = { name: "unknown.xyz", size: 999999999 };
    const result = estimateLimitsFromSize(attachment);
    expect(result.wouldExceed).toBe(false);
  });

  it("should return wouldExceed false when size is 0", () => {
    const attachment = { name: "empty.pdf", size: 0 };
    const result = estimateLimitsFromSize(attachment);
    expect(result.wouldExceed).toBe(false);
  });
});
