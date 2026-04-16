export interface DocumentParserInfo {
  mime_detect: string;
  parser_used: string;
}

export function getDocumentParserInfo(mimeType: string, filename: string): DocumentParserInfo {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const mime = (mimeType || "").toLowerCase();

  if (mime.includes("sheet") || mime.includes("excel") || ext === "xlsx" || ext === "xls") {
    return {
      mime_detect: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      parser_used: "XlsxParser",
    };
  }

  if (mime.includes("pdf") || ext === "pdf") {
    return { mime_detect: "application/pdf", parser_used: "PdfParser" };
  }

  if (mime.includes("word") || (mime.includes("document") && !mime.includes("sheet")) || ext === "docx" || ext === "doc") {
    return {
      mime_detect: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      parser_used: "DocxParser",
    };
  }

  if (mime.includes("presentation") || mime.includes("powerpoint") || ext === "pptx" || ext === "ppt") {
    return {
      mime_detect: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      parser_used: "PptxParser",
    };
  }

  if (mime.includes("csv") || ext === "csv") {
    return { mime_detect: "text/csv", parser_used: "CsvParser" };
  }

  if (mime.includes("text") || ext === "txt") {
    return { mime_detect: "text/plain", parser_used: "TextParser" };
  }

  return {
    mime_detect: mimeType || "application/octet-stream",
    parser_used: "TextParser",
  };
}
