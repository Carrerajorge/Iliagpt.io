import { describe, it, expect } from "vitest";
import {
  getFileCategory,
  getFileTheme,
  getFileThemeByCategory,
  fileThemes,
} from "./fileTypeTheme";

describe("getFileCategory", () => {
  it("detects PDF by extension", () => {
    expect(getFileCategory("document.pdf")).toBe("pdf");
  });
  it("detects Word documents", () => {
    expect(getFileCategory("file.doc")).toBe("word");
    expect(getFileCategory("file.docx")).toBe("word");
    expect(getFileCategory("file.odt")).toBe("word");
    expect(getFileCategory("file.rtf")).toBe("word");
  });
  it("detects Excel documents", () => {
    expect(getFileCategory("file.xlsx")).toBe("excel");
    expect(getFileCategory("file.xls")).toBe("excel");
    expect(getFileCategory("data.csv")).toBe("excel");
    expect(getFileCategory("file.ods")).toBe("excel");
  });
  it("detects PowerPoint", () => {
    expect(getFileCategory("file.pptx")).toBe("ppt");
    expect(getFileCategory("file.ppt")).toBe("ppt");
    expect(getFileCategory("file.odp")).toBe("ppt");
  });
  it("detects images", () => {
    expect(getFileCategory("photo.jpg")).toBe("image");
    expect(getFileCategory("photo.jpeg")).toBe("image");
    expect(getFileCategory("icon.png")).toBe("image");
    expect(getFileCategory("anim.gif")).toBe("image");
    expect(getFileCategory("image.webp")).toBe("image");
    expect(getFileCategory("icon.svg")).toBe("image");
    expect(getFileCategory("photo.heic")).toBe("image");
  });
  it("detects text files", () => {
    expect(getFileCategory("readme.txt")).toBe("text");
    expect(getFileCategory("README.md")).toBe("text");
  });
  it("detects code files", () => {
    expect(getFileCategory("app.js")).toBe("code");
    expect(getFileCategory("app.ts")).toBe("code");
    expect(getFileCategory("app.tsx")).toBe("code");
    expect(getFileCategory("main.py")).toBe("code");
    expect(getFileCategory("main.go")).toBe("code");
    expect(getFileCategory("main.rs")).toBe("code");
    expect(getFileCategory("style.css")).toBe("code");
    expect(getFileCategory("data.json")).toBe("code");
    expect(getFileCategory("config.yaml")).toBe("code");
    expect(getFileCategory("query.sql")).toBe("code");
  });
  it("detects archives", () => {
    expect(getFileCategory("file.zip")).toBe("archive");
    expect(getFileCategory("file.rar")).toBe("archive");
    expect(getFileCategory("file.tar")).toBe("archive");
    expect(getFileCategory("file.gz")).toBe("archive");
  });
  it("returns unknown for unrecognized extensions", () => {
    expect(getFileCategory("file.xyz")).toBe("unknown");
    expect(getFileCategory("noextension")).toBe("unknown");
  });
  it("falls back to MIME type", () => {
    expect(getFileCategory(undefined, "application/pdf")).toBe("pdf");
    expect(getFileCategory(undefined, "image/jpeg")).toBe("image");
    expect(getFileCategory(undefined, "text/csv")).toBe("excel");
    expect(getFileCategory(undefined, "application/json")).toBe("code");
    expect(getFileCategory(undefined, "application/zip")).toBe("archive");
  });
  it("handles generic MIME types", () => {
    expect(getFileCategory(undefined, "image/x-custom")).toBe("image");
    expect(getFileCategory(undefined, "text/x-custom")).toBe("text");
  });
  it("returns unknown when no info available", () => {
    expect(getFileCategory()).toBe("unknown");
    expect(getFileCategory(undefined, undefined)).toBe("unknown");
  });
});

describe("getFileTheme", () => {
  it("returns theme for known file", () => {
    const theme = getFileTheme("file.pdf");
    expect(theme.category).toBe("pdf");
    expect(theme.icon).toBe("PDF");
    expect(theme.bgColor).toBeTruthy();
  });
  it("returns unknown theme for unrecognized file", () => {
    const theme = getFileTheme("file.xyz");
    expect(theme.category).toBe("unknown");
  });
});

describe("getFileThemeByCategory", () => {
  it("returns theme for each category", () => {
    const categories = ["pdf", "word", "excel", "ppt", "image", "text", "code", "archive", "unknown"] as const;
    for (const cat of categories) {
      const theme = getFileThemeByCategory(cat);
      expect(theme.category).toBe(cat);
      expect(theme.bgColor).toBeTruthy();
      expect(theme.textColor).toBeTruthy();
      expect(theme.icon).toBeTruthy();
      expect(theme.label).toBeTruthy();
    }
  });
});

describe("fileThemes", () => {
  it("has all categories defined", () => {
    expect(Object.keys(fileThemes)).toHaveLength(10);
    expect(fileThemes.pdf).toBeDefined();
    expect(fileThemes.unknown).toBeDefined();
  });
});
