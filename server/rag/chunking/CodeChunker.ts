import { randomUUID } from 'crypto';
import { Logger } from '../../lib/logger';
import type { ChunkStage, ProcessedDocument, Chunk } from '../UnifiedRAGPipeline';

// ─── Language & node types ────────────────────────────────────────────────────

export type CodeLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'java'
  | 'go'
  | 'unknown';

export interface CodeNode {
  type: 'function' | 'class' | 'method' | 'interface' | 'type' | 'import_block' | 'module';
  name: string;
  startLine: number;
  endLine: number;
  content: string;
  docstring?: string;
  signature?: string;
  dependencies: string[];
  exported: boolean;
}

// ─── Configuration ────────────────────────────────────────────────────────────

export interface CodeChunkerConfig {
  maxChunkLines: number;
  includeDocstrings: boolean;
  includeSignatures: boolean;
  includeDependencies: boolean;
  minNodeLines: number;
}

const DEFAULT_CODE_CHUNKER_CONFIG: CodeChunkerConfig = {
  maxChunkLines: 80,
  includeDocstrings: true,
  includeSignatures: true,
  includeDependencies: true,
  minNodeLines: 3,
};

// ─── CodeChunker ──────────────────────────────────────────────────────────────

export class CodeChunker implements ChunkStage {
  private readonly _cfg: CodeChunkerConfig;

  constructor(config?: Partial<CodeChunkerConfig>) {
    this._cfg = { ...DEFAULT_CODE_CHUNKER_CONFIG, ...config };
  }

  // ── Public entry point ────────────────────────────────────────────────────

  async chunk(doc: ProcessedDocument): Promise<Chunk[]> {
    const source = doc.cleanedContent;
    const language = this._detectLanguage(doc);

    Logger.debug('CodeChunker.chunk start', { docId: doc.id, language });

    let nodes: CodeNode[] = [];
    switch (language) {
      case 'typescript':
      case 'javascript':
        nodes = this._parseTypeScript(source);
        break;
      case 'python':
        nodes = this._parsePython(source);
        break;
      case 'java':
        nodes = this._parseJava(source);
        break;
      case 'go':
        nodes = this._parseGo(source);
        break;
      default:
        // Unknown language: emit whole source as a single module chunk
        nodes = [
          {
            type: 'module',
            name: (doc.metadata?.filename as string) ?? 'unknown',
            startLine: 1,
            endLine: source.split('\n').length,
            content: source,
            dependencies: this._extractDependencies(source, 'unknown'),
            exported: false,
          },
        ];
    }

    // Expand nodes that exceed maxChunkLines
    const expandedNodes: CodeNode[] = [];
    for (const node of nodes) {
      const lineCount = node.endLine - node.startLine + 1;
      if (lineCount > this._cfg.maxChunkLines) {
        expandedNodes.push(...this._splitLargeNode(node, language));
      } else {
        expandedNodes.push(node);
      }
    }

    // Filter by minimum lines
    const finalNodes = expandedNodes.filter(
      (n) => n.endLine - n.startLine + 1 >= this._cfg.minNodeLines,
    );

    const chunks = finalNodes.map((node, idx) =>
      this._nodeToChunk(node, doc.id, idx, language),
    );

    Logger.debug('CodeChunker.chunk complete', {
      docId: doc.id,
      nodes: finalNodes.length,
      language,
    });

    return chunks;
  }

  // ── Language detection ────────────────────────────────────────────────────

  private _detectLanguage(doc: ProcessedDocument): CodeLanguage {
    const mimeMap: Record<string, CodeLanguage> = {
      'application/typescript': 'typescript',
      'text/typescript': 'typescript',
      'application/javascript': 'javascript',
      'text/javascript': 'javascript',
      'text/x-python': 'python',
      'application/x-python': 'python',
      'text/x-java': 'java',
      'text/x-java-source': 'java',
      'text/x-go': 'go',
    };

    if (mimeMap[doc.mimeType]) return mimeMap[doc.mimeType];

    const filename = doc.metadata?.filename as string | undefined;
    if (filename) {
      const ext = filename.split('.').pop()?.toLowerCase() ?? '';
      const extMap: Record<string, CodeLanguage> = {
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        mjs: 'javascript',
        cjs: 'javascript',
        py: 'python',
        java: 'java',
        go: 'go',
      };
      if (extMap[ext]) return extMap[ext];
    }

    // Heuristic sniff
    const src = doc.cleanedContent;
    if (/^\s*import\s+\{/.test(src) || /:\s*(string|number|boolean|void)\b/.test(src)) {
      return 'typescript';
    }
    if (/^\s*def\s+\w+\(|^\s*class\s+\w+:/m.test(src)) return 'python';
    if (/^\s*func\s+\w+\(|^\s*type\s+\w+\s+struct\b/m.test(src)) return 'go';
    if (/\bpublic\s+(static\s+)?class\b|\bpublic\s+\w+\s+\w+\s*\(/.test(src)) return 'java';

    return 'unknown';
  }

  // ── TypeScript / JavaScript parser ────────────────────────────────────────

  private _parseTypeScript(source: string): CodeNode[] {
    const lines = source.split('\n');
    const nodes: CodeNode[] = [];
    const deps = this._extractDependencies(source, 'typescript');

    // Collect import blocks (consecutive import lines)
    let importStart = -1;
    let importEnd = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (/^import\s/.test(line) || /^}\s*from\s+'/.test(line) || /^}\s*from\s+"/.test(line)) {
        if (importStart === -1) importStart = i;
        importEnd = i;
      } else if (importStart !== -1 && line !== '' && !/^\/\//.test(line)) {
        // End of import block
        nodes.push({
          type: 'import_block',
          name: 'imports',
          startLine: importStart + 1,
          endLine: importEnd + 1,
          content: lines.slice(importStart, importEnd + 1).join('\n'),
          dependencies: deps,
          exported: false,
        });
        importStart = -1;
        importEnd = -1;
      }
    }
    if (importStart !== -1) {
      nodes.push({
        type: 'import_block',
        name: 'imports',
        startLine: importStart + 1,
        endLine: importEnd + 1,
        content: lines.slice(importStart, importEnd + 1).join('\n'),
        dependencies: deps,
        exported: false,
      });
    }

    // Patterns for functions, classes, interfaces, types
    const patterns: Array<{
      regex: RegExp;
      nodeType: CodeNode['type'];
      nameGroup: number;
    }> = [
      {
        regex: /^(export\s+)?(default\s+)?(async\s+)?function\s+(\w+)\s*[(<]/,
        nodeType: 'function',
        nameGroup: 4,
      },
      {
        regex: /^(export\s+)?const\s+(\w+)\s*=\s*(async\s+)?\(/,
        nodeType: 'function',
        nameGroup: 2,
      },
      {
        regex: /^(export\s+)?const\s+(\w+)\s*=\s*(async\s+)?<[^>]*>\s*\(/,
        nodeType: 'function',
        nameGroup: 2,
      },
      {
        regex: /^(export\s+)?(abstract\s+)?class\s+(\w+)/,
        nodeType: 'class',
        nameGroup: 3,
      },
      {
        regex: /^(export\s+)?interface\s+(\w+)/,
        nodeType: 'interface',
        nameGroup: 2,
      },
      {
        regex: /^(export\s+)?type\s+(\w+)\s*[=<]/,
        nodeType: 'type',
        nameGroup: 2,
      },
    ];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      for (const { regex, nodeType, nameGroup } of patterns) {
        const match = trimmed.match(regex);
        if (!match) continue;

        const name = match[nameGroup] ?? 'anonymous';
        const isExported = /^export\s/.test(trimmed);

        // Extract preceding JSDoc comment
        let docstring: string | undefined;
        if (this._cfg.includeDocstrings) {
          docstring = this._extractJsDoc(lines, i);
        }

        // Find the end of the block by counting braces
        const endLine = this._findBlockEnd(lines, i);

        const signature = this._cfg.includeSignatures
          ? this._extractSignature(lines, i)
          : undefined;

        const content = lines.slice(i, endLine + 1).join('\n');

        nodes.push({
          type: nodeType,
          name,
          startLine: i + 1,
          endLine: endLine + 1,
          content,
          docstring,
          signature,
          dependencies: deps,
          exported: isExported,
        });

        // Skip to end of block
        i = endLine;
        break;
      }
    }

    return nodes;
  }

  // ── Python parser ─────────────────────────────────────────────────────────

  private _parsePython(source: string): CodeNode[] {
    const lines = source.split('\n');
    const nodes: CodeNode[] = [];
    const deps = this._extractDependencies(source, 'python');

    const defPattern = /^(\s*)(async\s+)?def\s+(\w+)\s*\(/;
    const classPattern = /^(\s*)class\s+(\w+)\s*[:(]/;

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const classMatch = line.match(classPattern);
      const defMatch = line.match(defPattern);

      if (classMatch) {
        const indent = classMatch[1].length;
        const name = classMatch[2];
        const endLine = this._findPythonBlockEnd(lines, i, indent);
        const content = lines.slice(i, endLine + 1).join('\n');
        const docstring = this._cfg.includeDocstrings
          ? this._extractPythonDocstring(lines, i + 1)
          : undefined;

        nodes.push({
          type: 'class',
          name,
          startLine: i + 1,
          endLine: endLine + 1,
          content,
          docstring,
          dependencies: deps,
          exported: true, // Python has no explicit export
        });
        i = endLine + 1;
        continue;
      }

      if (defMatch) {
        const indent = defMatch[1].length;
        const name = defMatch[3];
        const endLine = this._findPythonBlockEnd(lines, i, indent);
        const content = lines.slice(i, endLine + 1).join('\n');
        const signature = this._cfg.includeSignatures
          ? this._extractPythonSignature(lines, i)
          : undefined;
        const docstring = this._cfg.includeDocstrings
          ? this._extractPythonDocstring(lines, i + 1)
          : undefined;

        nodes.push({
          type: 'function',
          name,
          startLine: i + 1,
          endLine: endLine + 1,
          content,
          docstring,
          signature,
          dependencies: deps,
          exported: true,
        });
        i = endLine + 1;
        continue;
      }

      i++;
    }

    return nodes;
  }

  // ── Java parser ───────────────────────────────────────────────────────────

  private _parseJava(source: string): CodeNode[] {
    const lines = source.split('\n');
    const nodes: CodeNode[] = [];
    const deps = this._extractDependencies(source, 'java');

    const classPattern = /^(public|protected|private|abstract|final|\s)*class\s+(\w+)/;
    const interfacePattern = /^(public|protected|private|\s)*interface\s+(\w+)/;
    const methodPattern =
      /^[\s]*(public|protected|private|static|final|abstract|synchronized|\s)+([\w<>,\[\]]+)\s+(\w+)\s*\(/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      const classMatch = trimmed.match(classPattern);
      if (classMatch) {
        const name = classMatch[2];
        const endLine = this._findBlockEnd(lines, i);
        nodes.push({
          type: 'class',
          name,
          startLine: i + 1,
          endLine: endLine + 1,
          content: lines.slice(i, endLine + 1).join('\n'),
          dependencies: deps,
          exported: trimmed.startsWith('public'),
        });
        i = endLine;
        continue;
      }

      const ifaceMatch = trimmed.match(interfacePattern);
      if (ifaceMatch) {
        const name = ifaceMatch[2];
        const endLine = this._findBlockEnd(lines, i);
        nodes.push({
          type: 'interface',
          name,
          startLine: i + 1,
          endLine: endLine + 1,
          content: lines.slice(i, endLine + 1).join('\n'),
          dependencies: deps,
          exported: trimmed.startsWith('public'),
        });
        i = endLine;
        continue;
      }

      const methodMatch = trimmed.match(methodPattern);
      if (methodMatch && trimmed.includes('{')) {
        const name = methodMatch[3];
        const endLine = this._findBlockEnd(lines, i);
        const signature = this._cfg.includeSignatures ? trimmed.split('{')[0].trim() : undefined;
        nodes.push({
          type: 'method',
          name,
          startLine: i + 1,
          endLine: endLine + 1,
          content: lines.slice(i, endLine + 1).join('\n'),
          signature,
          dependencies: deps,
          exported: trimmed.includes('public'),
        });
        i = endLine;
        continue;
      }
    }

    return nodes;
  }

  // ── Go parser ─────────────────────────────────────────────────────────────

  private _parseGo(source: string): CodeNode[] {
    const lines = source.split('\n');
    const nodes: CodeNode[] = [];
    const deps = this._extractDependencies(source, 'go');

    // func (receiver) Name( or func Name(
    const funcPattern = /^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/;
    // type Name struct / type Name interface
    const typeStructPattern = /^type\s+(\w+)\s+(struct|interface)\s*\{/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      const funcMatch = trimmed.match(funcPattern);
      if (funcMatch) {
        const name = funcMatch[1];
        const endLine = this._findBlockEnd(lines, i);
        const signature = this._cfg.includeSignatures ? trimmed.replace(/\{.*$/, '').trim() : undefined;
        const isExported = /^[A-Z]/.test(name);
        nodes.push({
          type: 'function',
          name,
          startLine: i + 1,
          endLine: endLine + 1,
          content: lines.slice(i, endLine + 1).join('\n'),
          signature,
          dependencies: deps,
          exported: isExported,
        });
        i = endLine;
        continue;
      }

      const typeMatch = trimmed.match(typeStructPattern);
      if (typeMatch) {
        const name = typeMatch[1];
        const kind = typeMatch[2];
        const endLine = this._findBlockEnd(lines, i);
        const isExported = /^[A-Z]/.test(name);
        nodes.push({
          type: kind === 'interface' ? 'interface' : 'type',
          name,
          startLine: i + 1,
          endLine: endLine + 1,
          content: lines.slice(i, endLine + 1).join('\n'),
          dependencies: deps,
          exported: isExported,
        });
        i = endLine;
        continue;
      }
    }

    return nodes;
  }

  // ── Dependency extraction ─────────────────────────────────────────────────

  private _extractDependencies(source: string, language: CodeLanguage): string[] {
    const deps: string[] = [];

    if (language === 'typescript' || language === 'javascript') {
      // ES imports: import ... from 'path'
      const esImport = /import\s+[^'"]*?from\s+['"]([^'"]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = esImport.exec(source)) !== null) deps.push(m[1]);
      // require() calls
      const cjsRequire = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((m = cjsRequire.exec(source)) !== null) deps.push(m[1]);
    } else if (language === 'python') {
      // import x / from x import y
      const pyImport = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm;
      let m: RegExpExecArray | null;
      while ((m = pyImport.exec(source)) !== null) deps.push(m[1] ?? m[2]);
    } else if (language === 'java') {
      const javaImport = /^import\s+([\w.]+);/gm;
      let m: RegExpExecArray | null;
      while ((m = javaImport.exec(source)) !== null) deps.push(m[1]);
    } else if (language === 'go') {
      // import ( "pkg" ) or import "pkg"
      const goImport = /["']([^"']+)["']/g;
      const importBlock = source.match(/import\s*\([\s\S]*?\)|import\s+"[^"]+"/g) ?? [];
      for (const block of importBlock) {
        let m: RegExpExecArray | null;
        while ((m = goImport.exec(block)) !== null) deps.push(m[1]);
      }
    }

    return [...new Set(deps)];
  }

  // ── Node → Chunk conversion ───────────────────────────────────────────────

  private _nodeToChunk(
    node: CodeNode,
    docId: string,
    index: number,
    language: CodeLanguage,
  ): Chunk {
    let content = node.content;

    // Prepend docstring and signature as context header
    const headerParts: string[] = [];
    if (this._cfg.includeSignatures && node.signature) {
      headerParts.push(`// Signature: ${node.signature}`);
    }
    if (this._cfg.includeDocstrings && node.docstring) {
      headerParts.push(node.docstring);
    }
    if (headerParts.length > 0) {
      content = headerParts.join('\n') + '\n' + content;
    }

    const tokens = Math.ceil(content.split(/\s+/).filter(Boolean).length * 1.3);

    const metadata: Record<string, unknown> = {
      language,
      nodeType: node.type,
      nodeName: node.name,
      startLine: node.startLine,
      endLine: node.endLine,
      exported: node.exported,
    };

    if (this._cfg.includeSignatures && node.signature) {
      metadata['signature'] = node.signature;
    }
    if (this._cfg.includeDocstrings && node.docstring) {
      metadata['docstring'] = node.docstring;
    }
    if (this._cfg.includeDependencies) {
      metadata['dependencies'] = node.dependencies;
    }

    return {
      id: randomUUID(),
      documentId: docId,
      content,
      chunkIndex: index,
      metadata,
      tokens,
    };
  }

  // ── Split large node by blank lines ──────────────────────────────────────

  private _splitLargeNode(node: CodeNode, language: CodeLanguage): CodeNode[] {
    const lines = node.content.split('\n');
    const parts: CodeNode[] = [];
    let partLines: string[] = [];
    let partStartLine = node.startLine;
    let subIdx = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      partLines.push(line);
      const isBlank = line.trim() === '';
      const partLineCount = partLines.length;

      if (isBlank && partLineCount >= this._cfg.maxChunkLines) {
        const content = partLines.join('\n');
        if (content.trim()) {
          parts.push({
            ...node,
            name: `${node.name}[${subIdx}]`,
            startLine: partStartLine,
            endLine: partStartLine + partLineCount - 1,
            content,
          });
          subIdx++;
        }
        partStartLine = node.startLine + i + 1;
        partLines = [];
      }
    }

    // Remainder
    if (partLines.length > 0 && partLines.join('\n').trim()) {
      parts.push({
        ...node,
        name: `${node.name}[${subIdx}]`,
        startLine: partStartLine,
        endLine: node.endLine,
        content: partLines.join('\n'),
      });
    }

    return parts.length > 0 ? parts : [node];
  }

  // ── Brace-based block end finder ──────────────────────────────────────────

  private _findBlockEnd(lines: string[], startLine: number): number {
    let depth = 0;
    let opened = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      // Skip string contents (simplistic — won't handle all edge cases)
      const stripped = line.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '""');

      for (const ch of stripped) {
        if (ch === '{') { depth++; opened = true; }
        else if (ch === '}') { depth--; }
      }

      if (opened && depth === 0) return i;
    }

    // No closing brace found — return end of file
    return lines.length - 1;
  }

  // ── Python indentation-based block end ────────────────────────────────────

  private _findPythonBlockEnd(lines: string[], startLine: number, baseIndent: number): number {
    for (let i = startLine + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') continue; // blank lines are ok inside block
      const indentMatch = line.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1].length : 0;
      if (indent <= baseIndent && line.trim() !== '') {
        return i - 1;
      }
    }
    return lines.length - 1;
  }

  // ── JSDoc extractor ───────────────────────────────────────────────────────

  private _extractJsDoc(lines: string[], nodeLineIdx: number): string | undefined {
    // Walk backwards from nodeLineIdx looking for */ then /**
    let end = nodeLineIdx - 1;
    while (end >= 0 && lines[end].trim() === '') end--;
    if (end < 0 || !lines[end].trim().endsWith('*/')) return undefined;

    let start = end;
    while (start >= 0 && !lines[start].trim().startsWith('/**')) start--;
    if (start < 0) return undefined;

    return lines.slice(start, end + 1).join('\n');
  }

  // ── Python signature extractor ────────────────────────────────────────────

  private _extractPythonSignature(lines: string[], lineIdx: number): string {
    // Collect lines until we hit ':' at the end
    const parts: string[] = [];
    for (let i = lineIdx; i < Math.min(lineIdx + 10, lines.length); i++) {
      parts.push(lines[i].trim());
      if (lines[i].trimEnd().endsWith(':')) break;
    }
    return parts.join(' ');
  }

  // ── Python docstring extractor ────────────────────────────────────────────

  private _extractPythonDocstring(lines: string[], bodyStartIdx: number): string | undefined {
    // Find first non-blank line in body
    let i = bodyStartIdx;
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length) return undefined;

    const firstLine = lines[i].trim();
    if (!firstLine.startsWith('"""') && !firstLine.startsWith("'''")) return undefined;

    const quote = firstLine.startsWith('"""') ? '"""' : "'''";

    // Single-line docstring
    if (firstLine.slice(3).includes(quote)) {
      return firstLine;
    }

    // Multi-line: find closing quotes
    const parts = [lines[i]];
    for (let j = i + 1; j < lines.length; j++) {
      parts.push(lines[j]);
      if (lines[j].trim().endsWith(quote)) break;
    }
    return parts.join('\n');
  }
}
