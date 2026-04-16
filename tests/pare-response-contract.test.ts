import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  validateResponseContract,
  extractCitationsFromText,
  normalizeDocName,
  ResponseContractViolationError,
  assertResponseContract,
  type ResponseContractValidation,
  type ResponseContractViolationCode
} from "../server/lib/pareResponseContract";
import {
  validateDataModeResponseEnhanced,
  detectFullCoverageRequirement,
  assertDataModeComplianceEnhanced
} from "../server/lib/dataModeValidator";

describe("PARE Response Contract Validator", () => {
  
  describe("extractCitationsFromText", () => {
    
    it("should extract simple document citations", () => {
      const text = "Based on [doc:report.pdf], the revenue increased.";
      const citations = extractCitationsFromText(text);
      expect(citations).toEqual(["report.pdf"]);
    });
    
    it("should extract citations with page numbers", () => {
      const text = "According to [doc:document.pdf p:5], the data shows...";
      const citations = extractCitationsFromText(text);
      expect(citations).toEqual(["document.pdf"]);
    });
    
    it("should extract citations with sheet references", () => {
      const text = "From [doc:data.xlsx sheet:Sales cell:A1], we can see...";
      const citations = extractCitationsFromText(text);
      expect(citations).toEqual(["data.xlsx"]);
    });
    
    it("should extract citations with slide references", () => {
      const text = "In [doc:presentation.pptx slide:3], the chart shows...";
      const citations = extractCitationsFromText(text);
      expect(citations).toEqual(["presentation.pptx"]);
    });
    
    it("should extract multiple unique citations", () => {
      const text = `
        Based on [doc:report1.pdf p:2], sales increased.
        According to [doc:data.xlsx sheet:Q1], revenue grew.
        From [doc:report1.pdf p:5], profits rose.
        See [doc:summary.docx] for details.
      `;
      const citations = extractCitationsFromText(text);
      expect(citations).toHaveLength(3);
      expect(citations).toContain("report1.pdf");
      expect(citations).toContain("data.xlsx");
      expect(citations).toContain("summary.docx");
    });
    
    it("should handle empty text", () => {
      expect(extractCitationsFromText("")).toEqual([]);
      expect(extractCitationsFromText(null as any)).toEqual([]);
      expect(extractCitationsFromText(undefined as any)).toEqual([]);
    });
    
    it("should not extract malformed citations", () => {
      const text = "See [doc: invalid] or [doc:] for details.";
      const citations = extractCitationsFromText(text);
      expect(citations).toEqual([]);
    });
    
    it("should handle citations with complex filenames", () => {
      const text = "From [doc:2024_Q1_Financial_Report.pdf p:12], we note...";
      const citations = extractCitationsFromText(text);
      expect(citations).toEqual(["2024_Q1_Financial_Report.pdf"]);
    });
  });
  
  describe("normalizeDocName", () => {
    
    it("should lowercase and trim document names", () => {
      expect(normalizeDocName("Report.PDF")).toBe("report.pdf");
      expect(normalizeDocName("  data.xlsx  ")).toBe("data.xlsx");
      expect(normalizeDocName("DOCUMENT.DOCX")).toBe("document.docx");
    });
  });
  
  describe("validateResponseContract - Content-Type validation", () => {
    
    it("should pass with valid application/json content type", () => {
      const result = validateResponseContract(
        { answer_text: "Test" },
        [],
        { contentType: "application/json" }
      );
      expect(result.hasValidContentType).toBe(true);
      expect(result.valid).toBe(true);
    });
    
    it("should pass with application/json; charset=utf-8", () => {
      const result = validateResponseContract(
        { answer_text: "Test" },
        [],
        { contentType: "application/json; charset=utf-8" }
      );
      expect(result.hasValidContentType).toBe(true);
    });
    
    it("should fail with invalid content type", () => {
      const result = validateResponseContract(
        { answer_text: "Test" },
        [],
        { contentType: "text/html" }
      );
      expect(result.hasValidContentType).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.code === "INVALID_CONTENT_TYPE")).toBe(true);
    });
    
    it("should pass when no content type is provided", () => {
      const result = validateResponseContract(
        { answer_text: "Test" },
        [],
        {}
      );
      expect(result.hasValidContentType).toBe(true);
    });
  });
  
  describe("validateResponseContract - Binary content detection", () => {
    
    it("should detect data:image URLs", () => {
      const response = {
        answer_text: "Here is the result",
        imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
      };
      const result = validateResponseContract(response, []);
      expect(result.hasNoImageUrls).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.code === "IMAGE_URL_DETECTED")).toBe(true);
    });
    
    it("should detect large base64 data (>1KB)", () => {
      const largeBase64 = "data:application/pdf;base64," + "A".repeat(2000);
      const response = {
        answer_text: "Result",
        data: largeBase64
      };
      const result = validateResponseContract(response, []);
      expect(result.hasNoBase64Data).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.code === "BASE64_DATA_DETECTED")).toBe(true);
    });
    
    it("should allow small base64 data (<1KB)", () => {
      const smallBase64 = "data:text/plain;base64,SGVsbG8gV29ybGQ=";
      const response = {
        answer_text: "Result",
        data: smallBase64
      };
      const result = validateResponseContract(response, []);
      expect(result.hasNoBase64Data).toBe(true);
      expect(result.hasNoImageUrls).toBe(true);
    });
    
    it("should detect nested binary content", () => {
      const response = {
        answer_text: "Result",
        nested: {
          deep: {
            image: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/"
          }
        }
      };
      const result = validateResponseContract(response, []);
      expect(result.hasNoImageUrls).toBe(false);
      expect(result.violations[0].path).toBe("nested.deep.image");
    });
    
    it("should detect binary content in arrays", () => {
      const response = {
        answer_text: "Result",
        items: [
          { name: "normal" },
          { image: "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" }
        ]
      };
      const result = validateResponseContract(response, []);
      expect(result.hasNoImageUrls).toBe(false);
      expect(result.violations[0].path).toBe("items[1].image");
    });
    
    it("should pass with clean response", () => {
      const response = {
        answer_text: "This is a clean text response with [doc:report.pdf] citation.",
        metadata: {
          tokens: 100,
          processingTime: 500
        }
      };
      const result = validateResponseContract(response, ["report.pdf"]);
      expect(result.hasNoBlobs).toBe(true);
      expect(result.hasNoBase64Data).toBe(true);
      expect(result.hasNoImageUrls).toBe(true);
      expect(result.hasNoBinaryFields).toBe(true);
    });
  });
  
  describe("validateResponseContract - Citation coverage", () => {
    
    it("should track documents with citations", () => {
      const response = {
        answer_text: `
          According to [doc:report.pdf p:3], revenue increased.
          From [doc:data.xlsx sheet:Q1], we see growth.
        `
      };
      const attachments = ["report.pdf", "data.xlsx", "summary.docx"];
      const result = validateResponseContract(response, attachments);
      
      expect(result.documentsWithCitations).toContain("report.pdf");
      expect(result.documentsWithCitations).toContain("data.xlsx");
      expect(result.documentsWithoutCitations).toContain("summary.docx");
      expect(result.coverageRatio).toBeCloseTo(2/3);
    });
    
    it("should pass coverage when all docs are cited", () => {
      const response = {
        answer_text: `
          From [doc:report.pdf], we note X.
          In [doc:data.xlsx], we see Y.
        `
      };
      const result = validateResponseContract(
        response, 
        ["report.pdf", "data.xlsx"],
        { requireFullCoverage: true }
      );
      
      expect(result.meetsCoverageRequirement).toBe(true);
      expect(result.coverageRatio).toBe(1);
      expect(result.valid).toBe(true);
    });
    
    it("should fail coverage when docs are missing citations and full coverage required", () => {
      const response = {
        answer_text: "Based on [doc:report.pdf], the data shows..."
      };
      const result = validateResponseContract(
        response,
        ["report.pdf", "data.xlsx", "summary.docx"],
        { requireFullCoverage: true }
      );
      
      expect(result.meetsCoverageRequirement).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.code === "COVERAGE_INCOMPLETE")).toBe(true);
      expect(result.documentsWithoutCitations).toContain("data.xlsx");
      expect(result.documentsWithoutCitations).toContain("summary.docx");
    });
    
    it("should pass when coverage not required even with missing citations", () => {
      const response = {
        answer_text: "Based on [doc:report.pdf], the data shows..."
      };
      const result = validateResponseContract(
        response,
        ["report.pdf", "data.xlsx"],
        { requireFullCoverage: false }
      );
      
      expect(result.meetsCoverageRequirement).toBe(true);
      expect(result.valid).toBe(true);
    });
    
    it("should handle case-insensitive document matching", () => {
      const response = {
        answer_text: "From [doc:REPORT.PDF], we see..."
      };
      const result = validateResponseContract(response, ["report.pdf"]);
      expect(result.documentsWithCitations).toContain("report.pdf");
    });
    
    it("should handle empty attachment list", () => {
      const response = {
        answer_text: "No documents to cite."
      };
      const result = validateResponseContract(response, []);
      expect(result.coverageRatio).toBe(1);
      expect(result.meetsCoverageRequirement).toBe(true);
    });
  });
  
  describe("detectFullCoverageRequirement", () => {
    
    it("should detect 'todos' in Spanish queries", () => {
      expect(detectFullCoverageRequirement("Analiza todos los documentos")).toBe(true);
      expect(detectFullCoverageRequirement("Resume todos los archivos")).toBe(true);
    });
    
    it("should detect 'all' in English queries", () => {
      expect(detectFullCoverageRequirement("Analyze all documents")).toBe(true);
      expect(detectFullCoverageRequirement("Summarize all files")).toBe(true);
    });
    
    it("should detect 'complete' and 'every'", () => {
      expect(detectFullCoverageRequirement("Give me a complete analysis")).toBe(true);
      expect(detectFullCoverageRequirement("Check every document")).toBe(true);
    });
    
    it("should return false for partial queries", () => {
      expect(detectFullCoverageRequirement("Summarize the main points")).toBe(false);
      expect(detectFullCoverageRequirement("What does the report say?")).toBe(false);
    });
    
    it("should handle empty or null queries", () => {
      expect(detectFullCoverageRequirement("")).toBe(false);
      expect(detectFullCoverageRequirement(null as any)).toBe(false);
    });
  });
  
  describe("validateDataModeResponseEnhanced", () => {
    
    it("should combine response contract and DATA_MODE validation", () => {
      const payload = {
        answer_text: "Clean response with [doc:report.pdf] citation."
      };
      const result = validateDataModeResponseEnhanced(payload, "test-123", {
        attachmentNames: ["report.pdf"],
        contentType: "application/json"
      });
      
      expect(result.valid).toBe(true);
      expect(result.responseContractValidation).toBeDefined();
    });
    
    it("should detect forbidden keys from DATA_MODE validation", () => {
      const payload = {
        answer_text: "Result",
        image: "some-image-data"
      };
      const result = validateDataModeResponseEnhanced(payload, "test-123");
      
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("image"))).toBe(true);
    });
    
    it("should detect forbidden text patterns", () => {
      const payload = {
        answer_text: "He generado una imagen para mostrar los datos."
      };
      const result = validateDataModeResponseEnhanced(payload, "test-123");
      
      expect(result.valid).toBe(false);
      expect(result.violationDetails?.some(v => v.code === "FORBIDDEN_TEXT_PATTERN")).toBe(true);
    });
    
    it("should integrate coverage check based on userQuery", () => {
      const payload = {
        answer_text: "Based on [doc:report.pdf], we see..."
      };
      const result = validateDataModeResponseEnhanced(payload, "test-123", {
        attachmentNames: ["report.pdf", "data.xlsx"],
        userQuery: "Analiza todos los documentos"
      });
      
      expect(result.valid).toBe(false);
      expect(result.violationDetails?.some(v => v.code === "COVERAGE_INCOMPLETE")).toBe(true);
    });
    
    it("should pass when full coverage met", () => {
      const payload = {
        answer_text: "From [doc:report.pdf] and [doc:data.xlsx], we conclude..."
      };
      const result = validateDataModeResponseEnhanced(payload, "test-123", {
        attachmentNames: ["report.pdf", "data.xlsx"],
        userQuery: "Analiza todos los documentos"
      });
      
      expect(result.valid).toBe(true);
    });
  });
  
  describe("ResponseContractViolationError", () => {
    
    it("should create error with violation details", () => {
      const validation: ResponseContractValidation = {
        hasValidContentType: true,
        hasNoBlobs: false,
        hasNoBase64Data: true,
        hasNoImageUrls: true,
        hasNoBinaryFields: false,
        documentsWithCitations: [],
        documentsWithoutCitations: ["doc.pdf"],
        coverageRatio: 0,
        meetsCoverageRequirement: false,
        valid: false,
        violations: [
          { code: "BINARY_CONTENT_DETECTED" as ResponseContractViolationCode, message: "Buffer found at path.data" },
          { code: "COVERAGE_INCOMPLETE" as ResponseContractViolationCode, message: "1 doc missing citations" }
        ]
      };
      
      const error = new ResponseContractViolationError("req-123", validation);
      
      expect(error.name).toBe("ResponseContractViolationError");
      expect(error.requestId).toBe("req-123");
      expect(error.violations).toHaveLength(2);
      expect(error.message).toContain("BINARY_CONTENT_DETECTED");
    });
  });
  
  describe("assertResponseContract", () => {
    
    it("should not throw for valid response", () => {
      const response = {
        answer_text: "Valid response with [doc:report.pdf] citation."
      };
      
      expect(() => {
        assertResponseContract(response, ["report.pdf"], "test-123");
      }).not.toThrow();
    });
    
    it("should throw ResponseContractViolationError for invalid response", () => {
      const response = {
        answer_text: "Response",
        imageData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
      };
      
      expect(() => {
        assertResponseContract(response, [], "test-123");
      }).toThrow(ResponseContractViolationError);
    });
    
    it("should throw for incomplete coverage when required", () => {
      const response = {
        answer_text: "Only mentions [doc:report.pdf]."
      };
      
      expect(() => {
        assertResponseContract(
          response, 
          ["report.pdf", "data.xlsx"], 
          "test-123",
          { requireFullCoverage: true }
        );
      }).toThrow(ResponseContractViolationError);
    });
  });
  
  describe("Edge cases", () => {
    
    it("should handle deeply nested objects", () => {
      const response = {
        answer_text: "Test",
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  safeData: "This is fine"
                }
              }
            }
          }
        }
      };
      const result = validateResponseContract(response, []);
      expect(result.valid).toBe(true);
    });
    
    it("should handle circular reference prevention (arrays)", () => {
      const response = {
        answer_text: "Test",
        items: [1, 2, 3, [4, 5, [6, 7]]]
      };
      const result = validateResponseContract(response, []);
      expect(result.valid).toBe(true);
    });
    
    it("should handle null and undefined values", () => {
      const response = {
        answer_text: "Test",
        nullField: null,
        undefinedField: undefined,
        nested: {
          alsoNull: null
        }
      };
      const result = validateResponseContract(response, []);
      expect(result.valid).toBe(true);
    });
    
    it("should handle special characters in document names", () => {
      const response = {
        answer_text: "From [doc:2024-Q1 Financial (Report).pdf], we see..."
      };
      const result = validateResponseContract(response, ["2024-Q1 Financial (Report).pdf"]);
      expect(result.documentsWithCitations.length).toBeGreaterThan(0);
    });
    
    it("should handle very long answer text", () => {
      const longText = "[doc:report.pdf] " + "This is a very long text. ".repeat(1000);
      const response = { answer_text: longText };
      const result = validateResponseContract(response, ["report.pdf"]);
      expect(result.documentsWithCitations).toContain("report.pdf");
    });
    
    it("should handle multiple violations simultaneously", () => {
      const response = {
        answer_text: "He generado una imagen",
        image: "data:image/png;base64," + "A".repeat(2000),
        artifact: { type: "image" }
      };
      const result = validateDataModeResponseEnhanced(response, "test-123", {
        attachmentNames: ["doc.pdf"],
        requireFullCoverage: true
      });
      
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(1);
    });
  });
  
  describe("Violation codes", () => {
    
    it("should use correct violation codes for each type", () => {
      const testCases: Array<{
        response: any;
        options: any;
        expectedCode: string;
      }> = [
        {
          response: { answer_text: "test" },
          options: { contentType: "text/html" },
          expectedCode: "INVALID_CONTENT_TYPE"
        },
        {
          response: { answer_text: "test", img: "data:image/png;base64,abc" },
          options: {},
          expectedCode: "IMAGE_URL_DETECTED"
        },
        {
          response: { answer_text: "test", data: "data:application/pdf;base64," + "A".repeat(2000) },
          options: {},
          expectedCode: "BASE64_DATA_DETECTED"
        },
        {
          response: { answer_text: "Only [doc:one.pdf]" },
          options: { requireFullCoverage: true },
          expectedCode: "COVERAGE_INCOMPLETE"
        }
      ];
      
      for (const tc of testCases) {
        const result = validateResponseContract(
          tc.response,
          tc.expectedCode === "COVERAGE_INCOMPLETE" ? ["one.pdf", "two.pdf"] : [],
          tc.options
        );
        expect(result.violations.some(v => v.code === tc.expectedCode)).toBe(true);
      }
    });
  });
});

describe("Integration with assertDataModeComplianceEnhanced", () => {
  
  it("should throw for combined violations", () => {
    const payload = {
      answer_text: "He generado una imagen para mostrar [doc:report.pdf]",
      imageData: "data:image/png;base64,abc123"
    };
    
    expect(() => {
      assertDataModeComplianceEnhanced(payload, "test-123", {
        attachmentNames: ["report.pdf", "data.xlsx"],
        requireFullCoverage: true
      });
    }).toThrow();
  });
  
  it("should return validation result on success", () => {
    const payload = {
      answer_text: "Analysis of [doc:report.pdf] and [doc:data.xlsx] shows growth."
    };
    
    const result = assertDataModeComplianceEnhanced(payload, "test-123", {
      attachmentNames: ["report.pdf", "data.xlsx"],
      requireFullCoverage: true
    });
    
    expect(result.valid).toBe(true);
    expect(result.responseContractValidation?.coverageRatio).toBe(1);
  });
});
