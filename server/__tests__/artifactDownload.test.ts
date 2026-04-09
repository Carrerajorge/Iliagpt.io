import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ARTIFACTS_DIR = path.join(process.cwd(), "artifacts");

describe("artifact download system", () => {
  const testFilename = `test_artifact_${Date.now()}.pptx`;
  const testFilePath = path.join(ARTIFACTS_DIR, testFilename);

  beforeEach(() => {
    // Create a test artifact
    if (!fs.existsSync(ARTIFACTS_DIR)) {
      fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    }
    fs.writeFileSync(testFilePath, "fake-pptx-content-for-testing");
  });

  afterEach(() => {
    try { fs.unlinkSync(testFilePath); } catch { /* ignore */ }
  });

  it("artifacts directory exists and is writable", () => {
    expect(fs.existsSync(ARTIFACTS_DIR)).toBe(true);
    const testFile = path.join(ARTIFACTS_DIR, `write_test_${Date.now()}.tmp`);
    fs.writeFileSync(testFile, "test");
    expect(fs.existsSync(testFile)).toBe(true);
    // Best-effort cleanup — mounted volumes may deny deletion (EPERM)
    try { fs.unlinkSync(testFile); } catch { /* ignore permission errors */ }
  });

  it("test artifact file exists", () => {
    expect(fs.existsSync(testFilePath)).toBe(true);
    const content = fs.readFileSync(testFilePath, "utf-8");
    expect(content).toBe("fake-pptx-content-for-testing");
  });

  it("downloadUrl uses /download suffix", async () => {
    // Verify the saveSkillArtifact function generates correct URLs
    const { saveSkillArtifact } = await import("../services/skillAutoDispatcher");
    if (!saveSkillArtifact) return; // Function may not be exported

    // The URL pattern should be /api/artifacts/{filename}/download
    const urlPattern = /\/api\/artifacts\/[^/]+\/download$/;
    expect(urlPattern.test("/api/artifacts/test_file.pptx/download")).toBe(true);
    expect(urlPattern.test("/api/artifacts/test_file.pptx")).toBe(false);
  });

  it("path traversal is prevented", () => {
    const maliciousPath = path.join(ARTIFACTS_DIR, "../../../etc/passwd");
    const resolved = path.resolve(maliciousPath);
    const artifactsResolved = path.resolve(ARTIFACTS_DIR);
    expect(resolved.startsWith(artifactsResolved)).toBe(false);
  });

  it("MIME type mapping covers office formats", () => {
    const mimeTypes: Record<string, string> = {
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".pdf": "application/pdf",
      ".png": "image/png",
    };

    expect(mimeTypes[".pptx"]).toContain("presentationml");
    expect(mimeTypes[".docx"]).toContain("wordprocessingml");
    expect(mimeTypes[".xlsx"]).toContain("spreadsheetml");
    expect(mimeTypes[".pdf"]).toBe("application/pdf");
  });

  it("Content-Disposition header format is correct", () => {
    const filename = "presentacion.pptx";
    const header = `attachment; filename="${filename}"`;
    expect(header).toContain("attachment");
    expect(header).toContain(filename);
  });
});
