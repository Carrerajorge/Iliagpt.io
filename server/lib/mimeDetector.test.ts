import { describe, it, expect } from "vitest";
import {
  detectMime,
  validateMimeType,
  detectDangerousFormat,
  quickCheckMime,
  validateMimeMatch,
  mimeDetector,
} from "./mimeDetector";

describe("detectMime", () => {
  it("detects PDF from magic bytes", () => {
    const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E]);
    const result = detectMime(pdfBuffer, "report.pdf");
    expect(result.detectedMime).toBe("application/pdf");
    expect(result.method).toBe("magic_bytes");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("detects PNG from magic bytes", () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const result = detectMime(pngBuffer, "image.png");
    expect(result.detectedMime).toBe("image/png");
    expect(result.method).toBe("magic_bytes");
  });

  it("detects JPEG from magic bytes", () => {
    const jpgBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    const result = detectMime(jpgBuffer, "photo.jpg");
    expect(result.detectedMime).toBe("image/jpeg");
  });

  it("detects GIF87a", () => {
    const gifBuffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
    const result = detectMime(gifBuffer, "anim.gif");
    expect(result.detectedMime).toBe("image/gif");
  });

  it("detects GIF89a", () => {
    const gifBuffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const result = detectMime(gifBuffer, "anim.gif");
    expect(result.detectedMime).toBe("image/gif");
  });

  it("detects ZIP from magic bytes", () => {
    const zipBuffer = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00]);
    const result = detectMime(zipBuffer, "archive.zip");
    expect(result.detectedMime).toBe("application/zip");
  });

  it("detects RTF from magic bytes", () => {
    const rtfBuffer = Buffer.from([0x7B, 0x5C, 0x72, 0x74, 0x66, 0x31]);
    const result = detectMime(rtfBuffer, "doc.rtf");
    expect(result.detectedMime).toBe("application/rtf");
  });

  it("detects JSON content via heuristic", () => {
    const jsonBuffer = Buffer.from('{"key":"value"}');
    const result = detectMime(jsonBuffer, "data.json");
    expect(result.detectedMime).toBe("application/json");
    expect(result.method).toBe("heuristic");
  });

  it("detects HTML content via heuristic", () => {
    const htmlBuffer = Buffer.from("<!DOCTYPE html><html><body>Hello</body></html>");
    const result = detectMime(htmlBuffer, "page.html");
    expect(result.detectedMime).toBe("text/html");
  });

  it("detects CSV content via heuristic", () => {
    const csvBuffer = Buffer.from("name,age,city\nAlice,30,NYC\nBob,25,LA\n");
    const result = detectMime(csvBuffer, "data.csv");
    expect(result.detectedMime).toBe("text/csv");
  });

  it("detects markdown content via heuristic", () => {
    const mdBuffer = Buffer.from("# Hello World\n\nThis is a paragraph\n\n- item 1\n- item 2\n");
    const result = detectMime(mdBuffer, "readme.md");
    expect(result.detectedMime).toBe("text/markdown");
  });

  it("detects plain text as fallback", () => {
    const textBuffer = Buffer.from("Just some plain text content here.");
    const result = detectMime(textBuffer, "notes.txt");
    expect(result.detectedMime).toBe("text/plain");
  });

  it("uses extension when binary content has no magic match", () => {
    // Buffer.alloc(100, 0x00) matches MZ header or video/mp4 magic, so use 0x01
    const binaryBuffer = Buffer.alloc(100, 0x01);
    const result = detectMime(binaryBuffer, "data.bin");
    // No magic match + binary content + no known extension = unknown
    expect(["extension", "unknown"]).toContain(result.method);
  });

  it("reports mismatch when provided MIME differs from detected", () => {
    const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D]);
    const result = detectMime(pdfBuffer, "report.pdf", "image/png");
    expect(result.mismatch).toBe(true);
    expect(result.mismatchDetails).toContain("Provided");
  });

  it("does not report mismatch for octet-stream", () => {
    const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D]);
    const result = detectMime(pdfBuffer, "report.pdf", "application/octet-stream");
    expect(result.mismatch).toBe(false);
  });

  it("returns low confidence for unrecognized binary with no extension", () => {
    // 0x01-filled buffer won't match any magic signatures
    const unknownBuffer = Buffer.alloc(100, 0x01);
    const result = detectMime(unknownBuffer, "noext");
    expect(result.method).toBe("unknown");
    expect(result.confidence).toBeLessThanOrEqual(0.3);
  });
});

describe("validateMimeType", () => {
  it("allows PDF", () => {
    const result = validateMimeType("application/pdf");
    expect(result.allowed).toBe(true);
  });

  it("allows image/png", () => {
    const result = validateMimeType("image/png");
    expect(result.allowed).toBe(true);
  });

  it("allows text/plain", () => {
    const result = validateMimeType("text/plain");
    expect(result.allowed).toBe(true);
  });

  it("blocks denylisted MIME types", () => {
    const result = validateMimeType("application/x-executable");
    expect(result.allowed).toBe(false);
    expect(result.matchedRule).toBe("denylist");
  });

  it("blocks application/javascript", () => {
    const result = validateMimeType("application/javascript");
    expect(result.allowed).toBe(false);
  });

  it("blocks dangerous magic bytes (MZ header)", () => {
    const exeBuffer = Buffer.from([0x4D, 0x5A, 0x90, 0x00]);
    const result = validateMimeType("application/pdf", exeBuffer);
    expect(result.allowed).toBe(false);
    expect(result.matchedRule).toBe("dangerous_magic");
  });

  it("blocks ELF executables", () => {
    const elfBuffer = Buffer.from([0x7F, 0x45, 0x4C, 0x46]);
    const result = validateMimeType("application/pdf", elfBuffer);
    expect(result.allowed).toBe(false);
  });

  it("blocks shell scripts", () => {
    const shBuffer = Buffer.from("#!/bin/bash\nrm -rf /\n");
    const result = validateMimeType("text/plain", shBuffer);
    expect(result.allowed).toBe(false);
  });

  it("blocks dangerous double extensions", () => {
    const result = validateMimeType("application/pdf", undefined, "report.pdf.exe");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("double");
  });

  it("blocks SVG with embedded scripts", () => {
    const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const result = validateMimeType("image/svg+xml", svgBuffer);
    expect(result.allowed).toBe(false);
  });

  it("allows clean SVG", () => {
    const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>');
    const result = validateMimeType("image/svg+xml", svgBuffer);
    expect(result.allowed).toBe(true);
  });

  it("allows OOXML patterns", () => {
    const result = validateMimeType(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(result.allowed).toBe(true);
  });
});

describe("detectDangerousFormat", () => {
  it("detects MZ header as dangerous", () => {
    const result = detectDangerousFormat(Buffer.from([0x4D, 0x5A, 0x00, 0x00]));
    expect(result.isDangerous).toBe(true);
    expect(result.signature?.threat).toBe("executable");
  });

  it("detects shell scripts", () => {
    const result = detectDangerousFormat(Buffer.from("#!/bin/bash\necho hi\n"));
    expect(result.isDangerous).toBe(true);
    expect(result.isShellScript).toBe(true);
  });

  it("returns safe for normal content", () => {
    const result = detectDangerousFormat(Buffer.from("Hello, World!"));
    expect(result.isDangerous).toBe(false);
    expect(result.isShellScript).toBe(false);
  });
});

describe("quickCheckMime", () => {
  it("returns true when magic bytes match expected MIME", () => {
    const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D]);
    expect(quickCheckMime(pdfBuffer, "application/pdf")).toBe(true);
  });

  it("returns false when content does not match", () => {
    const textBuffer = Buffer.from("Hello, World!");
    expect(quickCheckMime(textBuffer, "application/pdf")).toBe(false);
  });
});

describe("validateMimeMatch", () => {
  it("returns valid when MIME matches", () => {
    const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D]);
    const result = validateMimeMatch(pdfBuffer, "report.pdf", "application/pdf");
    expect(result.valid).toBe(true);
  });

  it("returns invalid on mismatch", () => {
    const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D]);
    const result = validateMimeMatch(pdfBuffer, "report.pdf", "image/png");
    expect(result.valid).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

describe("mimeDetector namespace", () => {
  it("exports EXTENSION_TO_MIME mapping", () => {
    expect(mimeDetector.EXTENSION_TO_MIME["pdf"]).toBe("application/pdf");
    expect(mimeDetector.EXTENSION_TO_MIME["docx"]).toContain("wordprocessingml");
    expect(mimeDetector.EXTENSION_TO_MIME["xlsx"]).toContain("spreadsheetml");
  });

  it("has allowlist and denylist arrays", () => {
    expect(mimeDetector.MIME_ALLOWLIST.length).toBeGreaterThan(0);
    expect(mimeDetector.MIME_DENYLIST.length).toBeGreaterThan(0);
  });

  it("hasDoubleExtension detects report.pdf.exe", () => {
    const result = mimeDetector.hasDoubleExtension("report.pdf.exe");
    expect(result.dangerous).toBe(true);
  });

  it("hasDoubleExtension passes normal filenames", () => {
    expect(mimeDetector.hasDoubleExtension("report.pdf").dangerous).toBe(false);
    expect(mimeDetector.hasDoubleExtension("").dangerous).toBe(false);
  });
});
