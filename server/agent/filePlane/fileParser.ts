export interface ParsedContent {
  format: string;
  content: string;
  structured?: any;
  lineCount: number;
  metadata: Record<string, any>;
}

export interface RAGChunk {
  id: string;
  content: string;
  startLine: number;
  endLine: number;
  charOffset: number;
  charLength: number;
  filePath: string;
}

const BINARY_EXTENSIONS = new Set([
  ".exe", ".dll", ".so", ".dylib", ".bin", ".obj",
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".tiff",
  ".mp3", ".mp4", ".avi", ".mov", ".wav", ".flac", ".ogg",
  ".zip", ".gz", ".tar", ".rar", ".7z", ".bz2",
  ".pdf", ".doc", ".xls", ".ppt",
  ".xlsx", ".docx", ".pptx",
  ".woff", ".woff2", ".ttf", ".eot",
  ".sqlite", ".db",
]);

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 200;

function isBinaryExtension(filePath: string): boolean {
  const ext = filePath.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
  return BINARY_EXTENSIONS.has(ext);
}

function isBinaryContent(content: string): boolean {
  const sample = content.substring(0, 512);
  let nullCount = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code === 0) nullCount++;
    if (code < 8 && code !== 0) return true;
  }
  return nullCount > sample.length * 0.1;
}

function parseText(content: string, filePath: string): ParsedContent {
  const lines = content.split("\n");
  const numbered = lines.map((line, i) => `${i + 1} | ${line}`).join("\n");
  return {
    format: "text",
    content: numbered,
    lineCount: lines.length,
    metadata: { filePath, encoding: "utf-8" },
  };
}

function parseMarkdown(content: string, filePath: string): ParsedContent {
  const lines = content.split("\n");
  const headings = lines
    .map((line, i) => ({ line: i + 1, text: line }))
    .filter((l) => l.text.startsWith("#"));
  const numbered = lines.map((line, i) => `${i + 1} | ${line}`).join("\n");
  return {
    format: "markdown",
    content: numbered,
    structured: { headings },
    lineCount: lines.length,
    metadata: { filePath, headingCount: headings.length },
  };
}

function parseCSV(content: string, filePath: string): ParsedContent {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { format: "csv", content: "", lineCount: 0, metadata: { filePath, rows: 0, columns: 0 } };
  }
  const detectDelimiter = (line: string): string => {
    const counts: Record<string, number> = { ",": 0, "\t": 0, ";": 0, "|": 0 };
    for (const char of line) {
      if (char in counts) counts[char]++;
    }
    let best = ",";
    let bestCount = 0;
    for (const [d, c] of Object.entries(counts)) {
      if (c > bestCount) { best = d; bestCount = c; }
    }
    return best;
  };
  const delimiter = detectDelimiter(lines[0]);
  const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map((line) => {
    const values = line.split(delimiter).map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] || ""; });
    return row;
  });
  return {
    format: "csv",
    content: content,
    structured: { headers, rows: rows.slice(0, 1000), totalRows: rows.length },
    lineCount: lines.length,
    metadata: { filePath, rows: rows.length, columns: headers.length, delimiter },
  };
}

function parseJSON(content: string, filePath: string): ParsedContent {
  try {
    const parsed = JSON.parse(content);
    const pretty = JSON.stringify(parsed, null, 2);
    const lineCount = pretty.split("\n").length;
    return {
      format: "json",
      content: pretty,
      structured: parsed,
      lineCount,
      metadata: {
        filePath,
        type: Array.isArray(parsed) ? "array" : typeof parsed,
        ...(Array.isArray(parsed) ? { length: parsed.length } : {}),
      },
    };
  } catch (err: any) {
    return {
      format: "json",
      content,
      lineCount: content.split("\n").length,
      metadata: { filePath, parseError: err.message },
    };
  }
}

function parseHTML(content: string, filePath: string): ParsedContent {
  const stripped = content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const headings = Array.from(content.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)).map((m) => ({
    level: parseInt(m[1]),
    text: m[2].replace(/<[^>]+>/g, "").trim(),
  }));
  return {
    format: "html",
    content: stripped,
    structured: { title: titleMatch?.[1]?.trim(), headings },
    lineCount: stripped.split("\n").length,
    metadata: { filePath, originalLength: content.length, strippedLength: stripped.length },
  };
}

export function detectFormat(filePath: string): string {
  const ext = filePath.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
  const map: Record<string, string> = {
    ".md": "markdown",
    ".markdown": "markdown",
    ".csv": "csv",
    ".tsv": "csv",
    ".json": "json",
    ".jsonl": "json",
    ".html": "html",
    ".htm": "html",
    ".txt": "text",
    ".log": "text",
    ".cfg": "text",
    ".ini": "text",
    ".env": "text",
    ".yaml": "text",
    ".yml": "text",
    ".toml": "text",
    ".xml": "text",
    ".ts": "text",
    ".tsx": "text",
    ".js": "text",
    ".jsx": "text",
    ".py": "text",
    ".rb": "text",
    ".go": "text",
    ".rs": "text",
    ".java": "text",
    ".c": "text",
    ".cpp": "text",
    ".h": "text",
    ".css": "text",
    ".scss": "text",
    ".sql": "text",
    ".sh": "text",
    ".bash": "text",
    ".zsh": "text",
  };
  return map[ext] || "text";
}

export function parseFile(content: string, filePath: string): ParsedContent | { error: string } {
  if (isBinaryExtension(filePath)) {
    return { error: `Binary file detected (${filePath}). Cannot parse binary files. Use appropriate tools for this file type.` };
  }
  if (isBinaryContent(content)) {
    return { error: "Binary content detected. This file contains non-text data that cannot be parsed as text." };
  }
  const format = detectFormat(filePath);
  switch (format) {
    case "markdown":
      return parseMarkdown(content, filePath);
    case "csv":
      return parseCSV(content, filePath);
    case "json":
      return parseJSON(content, filePath);
    case "html":
      return parseHTML(content, filePath);
    default:
      return parseText(content, filePath);
  }
}

export function generateChunks(content: string, filePath: string): RAGChunk[] {
  const chunks: RAGChunk[] = [];
  const lines = content.split("\n");
  let charOffset = 0;
  let currentChunk = "";
  let chunkStartLine = 1;
  let chunkStartOffset = 0;
  let chunkIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentChunk += (currentChunk ? "\n" : "") + line;

    if (currentChunk.length >= CHUNK_SIZE || i === lines.length - 1) {
      chunks.push({
        id: `${filePath}:chunk_${chunkIndex}`,
        content: currentChunk,
        startLine: chunkStartLine,
        endLine: i + 1,
        charOffset: chunkStartOffset,
        charLength: currentChunk.length,
        filePath,
      });
      chunkIndex++;

      const overlapLines: string[] = [];
      let overlapLen = 0;
      for (let j = i; j >= chunkStartLine - 1 && overlapLen < CHUNK_OVERLAP; j--) {
        overlapLines.unshift(lines[j]);
        overlapLen += lines[j].length + 1;
      }
      if (i < lines.length - 1) {
        currentChunk = overlapLines.join("\n");
        chunkStartLine = i + 1 - overlapLines.length + 1;
        chunkStartOffset = charOffset + line.length + 1 - currentChunk.length;
      }
    }
    charOffset += line.length + 1;
  }

  return chunks;
}
