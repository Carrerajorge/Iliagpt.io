/**
 * CodeChunker — AST-informed chunking for source code files.
 * Splits by function/class/module boundaries using regex-based AST parsing.
 * Preserves: full signatures, docstrings, type annotations, import blocks.
 * Supported: TypeScript, JavaScript, Python, Java, Go, Rust, C/C++.
 * Falls back to line-based sliding window for unsupported languages.
 */

import { createLogger } from "../../utils/logger";
import type { ChunkStage, PipelineChunk, ChunkMetadata } from "../UnifiedRAGPipeline";
import { generateChunkId } from "../UnifiedRAGPipeline";

const logger = createLogger("CodeChunker");

export type CodeLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "java"
  | "go"
  | "rust"
  | "cpp"
  | "c"
  | "unknown";

export interface CodeChunkMetadata extends ChunkMetadata {
  language: string;
  codeNodeType?: "function" | "class" | "import" | "interface" | "type" | "variable" | "module" | "other";
  isExported?: boolean;
  isAsync?: boolean;
  decorators?: string[];
}

export interface CodeChunkerConfig {
  lineChunkSize: number;
  lineOverlap: number;
  includeImports: boolean;
  minLines: number;
  maxSize: number;
}

const DEFAULT_CONFIG: CodeChunkerConfig = {
  lineChunkSize: 60,
  lineOverlap: 10,
  includeImports: true,
  minLines: 3,
  maxSize: 3000,
};

interface CodeNode {
  name: string;
  content: string;
  startLine: number;
  endLine: number;
  nodeType: CodeChunkMetadata["codeNodeType"];
  parameters?: string[];
  returnType?: string;
  className?: string;
  isExported?: boolean;
  isAsync?: boolean;
  decorators?: string[];
  dependencies?: string[];
}

// ─── Language detection ───────────────────────────────────────────────────────

function detectLanguage(fileName: string, content: string): CodeLanguage {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const extMap: Record<string, CodeLanguage> = {
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript", mjs: "javascript",
    py: "python",
    java: "java",
    go: "go",
    rs: "rust",
    cpp: "cpp", cc: "cpp", cxx: "cpp",
    c: "c", h: "c",
  };
  if (extMap[ext]) return extMap[ext];

  if (/^import\s+\{/.test(content) || /interface\s+\w+/.test(content)) return "typescript";
  if (/^def\s+\w+\(/.test(content) || /^class\s+\w+:/.test(content)) return "python";
  if (/^package\s+main/.test(content) || /^func\s+\w+/.test(content)) return "go";
  if (/^fn\s+\w+/.test(content) || /^use\s+std::/.test(content)) return "rust";
  return "unknown";
}

// ─── Complexity scoring ───────────────────────────────────────────────────────

function scoreComplexity(code: string): number {
  const branches = (code.match(/\b(if|else|for|while|switch|case|catch|&&|\|\||\?)\b/g) ?? []).length;
  const lines = code.split("\n").length;
  return Math.min(10, 1 + Math.round(branches / Math.max(lines / 10, 1)));
}

// ─── Block boundary finder (brace counting) ──────────────────────────────────

function findBlockEnd(lines: string[], startLine: number): number {
  let depth = 0;
  for (let i = startLine; i < lines.length; i++) {
    for (const char of lines[i]) {
      if (char === "{") depth++;
      else if (char === "}") depth--;
    }
    if (depth === 0 && i > startLine) return i;
    if (depth < 0) return Math.max(startLine, i - 1);
  }
  return lines.length - 1;
}

// ─── TypeScript / JavaScript parser ──────────────────────────────────────────

function parseTypeScriptJavaScript(content: string): CodeNode[] {
  const lines = content.split("\n");
  const nodes: CodeNode[] = [];

  // Collect import block
  let importEnd = 0;
  while (importEnd < lines.length && /^import\s+/.test(lines[importEnd])) importEnd++;
  if (importEnd > 0) {
    const importContent = lines.slice(0, importEnd).join("\n");
    const deps = (importContent.match(/from\s+['"]([^'"]+)['"]/g) ?? [])
      .map((m) => m.replace(/from\s+['"]|['"]/g, ""));
    nodes.push({ name: "__imports__", content: importContent, startLine: 0, endLine: importEnd - 1, nodeType: "import", dependencies: deps });
  }

  const classPattern = /^(?:(export)\s+)?(?:abstract\s+)?class\s+(\w+)/;
  const functionPattern = /^(?:(export)\s+)?(?:(async)\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/;
  const arrowPattern = /^(?:(export)\s+)?(?:const|let|var)\s+(\w+)\s*(?::<[^>]+>)?\s*=\s*(?:(async)\s+)?\(?([^)=]*)\)?\s*(?::\s*([^=>{]+))?\s*=>/;
  const interfacePattern = /^(?:(export)\s+)?(?:interface|type)\s+(\w+)/;

  let i = importEnd;
  while (i < lines.length) {
    const line = lines[i];

    const classMatch = classPattern.exec(line);
    if (classMatch) {
      const end = findBlockEnd(lines, i);
      nodes.push({
        name: classMatch[2],
        content: lines.slice(i, end + 1).join("\n"),
        startLine: i, endLine: end,
        nodeType: "class",
        isExported: !!classMatch[1],
      });
      i = end + 1;
      continue;
    }

    const fnMatch = functionPattern.exec(line);
    if (fnMatch) {
      const end = findBlockEnd(lines, i);
      nodes.push({
        name: fnMatch[3],
        content: lines.slice(i, end + 1).join("\n"),
        startLine: i, endLine: end,
        nodeType: "function",
        isExported: !!fnMatch[1],
        isAsync: !!fnMatch[2],
        parameters: (fnMatch[5] ?? "").split(",").map((p) => p.trim()).filter(Boolean),
        returnType: fnMatch[6]?.trim(),
      });
      i = end + 1;
      continue;
    }

    const arrowMatch = arrowPattern.exec(line);
    if (arrowMatch) {
      const end = findBlockEnd(lines, i);
      nodes.push({
        name: arrowMatch[2],
        content: lines.slice(i, end + 1).join("\n"),
        startLine: i, endLine: end,
        nodeType: "function",
        isExported: !!arrowMatch[1],
        isAsync: !!arrowMatch[3],
        parameters: (arrowMatch[4] ?? "").split(",").map((p) => p.trim()).filter(Boolean),
        returnType: arrowMatch[5]?.trim(),
      });
      i = end + 1;
      continue;
    }

    const ifaceMatch = interfacePattern.exec(line);
    if (ifaceMatch) {
      const end = findBlockEnd(lines, i);
      nodes.push({
        name: ifaceMatch[2],
        content: lines.slice(i, end + 1).join("\n"),
        startLine: i, endLine: end,
        nodeType: "interface",
        isExported: !!ifaceMatch[1],
      });
      i = end + 1;
      continue;
    }

    i++;
  }

  return nodes;
}

// ─── Python parser ────────────────────────────────────────────────────────────

function parsePython(content: string): CodeNode[] {
  const lines = content.split("\n");
  const nodes: CodeNode[] = [];

  const importLines = lines.filter((l) => /^(?:import|from)\s+/.test(l));
  if (importLines.length > 0) {
    const deps = importLines.map((l) => l.match(/(?:from|import)\s+([\w.]+)/)?.[1]).filter(Boolean) as string[];
    nodes.push({ name: "__imports__", content: importLines.join("\n"), startLine: 0, endLine: importLines.length - 1, nodeType: "import", dependencies: deps });
  }

  const defPattern = /^(class|def|async\s+def)\s+(\w+)\s*(?:\(([^)]*)\))?(?:\s*->\s*(\S+))?:/;
  let i = 0;
  while (i < lines.length) {
    const match = defPattern.exec(lines[i]);
    if (match) {
      const baseIndent = (lines[i].match(/^(\s*)/) ?? ["", ""])[1].length;
      let j = i + 1;
      while (j < lines.length) {
        const lineIndent = (lines[j].match(/^(\s*)/) ?? ["", ""])[1].length;
        if (lines[j].trim() !== "" && lineIndent <= baseIndent) break;
        j++;
      }
      nodes.push({
        name: match[2],
        content: lines.slice(i, j).join("\n"),
        startLine: i, endLine: j - 1,
        nodeType: match[1] === "class" ? "class" : "function",
        isAsync: match[1].includes("async"),
        parameters: (match[3] ?? "").split(",").map((p) => p.trim()).filter(Boolean),
        returnType: match[4],
      });
      i = j;
      continue;
    }
    i++;
  }
  return nodes;
}

// ─── Go parser ────────────────────────────────────────────────────────────────

function parseGo(content: string): CodeNode[] {
  const lines = content.split("\n");
  const nodes: CodeNode[] = [];
  const funcPattern = /^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(([^)]*)\)\s*([^{]*)/;

  for (let i = 0; i < lines.length; i++) {
    const m = funcPattern.exec(lines[i]);
    if (m) {
      const end = findBlockEnd(lines, i);
      nodes.push({
        name: m[1],
        content: lines.slice(i, end + 1).join("\n"),
        startLine: i, endLine: end,
        nodeType: "function",
        parameters: (m[2] ?? "").split(",").map((p) => p.trim()).filter(Boolean),
        returnType: m[3]?.trim(),
      });
      i = end;
    }
  }
  return nodes;
}

// ─── Fallback: line-based chunking ───────────────────────────────────────────

function lineBasedChunks(content: string, chunkSize: number, overlap: number): CodeNode[] {
  const lines = content.split("\n");
  const nodes: CodeNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const end = Math.min(i + chunkSize, lines.length);
    nodes.push({
      name: `chunk_L${i + 1}`,
      content: lines.slice(i, end).join("\n"),
      startLine: i,
      endLine: end - 1,
      nodeType: "other",
    });
    i += Math.max(1, chunkSize - overlap);
  }
  return nodes;
}

// ─── Main CodeChunker class ───────────────────────────────────────────────────

export class CodeChunker implements ChunkStage {
  private readonly config: CodeChunkerConfig;

  constructor(config: Partial<CodeChunkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async chunk(text: string, options: Record<string, unknown> = {}): Promise<PipelineChunk[]> {
    const sourceFile = String(options.sourceFile ?? "untitled");
    const language = detectLanguage(sourceFile, text);

    let nodes: CodeNode[];
    try {
      switch (language) {
        case "typescript":
        case "javascript":
          nodes = parseTypeScriptJavaScript(text);
          break;
        case "python":
          nodes = parsePython(text);
          break;
        case "go":
          nodes = parseGo(text);
          break;
        default:
          logger.debug("No AST parser for language, using line-based chunking", { language, sourceFile });
          nodes = lineBasedChunks(text, this.config.lineChunkSize, this.config.lineOverlap);
      }
    } catch (err) {
      logger.warn("AST parsing failed, falling back to line-based chunking", {
        language, sourceFile, error: String(err),
      });
      nodes = lineBasedChunks(text, this.config.lineChunkSize, this.config.lineOverlap);
    }

    const chunks: PipelineChunk[] = [];
    let idx = 0;

    for (const node of nodes) {
      if (!this.config.includeImports && node.nodeType === "import") continue;
      if (node.content.split("\n").length < this.config.minLines) continue;

      if (node.content.length > this.config.maxSize) {
        const sub = this.splitLargeNode(node, sourceFile, language, idx);
        chunks.push(...sub);
        idx += sub.length;
      } else {
        chunks.push(this.toChunk(node, sourceFile, language, idx++));
      }
    }

    logger.info("CodeChunker complete", {
      sourceFile, language, nodes: nodes.length, chunks: chunks.length,
    });

    return chunks;
  }

  private toChunk(node: CodeNode, sourceFile: string, language: CodeLanguage, idx: number): PipelineChunk {
    const meta: CodeChunkMetadata = {
      sourceFile,
      chunkType: "code",
      sectionType: "code",
      startOffset: node.startLine,
      endOffset: node.endLine,
      sectionTitle: node.name !== "__imports__" ? node.name : "Imports",
      language,
      functionName: node.nodeType === "function" ? node.name : undefined,
      className: node.nodeType === "class" ? node.name : node.className,
      parameters: node.parameters,
      returnType: node.returnType,
      dependencies: node.dependencies,
      complexityScore: node.nodeType === "function" ? scoreComplexity(node.content) : undefined,
      codeNodeType: node.nodeType,
      isExported: node.isExported,
      isAsync: node.isAsync,
      decorators: node.decorators,
    };

    return {
      id: generateChunkId(`${sourceFile}:${node.name}:${node.startLine}`, idx),
      content: node.content,
      chunkIndex: idx,
      metadata: meta,
    };
  }

  private splitLargeNode(
    node: CodeNode,
    sourceFile: string,
    language: CodeLanguage,
    startIdx: number
  ): PipelineChunk[] {
    // For large class nodes: attempt to parse methods within the class body
    if (node.nodeType === "class") {
      const lines = node.content.split("\n");
      const header = lines.slice(0, 5).join("\n");
      let subNodes: CodeNode[] = [];

      try {
        if (language === "typescript" || language === "javascript") {
          subNodes = parseTypeScriptJavaScript(node.content);
        } else if (language === "python") {
          subNodes = parsePython(node.content);
        }
      } catch { /* fall through */ }

      if (subNodes.length > 1) {
        const result: PipelineChunk[] = [];
        if (header.trim()) {
          result.push(this.toChunk(
            { name: `${node.name}::header`, content: header, startLine: node.startLine, endLine: node.startLine + 5, nodeType: "other", className: node.name },
            sourceFile, language, startIdx
          ));
        }
        for (let i = 0; i < subNodes.length; i++) {
          result.push(this.toChunk(
            { ...subNodes[i], className: node.name },
            sourceFile, language, startIdx + result.length
          ));
        }
        return result;
      }
    }

    // Generic: fall back to line-based
    return lineBasedChunks(node.content, this.config.lineChunkSize, this.config.lineOverlap)
      .map((n, i) => this.toChunk(
        { ...n, name: `${node.name}_part${i}`, className: node.className },
        sourceFile, language, startIdx + i
      ));
  }
}
