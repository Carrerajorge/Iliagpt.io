import mammoth from "mammoth";
import type {
  DocumentSemanticModel,
  Table,
  TableCell,
  Section,
  SourceReference,
} from "../../../shared/schemas/documentSemanticModel";
import { sanitizePlainText } from "../../lib/textSanitizers";

const DOCX_MAGIC_BYTES = [0x50, 0x4b, 0x03, 0x04];

function detectMimeType(buffer: Buffer): string {
  if (buffer.length >= 4) {
    const isDocx = DOCX_MAGIC_BYTES.every((byte, i) => buffer[i] === byte);
    if (isDocx) {
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
  }
  return "application/octet-stream";
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function countWords(text: string): number {
  const cleaned = sanitizePlainText(text, { maxLen: 5_000_000, collapseWs: true });
  if (!cleaned) return 0;
  // `sanitizePlainText` collapses whitespace to single spaces when enabled.
  return cleaned.split(" ").filter((word) => word.length > 0).length;
}

function extractTextContent(html: string): string {
  return sanitizePlainText(html, { maxLen: 5_000_000, collapseWs: true });
}

interface ParsedElement {
  type: "heading" | "paragraph" | "list" | "table";
  level?: number;
  content?: string;
  style?: string;
  listItems?: string[];
  listType?: "ordered" | "unordered";
  tableData?: {
    headers: string[];
    rows: string[][];
  };
}

function parseHtmlToElements(html: string): ParsedElement[] {
  const elements: ParsedElement[] = [];
  
  const tagRegex = /<(h[1-6]|p|ul|ol|table)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  
  while ((match = tagRegex.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    const content = match[2];
    
    if (tagName.startsWith("h") && tagName.length === 2) {
      const level = parseInt(tagName[1], 10);
      elements.push({
        type: "heading",
        level,
        content: extractTextContent(content),
      });
    } else if (tagName === "p") {
      const text = extractTextContent(content);
      if (text.trim()) {
        elements.push({
          type: "paragraph",
          content: text,
        });
      }
    } else if (tagName === "ul" || tagName === "ol") {
      const listItems: string[] = [];
      const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch;
      while ((liMatch = liRegex.exec(content)) !== null) {
        const itemText = extractTextContent(liMatch[1]);
        if (itemText.trim()) {
          listItems.push(itemText);
        }
      }
      if (listItems.length > 0) {
        elements.push({
          type: "list",
          listItems,
          listType: tagName === "ol" ? "ordered" : "unordered",
        });
      }
    } else if (tagName === "table") {
      const tableData = parseTable(content);
      if (tableData.headers.length > 0 || tableData.rows.length > 0) {
        elements.push({
          type: "table",
          tableData,
        });
      }
    }
  }
  
  return elements;
}

function parseTable(tableHtml: string): { headers: string[]; rows: string[][] } {
  const headers: string[] = [];
  const rows: string[][] = [];
  
  const theadMatch = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  if (theadMatch) {
    const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    let thMatch;
    while ((thMatch = thRegex.exec(theadMatch[1])) !== null) {
      headers.push(extractTextContent(thMatch[1]));
    }
  }
  
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  let isFirstRow = true;
  
  while ((trMatch = trRegex.exec(tableHtml)) !== null) {
    const rowContent = trMatch[1];
    
    if (rowContent.includes("<th") && headers.length === 0) {
      const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
      let thMatch;
      while ((thMatch = thRegex.exec(rowContent)) !== null) {
        headers.push(extractTextContent(thMatch[1]));
      }
      continue;
    }
    
    const cells: string[] = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowContent)) !== null) {
      cells.push(extractTextContent(tdMatch[1]));
    }
    
    if (cells.length > 0) {
      if (headers.length === 0 && isFirstRow) {
        headers.push(...cells);
      } else {
        rows.push(cells);
      }
    }
    
    isFirstRow = false;
  }
  
  return { headers, rows };
}

function detectCellType(value: string): TableCell["type"] {
  if (!value || value.trim() === "") {
    return "empty";
  }
  
  const trimmed = value.trim();
  
  if (trimmed.toLowerCase() === "true" || trimmed.toLowerCase() === "false") {
    return "boolean";
  }
  
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed) || /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(trimmed)) {
    return "date";
  }
  
  const cleanNum = trimmed.replace(/,/g, "").replace(/[%$€£¥]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(cleanNum)) {
    return "number";
  }
  
  return "text";
}

function parseValue(value: string): string | number | boolean | null {
  const trimmed = value.trim();
  
  if (trimmed === "" || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "n/a") {
    return null;
  }
  
  if (trimmed.toLowerCase() === "true") return true;
  if (trimmed.toLowerCase() === "false") return false;
  
  const cleanNum = trimmed.replace(/,/g, "").replace(/[%$€£¥]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(cleanNum)) {
    return parseFloat(cleanNum);
  }
  
  return trimmed;
}

export async function extractWord(
  buffer: Buffer,
  fileName: string
): Promise<Partial<DocumentSemanticModel>> {
  const startTime = Date.now();
  const detectedMime = detectMimeType(buffer);
  
  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value;
  const warnings = result.messages.map((m) => m.message);
  
  const parsedElements = parseHtmlToElements(html);
  
  const sections: Section[] = [];
  const tables: Table[] = [];
  const sources: SourceReference[] = [];
  
  let sectionIndex = 0;
  let paragraphIndex = 0;
  let listIndex = 0;
  let tableIndex = 0;
  
  const documentSourceId = generateId();
  sources.push({
    id: documentSourceId,
    type: "page",
    location: fileName,
    pageNumber: 1,
    previewText: extractTextContent(html).substring(0, 200),
  });
  
  for (const element of parsedElements) {
    if (element.type === "heading") {
      sectionIndex++;
      const sourceRef = `section:${sectionIndex}`;
      const sourceId = generateId();
      
      sources.push({
        id: sourceId,
        type: "section",
        location: `${fileName}#section-${sectionIndex}`,
        previewText: element.content?.substring(0, 100),
      });
      
      sections.push({
        id: generateId(),
        type: "heading",
        level: element.level,
        title: element.content,
        content: element.content,
        sourceRef,
      });
    } else if (element.type === "paragraph") {
      paragraphIndex++;
      const sourceRef = `para:${paragraphIndex}`;
      
      sections.push({
        id: generateId(),
        type: "paragraph",
        content: element.content,
        sourceRef,
      });
    } else if (element.type === "list") {
      listIndex++;
      const sourceRef = `list:${listIndex}`;
      
      sections.push({
        id: generateId(),
        type: "list",
        content: element.listItems?.join("; "),
        listItems: element.listItems,
        sourceRef,
        style: element.listType,
      });
    } else if (element.type === "table" && element.tableData) {
      tableIndex++;
      const sourceRef = `table:${tableIndex}`;
      const tableId = generateId();
      const { headers, rows } = element.tableData;
      
      const tableSourceId = generateId();
      sources.push({
        id: tableSourceId,
        type: "range",
        location: `${fileName}#table-${tableIndex}`,
        previewText: headers.join(", ").substring(0, 100),
      });
      
      const columnTypes: Array<"text" | "number" | "date" | "boolean" | "mixed"> = [];
      for (let col = 0; col < headers.length; col++) {
        const columnValues = rows.map((row) => row[col] || "");
        const types = new Set<string>();
        for (const value of columnValues) {
          const cellType = detectCellType(value);
          if (cellType !== "empty") {
            types.add(cellType);
          }
        }
        if (types.size === 0) {
          columnTypes.push("text");
        } else if (types.size === 1) {
          columnTypes.push(Array.from(types)[0] as "text" | "number" | "date" | "boolean");
        } else {
          columnTypes.push("mixed");
        }
      }
      
      const headerRow: TableCell[] = headers.map((h) => ({
        value: h,
        type: "text" as const,
      }));
      
      const tableRows: TableCell[][] = [headerRow];
      for (const row of rows) {
        const tableRow: TableCell[] = [];
        for (let col = 0; col < headers.length; col++) {
          const cellValue = row[col] || "";
          const parsed = parseValue(cellValue);
          tableRow.push({
            value: parsed,
            type: detectCellType(cellValue),
          });
        }
        tableRows.push(tableRow);
      }
      
      tables.push({
        id: tableId,
        title: `Table ${tableIndex}`,
        sourceRef: tableSourceId,
        headers,
        columnTypes,
        rows: tableRows,
        rowCount: tableRows.length,
        columnCount: headers.length,
        previewRows: tableRows.slice(0, 10),
      });
      
      sections.push({
        id: generateId(),
        type: "table",
        title: `Table ${tableIndex}`,
        sourceRef,
        tableRef: tableId,
      });
    }
  }
  
  const fullText = extractTextContent(html);
  const wordCount = countWords(html);
  
  const durationMs = Date.now() - startTime;
  
  return {
    documentMeta: {
      id: generateId(),
      fileName,
      fileSize: buffer.length,
      mimeType: detectedMime,
      documentType: "word",
      wordCount,
    },
    sections,
    tables,
    metrics: [],
    anomalies: [],
    insights: [],
    sources,
    suggestedQuestions: [],
    extractionDiagnostics: {
      extractedAt: new Date().toISOString(),
      durationMs,
      parserUsed: "wordExtractor",
      mimeTypeDetected: detectedMime,
      bytesProcessed: buffer.length,
      chunksGenerated: sections.length,
      warnings: warnings.length > 0 ? warnings : undefined,
    },
  };
}
