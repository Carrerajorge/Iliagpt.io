import { describe, expect, it } from "vitest";
import { getDocumentParserInfo } from "../documentParserInfo";

describe("getDocumentParserInfo", () => {
  it("classifies spreadsheet mime types before generic officedocument matches", () => {
    expect(
      getDocumentParserInfo(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ventas.xlsx",
      ),
    ).toEqual({
      mime_detect: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      parser_used: "XlsxParser",
    });
  });

  it("keeps word documents on the Docx parser", () => {
    expect(
      getDocumentParserInfo(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "informe.docx",
      ),
    ).toEqual({
      mime_detect: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      parser_used: "DocxParser",
    });
  });
});
