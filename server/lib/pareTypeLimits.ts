import { DEFAULT_TYPE_LIMITS, type TypeLimits } from "./pareSchemas";

export interface ParsedMetadata {
  pageCount?: number;
  rowCount?: number;
  cellCount?: number;
  columnCount?: number;
  slideCount?: number;
  sheetCount?: number;
  lineCount?: number;
  sizeBytes?: number;
  depth?: number;
}

export interface TypeLimitViolation {
  type: string;
  metric: string;
  limit: number;
  actual: number;
  unit: string;
}

export interface TypeLimitCheckResult {
  passed: boolean;
  violation?: TypeLimitViolation;
  warnings?: TypeLimitViolation[];
}

type FileExtension = "pdf" | "xlsx" | "xls" | "csv" | "pptx" | "ppt" | "docx" | "doc" | "txt" | "json";

function getFileExtension(filename: string): FileExtension | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  
  const extensionMap: Record<string, FileExtension> = {
    pdf: "pdf",
    xlsx: "xlsx",
    xls: "xls",
    csv: "csv",
    pptx: "pptx",
    ppt: "ppt",
    docx: "docx",
    doc: "doc",
    txt: "txt",
    json: "json",
  };
  
  return extensionMap[ext] || null;
}

function getMimeTypeCategory(mimeType: string): FileExtension | null {
  const lower = mimeType.toLowerCase();
  
  if (lower.includes("pdf")) return "pdf";
  if (lower.includes("spreadsheet") || lower.includes("excel") || lower.includes("xlsx")) return "xlsx";
  if (lower.includes("csv") || lower === "text/csv") return "csv";
  if (lower.includes("presentation") || lower.includes("powerpoint") || lower.includes("pptx")) return "pptx";
  if (lower.includes("word") || lower.includes("document") || lower.includes("docx")) return "docx";
  if (lower.includes("text/plain")) return "txt";
  if (lower.includes("json")) return "json";
  
  return null;
}

export function checkTypeLimits(
  attachment: { name: string; mimeType?: string; size?: number },
  parsedMetadata: ParsedMetadata,
  limits: TypeLimits = DEFAULT_TYPE_LIMITS
): TypeLimitCheckResult {
  const extension = getFileExtension(attachment.name) || getMimeTypeCategory(attachment.mimeType || "");
  const warnings: TypeLimitViolation[] = [];
  
  if (!extension) {
    return { passed: true, warnings: [] };
  }
  
  const sizeBytes = parsedMetadata.sizeBytes || attachment.size || 0;
  
  switch (extension) {
    case "pdf": {
      const pdfLimits = limits.pdf;
      
      if (sizeBytes > pdfLimits.maxSizeBytes) {
        return {
          passed: false,
          violation: {
            type: "pdf",
            metric: "size",
            limit: pdfLimits.maxSizeBytes,
            actual: sizeBytes,
            unit: "bytes",
          },
        };
      }
      
      if (parsedMetadata.pageCount !== undefined && parsedMetadata.pageCount > pdfLimits.maxPages) {
        return {
          passed: false,
          violation: {
            type: "pdf",
            metric: "pages",
            limit: pdfLimits.maxPages,
            actual: parsedMetadata.pageCount,
            unit: "pages",
          },
        };
      }
      
      if (parsedMetadata.pageCount !== undefined && parsedMetadata.pageCount > pdfLimits.maxPages * 0.8) {
        warnings.push({
          type: "pdf",
          metric: "pages",
          limit: pdfLimits.maxPages,
          actual: parsedMetadata.pageCount,
          unit: "pages (approaching limit)",
        });
      }
      
      break;
    }
    
    case "xlsx":
    case "xls": {
      const xlsxLimits = limits.xlsx;
      
      if (sizeBytes > xlsxLimits.maxSizeBytes) {
        return {
          passed: false,
          violation: {
            type: "xlsx",
            metric: "size",
            limit: xlsxLimits.maxSizeBytes,
            actual: sizeBytes,
            unit: "bytes",
          },
        };
      }
      
      if (parsedMetadata.rowCount !== undefined && parsedMetadata.rowCount > xlsxLimits.maxRows) {
        return {
          passed: false,
          violation: {
            type: "xlsx",
            metric: "rows",
            limit: xlsxLimits.maxRows,
            actual: parsedMetadata.rowCount,
            unit: "rows",
          },
        };
      }
      
      if (parsedMetadata.cellCount !== undefined && parsedMetadata.cellCount > xlsxLimits.maxCells) {
        return {
          passed: false,
          violation: {
            type: "xlsx",
            metric: "cells",
            limit: xlsxLimits.maxCells,
            actual: parsedMetadata.cellCount,
            unit: "cells",
          },
        };
      }
      
      if (parsedMetadata.sheetCount !== undefined && parsedMetadata.sheetCount > xlsxLimits.maxSheets) {
        return {
          passed: false,
          violation: {
            type: "xlsx",
            metric: "sheets",
            limit: xlsxLimits.maxSheets,
            actual: parsedMetadata.sheetCount,
            unit: "sheets",
          },
        };
      }
      
      break;
    }
    
    case "csv": {
      const csvLimits = limits.csv;
      
      if (sizeBytes > csvLimits.maxSizeBytes) {
        return {
          passed: false,
          violation: {
            type: "csv",
            metric: "size",
            limit: csvLimits.maxSizeBytes,
            actual: sizeBytes,
            unit: "bytes",
          },
        };
      }
      
      if (parsedMetadata.rowCount !== undefined && parsedMetadata.rowCount > csvLimits.maxRows) {
        return {
          passed: false,
          violation: {
            type: "csv",
            metric: "rows",
            limit: csvLimits.maxRows,
            actual: parsedMetadata.rowCount,
            unit: "rows",
          },
        };
      }
      
      if (parsedMetadata.columnCount !== undefined && parsedMetadata.columnCount > csvLimits.maxColumns) {
        return {
          passed: false,
          violation: {
            type: "csv",
            metric: "columns",
            limit: csvLimits.maxColumns,
            actual: parsedMetadata.columnCount,
            unit: "columns",
          },
        };
      }
      
      break;
    }
    
    case "pptx":
    case "ppt": {
      const pptxLimits = limits.pptx;
      
      if (sizeBytes > pptxLimits.maxSizeBytes) {
        return {
          passed: false,
          violation: {
            type: "pptx",
            metric: "size",
            limit: pptxLimits.maxSizeBytes,
            actual: sizeBytes,
            unit: "bytes",
          },
        };
      }
      
      if (parsedMetadata.slideCount !== undefined && parsedMetadata.slideCount > pptxLimits.maxSlides) {
        return {
          passed: false,
          violation: {
            type: "pptx",
            metric: "slides",
            limit: pptxLimits.maxSlides,
            actual: parsedMetadata.slideCount,
            unit: "slides",
          },
        };
      }
      
      break;
    }
    
    case "docx":
    case "doc": {
      const docxLimits = limits.docx;
      
      if (sizeBytes > docxLimits.maxSizeBytes) {
        return {
          passed: false,
          violation: {
            type: "docx",
            metric: "size",
            limit: docxLimits.maxSizeBytes,
            actual: sizeBytes,
            unit: "bytes",
          },
        };
      }
      
      if (parsedMetadata.pageCount !== undefined && parsedMetadata.pageCount > docxLimits.maxPages) {
        return {
          passed: false,
          violation: {
            type: "docx",
            metric: "pages",
            limit: docxLimits.maxPages,
            actual: parsedMetadata.pageCount,
            unit: "pages",
          },
        };
      }
      
      break;
    }
    
    case "txt": {
      const txtLimits = limits.txt;
      
      if (sizeBytes > txtLimits.maxSizeBytes) {
        return {
          passed: false,
          violation: {
            type: "txt",
            metric: "size",
            limit: txtLimits.maxSizeBytes,
            actual: sizeBytes,
            unit: "bytes",
          },
        };
      }
      
      if (parsedMetadata.lineCount !== undefined && parsedMetadata.lineCount > txtLimits.maxLines) {
        return {
          passed: false,
          violation: {
            type: "txt",
            metric: "lines",
            limit: txtLimits.maxLines,
            actual: parsedMetadata.lineCount,
            unit: "lines",
          },
        };
      }
      
      break;
    }
    
    case "json": {
      const jsonLimits = limits.json;
      
      if (sizeBytes > jsonLimits.maxSizeBytes) {
        return {
          passed: false,
          violation: {
            type: "json",
            metric: "size",
            limit: jsonLimits.maxSizeBytes,
            actual: sizeBytes,
            unit: "bytes",
          },
        };
      }
      
      if (parsedMetadata.depth !== undefined && parsedMetadata.depth > jsonLimits.maxDepth) {
        return {
          passed: false,
          violation: {
            type: "json",
            metric: "depth",
            limit: jsonLimits.maxDepth,
            actual: parsedMetadata.depth,
            unit: "levels",
          },
        };
      }
      
      break;
    }
  }
  
  return { passed: true, warnings: warnings.length > 0 ? warnings : undefined };
}

export function estimateLimitsFromSize(
  attachment: { name: string; mimeType?: string; size?: number },
  limits: TypeLimits = DEFAULT_TYPE_LIMITS
): { wouldExceed: boolean; reason?: string } {
  const extension = getFileExtension(attachment.name) || getMimeTypeCategory(attachment.mimeType || "");
  const sizeBytes = attachment.size || 0;
  
  if (!extension || sizeBytes === 0) {
    return { wouldExceed: false };
  }
  
  switch (extension) {
    case "pdf": {
      const estimatedPages = Math.ceil(sizeBytes / 50000);
      if (estimatedPages > limits.pdf.maxPages * 1.5) {
        return {
          wouldExceed: true,
          reason: `PDF size suggests ~${estimatedPages} pages, which may exceed limit of ${limits.pdf.maxPages}`,
        };
      }
      break;
    }
    
    case "xlsx":
    case "xls": {
      const estimatedCells = Math.ceil(sizeBytes / 10);
      if (estimatedCells > limits.xlsx.maxCells * 1.5) {
        return {
          wouldExceed: true,
          reason: `Excel size suggests ~${estimatedCells} cells, which may exceed limit of ${limits.xlsx.maxCells}`,
        };
      }
      break;
    }
    
    case "csv": {
      const estimatedRows = Math.ceil(sizeBytes / 100);
      if (estimatedRows > limits.csv.maxRows * 1.5) {
        return {
          wouldExceed: true,
          reason: `CSV size suggests ~${estimatedRows} rows, which may exceed limit of ${limits.csv.maxRows}`,
        };
      }
      break;
    }
    
    case "pptx":
    case "ppt": {
      const estimatedSlides = Math.ceil(sizeBytes / 100000);
      if (estimatedSlides > limits.pptx.maxSlides * 1.5) {
        return {
          wouldExceed: true,
          reason: `PowerPoint size suggests ~${estimatedSlides} slides, which may exceed limit of ${limits.pptx.maxSlides}`,
        };
      }
      break;
    }
  }
  
  return { wouldExceed: false };
}

export function formatViolationMessage(violation: TypeLimitViolation): string {
  const formatSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${bytes} bytes`;
  };
  
  if (violation.unit === "bytes") {
    return `${violation.type.toUpperCase()} file exceeds maximum size: ${formatSize(violation.actual)} (limit: ${formatSize(violation.limit)})`;
  }
  
  return `${violation.type.toUpperCase()} file exceeds maximum ${violation.metric}: ${violation.actual.toLocaleString()} ${violation.unit} (limit: ${violation.limit.toLocaleString()})`;
}

export { TypeLimits, DEFAULT_TYPE_LIMITS };
