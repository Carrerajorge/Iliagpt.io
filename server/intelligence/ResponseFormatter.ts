import { Logger } from '../lib/logger';

export interface OutputContext {
  format: 'markdown' | 'html' | 'plain' | 'slack' | 'terminal';
  device: 'desktop' | 'mobile' | 'api';
  maxLength?: number;
  language?: string;
  enableMath?: boolean;
  enableDiagrams?: boolean;
}

export interface FormattingOptions {
  context: OutputContext;
  preserveStructure: boolean;
  addLineNumbers: boolean;
  collapseThreshold: number;
  mathDelimiters: {
    inline: [string, string];
    block: [string, string];
  };
}

export interface FormattedElement {
  type: 'text' | 'code' | 'math' | 'table' | 'diagram' | 'heading' | 'list';
  start: number;
  end: number;
  language?: string;
}

export interface FormattedResponse {
  content: string;
  format: string;
  originalLength: number;
  formattedLength: number;
  elements: FormattedElement[];
}

const DEFAULT_CONTEXT: OutputContext = {
  format: 'markdown',
  device: 'desktop',
  enableMath: false,
  enableDiagrams: false,
};

const DEFAULT_OPTIONS: FormattingOptions = {
  context: DEFAULT_CONTEXT,
  preserveStructure: true,
  addLineNumbers: false,
  collapseThreshold: 500,
  mathDelimiters: {
    inline: ['$', '$'],
    block: ['$$', '$$'],
  },
};

export class ResponseFormatter {
  private defaultContext: OutputContext;

  constructor(defaultContext?: Partial<OutputContext>) {
    this.defaultContext = { ...DEFAULT_CONTEXT, ...defaultContext };
  }

  format(content: string, options?: Partial<FormattingOptions>): FormattedResponse {
    const opts: FormattingOptions = {
      ...DEFAULT_OPTIONS,
      ...options,
      context: { ...this.defaultContext, ...(options?.context ?? {}) },
      mathDelimiters: options?.mathDelimiters ?? DEFAULT_OPTIONS.mathDelimiters,
    };

    const originalLength = content.length;
    let result = content;

    Logger.debug('Formatting response', { format: opts.context.format, device: opts.context.device, originalLength });

    if (opts.context.format === 'markdown' || opts.context.format === 'html') {
      result = this.optimizeMarkdown(result);
    }

    if (opts.context.enableMath) {
      result = this.renderMath(result, opts.mathDelimiters);
    }

    result = this._processCodeBlocks(result, opts);

    if (opts.context.format === 'html' && opts.collapseThreshold > 0) {
      result = this.addCollapsibleSections(result, opts.collapseThreshold);
    }

    result = this.adaptLength(result, opts.context);

    const elements = this._extractElements(result);

    return {
      content: result,
      format: opts.context.format,
      originalLength,
      formattedLength: result.length,
      elements,
    };
  }

  optimizeMarkdown(content: string): string {
    let lines = content.split('\n');
    const output: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trimEnd();
      const isHeading = /^#{1,6}\s/.test(line);
      const prevLine = output[output.length - 1] ?? '';
      const nextLine = lines[i + 1] ?? '';

      if (isHeading) {
        // Ensure blank line before heading (unless first line)
        if (output.length > 0 && prevLine !== '') {
          output.push('');
        }
        output.push(line);
        // Ensure blank line after heading
        if (nextLine !== '') {
          output.push('');
        }
        continue;
      }

      // Detect code block start/end
      if (/^```/.test(line)) {
        if (line === '```') {
          // Closing fence — already handled by _processCodeBlocks, pass through
          output.push(line);
          continue;
        }
        // Opening fence — ensure language tag
        const lang = line.slice(3).trim();
        if (!lang) {
          // Peek ahead to detect language
          const blockLines: string[] = [];
          let j = i + 1;
          while (j < lines.length && !/^```/.test(lines[j])) {
            blockLines.push(lines[j]);
            j++;
          }
          const detected = this._detectCodeLanguage(blockLines.join('\n'));
          output.push('```' + detected);
          continue;
        }
        output.push(line);
        continue;
      }

      // Normalize list indentation: ensure 2-space indent for nested lists
      if (/^(\s+)[-*+]\s/.test(line)) {
        const match = line.match(/^(\s+)([-*+]\s)/);
        if (match) {
          const depth = Math.floor(match[1].length / 2);
          line = '  '.repeat(depth) + match[2] + line.slice(match[1].length + match[2].length);
        }
      }

      output.push(line);
    }

    // Remove trailing whitespace on each line and collapse 3+ blank lines to 2
    return output
      .join('\n')
      .replace(/ +$/gm, '')
      .replace(/\n{3,}/g, '\n\n');
  }

  renderMath(content: string, delimiters: FormattingOptions['mathDelimiters']): string {
    const [inlineOpen, inlineClose] = delimiters.inline;
    const [blockOpen, blockClose] = delimiters.block;

    // Block math first ($$...$$) to avoid conflict with inline
    let result = content.replace(
      new RegExp(
        escapeRegex(blockOpen) + '([\\s\\S]+?)' + escapeRegex(blockClose),
        'g',
      ),
      (_match, math: string) => {
        return `<div class="math-block">${math.trim()}</div>`;
      },
    );

    // Inline math ($...$) — skip double-dollar already replaced
    result = result.replace(
      new RegExp(
        '(?<!class="math-block">)' +
        escapeRegex(inlineOpen) + '([^\\n]+?)' + escapeRegex(inlineClose),
        'g',
      ),
      (_match, math: string) => {
        // Don't double-wrap block math replacements
        if (_match.startsWith('<div')) return _match;
        return `<span class="math-inline">${math}</span>`;
      },
    );

    return result;
  }

  generateMermaidDiagram(description: string): string {
    const lower = description.toLowerCase();

    if (/flow|workflow|pipeline/.test(lower)) {
      const words = description.split(/\s+/).filter(w => w.length > 3).slice(0, 6);
      const nodes = words.map((w, i) => `  ${String.fromCharCode(65 + i)}[${capitalize(w)}]`);
      const arrows = words.slice(0, -1).map((_, i) =>
        `  ${String.fromCharCode(65 + i)} --> ${String.fromCharCode(65 + i + 1)}`,
      );
      return `\`\`\`mermaid\nflowchart TD\n${nodes.join('\n')}\n${arrows.join('\n')}\n\`\`\``;
    }

    if (/sequence|interaction|protocol/.test(lower)) {
      return [
        '```mermaid',
        'sequenceDiagram',
        '  participant Client',
        '  participant Server',
        '  participant Database',
        '  Client->>Server: Request',
        '  Server->>Database: Query',
        '  Database-->>Server: Result',
        '  Server-->>Client: Response',
        '```',
      ].join('\n');
    }

    if (/class|inheritance|extends/.test(lower)) {
      return [
        '```mermaid',
        'classDiagram',
        '  class Base {',
        '    +id: string',
        '    +createdAt: Date',
        '    +process(): void',
        '  }',
        '  class Derived {',
        '    +extra: string',
        '    +extend(): void',
        '  }',
        '  Base <|-- Derived',
        '```',
      ].join('\n');
    }

    if (/state|transition|machine/.test(lower)) {
      return [
        '```mermaid',
        'stateDiagram-v2',
        '  [*] --> Idle',
        '  Idle --> Processing : start',
        '  Processing --> Success : complete',
        '  Processing --> Error : fail',
        '  Success --> [*]',
        '  Error --> Idle : reset',
        '```',
      ].join('\n');
    }

    // Default: flowchart with keyword nodes
    const keywords = description.split(/\W+/).filter(w => w.length > 3).slice(0, 4);
    if (keywords.length === 0) {
      return '```mermaid\nflowchart TD\n  A[Start] --> B[Process] --> C[End]\n```';
    }
    const nodes = keywords.map((kw, i) => `  ${String.fromCharCode(65 + i)}[${capitalize(kw)}]`);
    const arrows = keywords.slice(0, -1).map((_, i) =>
      `  ${String.fromCharCode(65 + i)} --> ${String.fromCharCode(65 + i + 1)}`,
    );
    return `\`\`\`mermaid\nflowchart TD\n${nodes.join('\n')}\n${arrows.join('\n')}\n\`\`\``;
  }

  adaptLength(content: string, context: OutputContext): string {
    if (context.device === 'api' && !context.maxLength) {
      return content;
    }

    if (!context.maxLength) {
      return content;
    }

    if (content.length <= context.maxLength) {
      return content;
    }

    // Truncate at sentence boundary
    const truncated = content.slice(0, context.maxLength);
    const lastSentence = Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf('.\n'),
      truncated.lastIndexOf('! '),
      truncated.lastIndexOf('? '),
    );

    if (lastSentence > context.maxLength * 0.7) {
      return truncated.slice(0, lastSentence + 1) + ' ... [truncated]';
    }

    return truncated + '... [truncated]';
  }

  formatCode(code: string, language: string, options: Partial<FormattingOptions>): string {
    const addLines = options.addLineNumbers ?? false;

    let body = code;
    if (addLines) {
      body = code
        .split('\n')
        .map((line, idx) => `${idx + 1}| ${line}`)
        .join('\n');
    }

    const fence = '```' + language + '\n' + body + '\n```';
    return `<!-- copy -->\n${fence}`;
  }

  addCollapsibleSections(content: string, threshold: number): string {
    // Only meaningful for HTML format
    const sections = content.split(/(?=^#{2,3}\s)/m);
    if (sections.length <= 1) return content;

    return sections.map((section, idx) => {
      if (idx === 0) return section; // First section stays open
      if (section.length <= threshold) return section;

      const titleMatch = section.match(/^(#{2,3})\s+(.+)/);
      const title = titleMatch ? titleMatch[2] : `Section ${idx}`;
      const body = titleMatch ? section.slice(titleMatch[0].length).trim() : section;

      return `<details>\n<summary>${title}</summary>\n\n${body}\n</details>`;
    }).join('\n\n');
  }

  private _processCodeBlocks(content: string, opts: FormattingOptions): string {
    return content.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
      const language = lang || this._detectCodeLanguage(code);
      return this.formatCode(code.trimEnd(), language, opts);
    });
  }

  private _detectCodeLanguage(code: string): string {
    const sample = code.slice(0, 500).toLowerCase();

    if (/^\s*(<html|<!doctype html|<div|<body|<head)/m.test(sample)) return 'html';
    if (/import\s+\w|from\s+['"]|const\s+\w|let\s+\w|function\s+\w|=>\s*\{|interface\s+\w|type\s+\w\s*=/.test(sample)) {
      if (/:\s*(string|number|boolean|void|unknown|Record<|Array<)/.test(sample)) return 'typescript';
      return 'javascript';
    }
    if (/def\s+\w+\s*\(|class\s+\w+(\s*:|\s*\()/.test(sample)) return 'python';
    if (/package\s+\w+;|import\s+java\.|public\s+class/.test(sample)) return 'java';
    if (/fn\s+\w+\s*\(|let\s+mut\s+|use\s+std::/.test(sample)) return 'rust';
    if (/^\s*#\s*include|int\s+main\s*\(/.test(sample)) return 'cpp';
    if (/\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bCREATE TABLE\b/i.test(sample)) return 'sql';
    if (/^\s*---\n|^\w+:\s/m.test(sample)) return 'yaml';
    if (/^\s*\{[\s\S]*"[\w-]+"\s*:/.test(sample)) return 'json';
    if (/^FROM\s+\w|^RUN\s+|^COPY\s+|^ENV\s+/m.test(sample)) return 'dockerfile';
    if (/^\s*#!\s*\/bin\/bash|^\s*#!\s*\/usr\/bin\/env\s+bash|echo\s+|grep\s+/m.test(sample)) return 'bash';

    return 'text';
  }

  private _extractElements(content: string): FormattedElement[] {
    const elements: FormattedElement[] = [];
    const lines = content.split('\n');
    let pos = 0;
    let inCodeBlock = false;
    let codeBlockStart = 0;
    let codeLang = '';

    for (const line of lines) {
      const lineEnd = pos + line.length + 1; // +1 for newline

      if (/^```(\w*)/.test(line) && !inCodeBlock) {
        inCodeBlock = true;
        codeBlockStart = pos;
        const match = line.match(/^```(\w*)/);
        codeLang = match?.[1] ?? '';
      } else if (/^```$/.test(line) && inCodeBlock) {
        inCodeBlock = false;
        elements.push({ type: 'code', start: codeBlockStart, end: lineEnd, language: codeLang });
      } else if (!inCodeBlock) {
        if (/^#{1,6}\s/.test(line)) {
          elements.push({ type: 'heading', start: pos, end: lineEnd });
        } else if (/^[-*+]\s|^\d+\.\s/.test(line)) {
          elements.push({ type: 'list', start: pos, end: lineEnd });
        } else if (/^\|.+\|/.test(line)) {
          elements.push({ type: 'table', start: pos, end: lineEnd });
        } else if (/class="math-(inline|block)"/.test(line)) {
          elements.push({ type: 'math', start: pos, end: lineEnd });
        } else if (/^```mermaid/.test(line)) {
          elements.push({ type: 'diagram', start: pos, end: lineEnd });
        } else if (line.trim().length > 0) {
          elements.push({ type: 'text', start: pos, end: lineEnd });
        }
      }

      pos = lineEnd;
    }

    return elements;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
