import { describe, expect, it } from "vitest";
import { LIMITS } from "../lib/constants";
import { validateUploadIntentMetadata } from "../routes/filesRouter";

describe("validateUploadIntentMetadata", () => {
  it("accepts requests without optional file metadata", () => {
    const result = validateUploadIntentMetadata({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hasMetadata).toBe(false);
    }
  });

  it("rejects incomplete metadata payloads", () => {
    const result = validateUploadIntentMetadata({
      fileName: "file.pdf",
      mimeType: "application/pdf",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("Missing or invalid file metadata");
    }
  });

  it("rejects unsupported mime types", () => {
    const result = validateUploadIntentMetadata({
      fileName: "payload.exe",
      mimeType: "application/x-msdownload",
      fileSize: 1024,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(415);
      expect(result.error).toBe("Unsupported file type");
    }
  });

  it("rejects files that exceed max size", () => {
    const result = validateUploadIntentMetadata({
      fileName: "big.pdf",
      mimeType: "application/pdf",
      fileSize: LIMITS.MAX_FILE_SIZE_BYTES + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(413);
      expect(result.error).toContain("File too large");
    }
  });

  it("rejects extension and mime mismatch", () => {
    const result = validateUploadIntentMetadata({
      fileName: "report.pdf",
      mimeType: "image/png",
      fileSize: 2048,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe("File extension does not match mimeType");
    }
  });

  it("accepts valid metadata with content-type parameters", () => {
    const result = validateUploadIntentMetadata({
      fileName: "report.pdf",
      mimeType: "application/pdf; charset=utf-8",
      fileSize: 2048,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hasMetadata).toBe(true);
      expect(result.mimeType).toBe("application/pdf");
      expect(result.fileName).toBe("report.pdf");
      expect(result.fileSize).toBe(2048);
    }
  });

  it("accepts legacy browser docx mime fallback from application/octet-stream", () => {
    const result = validateUploadIntentMetadata({
      fileName: "reporte.docx",
      mimeType: "application/octet-stream",
      fileSize: 2048,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    }
  });

  it("accepts alias MIME values from image/web safe variants", () => {
    const result = validateUploadIntentMetadata({
      fileName: "foto.jpg",
      mimeType: "image/pjpeg",
      fileSize: 2048,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mimeType).toBe("image/jpeg");
    }
  });

  it("normalizes unicode file names before validation", () => {
    const result = validateUploadIntentMetadata({
      fileName: "Ｒｅｐｏｒｔ.pdf",
      mimeType: "application/pdf",
      fileSize: 1024,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fileName).toBe("Report.pdf");
    }
  });
});
