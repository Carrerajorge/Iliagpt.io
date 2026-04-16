import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolContext } from '../../agent/toolRegistry';
import { Logger } from '../../lib/logger';
import type { ToolRegistry } from '../../agent/toolRegistry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(output: unknown, extras?: Partial<ToolResult>): ToolResult {
  return { success: true, output, ...extras };
}

function fail(code: string, message: string, retryable = false): ToolResult {
  return { success: false, output: null, error: { code, message, retryable } };
}

/**
 * Run an async function with a timeout. Rejects with an error if the timeout
 * elapses before the promise settles.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// ---------------------------------------------------------------------------
// 1. screenshot_page
// ---------------------------------------------------------------------------

const screenshotPage: ToolDefinition = {
  name: 'openclaw_screenshot',
  description: 'Take a screenshot of a webpage URL and return the image as base64 PNG.',
  inputSchema: z.object({
    url: z.string().url(),
  }),
  capabilities: ['requires_network', 'produces_artifacts'],
  timeoutMs: 30_000,
  execute: async (input: any, _ctx: ToolContext): Promise<ToolResult> => {
    try {
      Logger.info('[ExtendedTools] screenshot_page: capturing', { url: input.url });
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(input.url, { timeout: 15_000, waitUntil: 'domcontentloaded' });
        const buffer = await page.screenshot({ type: 'png', fullPage: false });
        Logger.info('[ExtendedTools] screenshot_page: done', { bytes: buffer.length });
        return ok(`Screenshot captured (${buffer.length} bytes)`, {
          artifacts: [{
            type: 'image' as any,
            name: 'screenshot.png',
            data: { base64: buffer.toString('base64'), format: 'png', width: 1280, height: 720 },
          }],
        });
      } finally {
        await browser.close();
      }
    } catch (err: any) {
      Logger.error('[ExtendedTools] screenshot_page failed', err);
      return fail('SCREENSHOT_ERROR', err?.message || 'Screenshot capture failed', true);
    }
  },
};

// ---------------------------------------------------------------------------
// 2. pdf_extract
// ---------------------------------------------------------------------------

const pdfExtract: ToolDefinition = {
  name: 'openclaw_pdf_extract',
  description: 'Extract text content from a PDF file on disk.',
  inputSchema: z.object({
    path: z.string().min(1),
  }),
  capabilities: ['reads_files'],
  timeoutMs: 30_000,
  execute: async (input: any, _ctx: ToolContext): Promise<ToolResult> => {
    try {
      Logger.info('[ExtendedTools] pdf_extract: reading', { path: input.path });
      const pdfParse = (await import('pdf-parse')).default;
      const fs = await import('fs/promises');
      const buffer = await fs.readFile(input.path);
      const result = await withTimeout(pdfParse(buffer), 25_000, 'pdf_extract');
      const text = result.text.slice(0, 50_000);
      Logger.info('[ExtendedTools] pdf_extract: done', { pages: result.numpages, chars: result.text.length });
      return ok(text, {
        metrics: { durationMs: 0 } as any,
      });
    } catch (err: any) {
      Logger.error('[ExtendedTools] pdf_extract failed', err);
      return fail('PDF_EXTRACT_ERROR', err?.message || 'PDF extraction failed', false);
    }
  },
};

// ---------------------------------------------------------------------------
// 3. code_eval (sandboxed JS eval via Node built-in vm)
// ---------------------------------------------------------------------------

const codeEval: ToolDefinition = {
  name: 'openclaw_code_eval',
  description: 'Execute JavaScript code in a sandboxed context and return the result.',
  inputSchema: z.object({
    code: z.string().min(1),
  }),
  capabilities: ['executes_code'],
  safetyPolicy: 'requires_confirmation',
  timeoutMs: 10_000,
  execute: async (input: any, _ctx: ToolContext): Promise<ToolResult> => {
    try {
      Logger.info('[ExtendedTools] code_eval: executing');
      const vm = await import('vm');
      const logs: string[] = [];
      const sandbox = {
        console: {
          log: (...args: any[]) => logs.push(args.map(String).join(' ')),
          warn: (...args: any[]) => logs.push('[warn] ' + args.map(String).join(' ')),
          error: (...args: any[]) => logs.push('[error] ' + args.map(String).join(' ')),
        },
        result: undefined as unknown,
        Math,
        JSON,
        Date,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        Array,
        Object,
        String: globalThis.String,
        Number: globalThis.Number,
        Boolean: globalThis.Boolean,
        RegExp,
        Map,
        Set,
      };
      const context = vm.createContext(sandbox);
      const script = new vm.Script(input.code);
      script.runInContext(context, { timeout: 5_000 });
      const output = logs.length > 0 ? logs.join('\n') : String(sandbox.result ?? '(no output)');
      Logger.info('[ExtendedTools] code_eval: done');
      return ok(output);
    } catch (err: any) {
      Logger.error('[ExtendedTools] code_eval failed', err);
      return fail('CODE_EVAL_ERROR', err?.message || 'Code evaluation failed', false);
    }
  },
};

// ---------------------------------------------------------------------------
// 4. generate_chart (SVG chart from data)
// ---------------------------------------------------------------------------

function generateSimpleSvgChart(
  type: string,
  labels: string[],
  values: number[],
  title?: string,
): string {
  const width = 600;
  const height = 400;
  const padding = 60;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;
  const maxVal = Math.max(...values, 1);

  const escapeXml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const titleSvg = title
    ? `<text x="${width / 2}" y="30" text-anchor="middle" font-size="16" font-weight="bold" fill="#333">${escapeXml(title)}</text>`
    : '';

  if (type === 'pie') {
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const cx = width / 2;
    const cy = height / 2 + 10;
    const r = Math.min(chartW, chartH) / 2 - 10;
    const colors = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'];
    let startAngle = 0;
    const slices: string[] = [];
    const legendItems: string[] = [];

    for (let i = 0; i < values.length; i++) {
      const sliceAngle = (values[i] / total) * Math.PI * 2;
      const endAngle = startAngle + sliceAngle;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const largeArc = sliceAngle > Math.PI ? 1 : 0;
      const color = colors[i % colors.length];

      slices.push(
        `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z" fill="${color}" stroke="#fff" stroke-width="1"/>`,
      );
      legendItems.push(
        `<rect x="${width - 140}" y="${50 + i * 20}" width="12" height="12" fill="${color}"/>` +
        `<text x="${width - 122}" y="${61 + i * 20}" font-size="11" fill="#333">${escapeXml(labels[i] ?? `#${i}`)}</text>`,
      );
      startAngle = endAngle;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#fff"/>
  ${titleSvg}
  ${slices.join('\n  ')}
  ${legendItems.join('\n  ')}
</svg>`;
  }

  // Bar or Line chart
  const barW = chartW / labels.length;
  const colors = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7'];

  // X axis labels
  const xLabels = labels
    .map(
      (l, i) =>
        `<text x="${padding + i * barW + barW / 2}" y="${height - padding + 18}" text-anchor="middle" font-size="11" fill="#555">${escapeXml(l)}</text>`,
    )
    .join('\n  ');

  // Y axis (3 gridlines)
  const gridLines: string[] = [];
  for (let g = 0; g <= 3; g++) {
    const y = padding + chartH - (g / 3) * chartH;
    const val = ((g / 3) * maxVal).toFixed(1);
    gridLines.push(
      `<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="#eee" stroke-width="1"/>` +
      `<text x="${padding - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#888">${val}</text>`,
    );
  }

  if (type === 'line') {
    const points = values
      .map((v, i) => {
        const x = padding + i * barW + barW / 2;
        const y = padding + chartH - (v / maxVal) * chartH;
        return `${x},${y}`;
      })
      .join(' ');

    const dots = values
      .map((v, i) => {
        const x = padding + i * barW + barW / 2;
        const y = padding + chartH - (v / maxVal) * chartH;
        return `<circle cx="${x}" cy="${y}" r="4" fill="#4e79a7"/>`;
      })
      .join('\n  ');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#fff"/>
  ${titleSvg}
  ${gridLines.join('\n  ')}
  <polyline points="${points}" fill="none" stroke="#4e79a7" stroke-width="2"/>
  ${dots}
  ${xLabels}
</svg>`;
  }

  // Default: bar chart
  const bars = values
    .map((v, i) => {
      const bh = (v / maxVal) * chartH;
      const x = padding + i * barW + barW * 0.15;
      const y = padding + chartH - bh;
      const w = barW * 0.7;
      const color = colors[i % colors.length];
      return `<rect x="${x}" y="${y}" width="${w}" height="${bh}" fill="${color}" rx="2"/>`;
    })
    .join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#fff"/>
  ${titleSvg}
  ${gridLines.join('\n  ')}
  ${bars}
  ${xLabels}
</svg>`;
}

const generateChart: ToolDefinition = {
  name: 'openclaw_generate_chart',
  description: 'Generate an SVG chart (bar, line, or pie) from data labels and values.',
  inputSchema: z.object({
    type: z.enum(['bar', 'line', 'pie']).default('bar'),
    labels: z.array(z.string()),
    values: z.array(z.number()),
    title: z.string().optional(),
  }),
  capabilities: ['produces_artifacts'],
  timeoutMs: 10_000,
  execute: async (input: any, _ctx: ToolContext): Promise<ToolResult> => {
    try {
      Logger.info('[ExtendedTools] generate_chart', { type: input.type, points: input.labels?.length });
      if (!input.labels?.length || !input.values?.length) {
        return fail('INVALID_INPUT', 'labels and values arrays are required', false);
      }
      if (input.labels.length !== input.values.length) {
        return fail('INVALID_INPUT', 'labels and values must have the same length', false);
      }
      const svg = generateSimpleSvgChart(input.type ?? 'bar', input.labels, input.values, input.title);
      Logger.info('[ExtendedTools] generate_chart: done');
      return ok(svg, {
        artifacts: [{
          type: 'image' as any,
          name: 'chart.svg',
          data: { format: 'svg', content: svg },
        }],
      });
    } catch (err: any) {
      Logger.error('[ExtendedTools] generate_chart failed', err);
      return fail('CHART_ERROR', err?.message || 'Chart generation failed', false);
    }
  },
};

// ---------------------------------------------------------------------------
// 5. math_eval (safe math expression evaluator)
// ---------------------------------------------------------------------------

/**
 * Recursive-descent parser for math expressions.
 *
 * Supported: +, -, *, /, ^, parentheses, unary minus,
 * functions: sqrt, sin, cos, tan, log, ln, exp, abs, ceil, floor, round
 * constants: pi, e
 */
function safeEvaluateMathExpression(expression: string): number {
  const tokens: string[] = [];
  const raw = expression.replace(/\s+/g, '');
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];

    // Number (integer or decimal)
    if (/\d/.test(ch) || (ch === '.' && i + 1 < raw.length && /\d/.test(raw[i + 1]))) {
      let num = '';
      while (i < raw.length && (/\d/.test(raw[i]) || raw[i] === '.')) {
        num += raw[i++];
      }
      tokens.push(num);
      continue;
    }

    // Alphabetical (function or constant)
    if (/[a-zA-Z]/.test(ch)) {
      let word = '';
      while (i < raw.length && /[a-zA-Z]/.test(raw[i])) {
        word += raw[i++];
      }
      tokens.push(word.toLowerCase());
      continue;
    }

    // Operators and parens
    if ('+-*/^()'.includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }

    // Skip unknown characters
    i++;
  }

  let pos = 0;

  const peek = (): string | undefined => tokens[pos];
  const consume = (expected?: string): string => {
    const tok = tokens[pos];
    if (expected !== undefined && tok !== expected) {
      throw new Error(`Expected '${expected}' but got '${tok ?? 'EOF'}'`);
    }
    pos++;
    return tok;
  };

  // Grammar: expr -> term ((+|-) term)*
  function parseExpr(): number {
    let left = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  // term -> power ((*|/) power)*
  function parseTerm(): number {
    let left = parsePower();
    while (peek() === '*' || peek() === '/') {
      const op = consume();
      const right = parsePower();
      if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  // power -> unary (^ power)?  (right-associative)
  function parsePower(): number {
    const base = parseUnary();
    if (peek() === '^') {
      consume();
      const exp = parsePower();
      return Math.pow(base, exp);
    }
    return base;
  }

  // unary -> (- unary) | atom
  function parseUnary(): number {
    if (peek() === '-') {
      consume();
      return -parseUnary();
    }
    if (peek() === '+') {
      consume();
      return parseUnary();
    }
    return parseAtom();
  }

  // atom -> NUMBER | CONST | FUNC '(' expr ')' | '(' expr ')'
  function parseAtom(): number {
    const tok = peek();
    if (tok === undefined) throw new Error('Unexpected end of expression');

    // Parenthesised expression
    if (tok === '(') {
      consume('(');
      const val = parseExpr();
      consume(')');
      return val;
    }

    // Number literal
    if (/^\d/.test(tok) || (tok.startsWith('.') && tok.length > 1)) {
      consume();
      const num = parseFloat(tok);
      if (isNaN(num)) throw new Error(`Invalid number: ${tok}`);
      return num;
    }

    // Constants
    if (tok === 'pi') { consume(); return Math.PI; }
    if (tok === 'e') { consume(); return Math.E; }

    // Functions
    const funcs: Record<string, (v: number) => number> = {
      sqrt: Math.sqrt,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      log: Math.log10,
      ln: Math.log,
      exp: Math.exp,
      abs: Math.abs,
      ceil: Math.ceil,
      floor: Math.floor,
      round: Math.round,
    };

    if (funcs[tok]) {
      consume();
      consume('(');
      const arg = parseExpr();
      consume(')');
      return funcs[tok](arg);
    }

    throw new Error(`Unexpected token: '${tok}'`);
  }

  const result = parseExpr();
  if (pos < tokens.length) {
    throw new Error(`Unexpected token after expression: '${tokens[pos]}'`);
  }
  if (!isFinite(result)) {
    throw new Error('Result is not a finite number');
  }
  return result;
}

const mathEval: ToolDefinition = {
  name: 'openclaw_math_eval',
  description: 'Evaluate a mathematical expression safely and return the numeric result. Supports +, -, *, /, ^, sqrt, sin, cos, tan, log, ln, exp, abs, pi, e.',
  inputSchema: z.object({
    expression: z.string().min(1),
  }),
  capabilities: [],
  timeoutMs: 5_000,
  execute: async (input: any, _ctx: ToolContext): Promise<ToolResult> => {
    try {
      Logger.info('[ExtendedTools] math_eval', { expression: input.expression });
      const result = safeEvaluateMathExpression(input.expression);
      Logger.info('[ExtendedTools] math_eval: done', { result });
      return ok(`Result: ${result}`, { metrics: { durationMs: 0 } as any });
    } catch (err: any) {
      Logger.error('[ExtendedTools] math_eval failed', err);
      return fail('MATH_EVAL_ERROR', err?.message || 'Math evaluation failed', false);
    }
  },
};

// ---------------------------------------------------------------------------
// 6. diagram_generate (Mermaid from template)
// ---------------------------------------------------------------------------

function generateMermaidFromTemplate(
  type: string,
  entities: string[],
  relationships?: Array<{ from: string; to: string; label?: string }>,
): string {
  const rels = relationships ?? [];

  switch (type) {
    case 'sequence': {
      const lines = ['sequenceDiagram'];
      if (rels.length > 0) {
        for (const r of rels) {
          lines.push(`    ${r.from}->>${r.to}: ${r.label ?? ''}`);
        }
      } else {
        // Auto-generate sequential interactions between entities
        for (let i = 0; i < entities.length - 1; i++) {
          lines.push(`    ${entities[i]}->>${entities[i + 1]}: interacts`);
        }
      }
      return lines.join('\n');
    }

    case 'class': {
      const lines = ['classDiagram'];
      for (const e of entities) {
        lines.push(`    class ${e}`);
      }
      for (const r of rels) {
        lines.push(`    ${r.from} --> ${r.to} : ${r.label ?? 'uses'}`);
      }
      return lines.join('\n');
    }

    case 'er':
    case 'entity-relationship': {
      const lines = ['erDiagram'];
      if (rels.length > 0) {
        for (const r of rels) {
          lines.push(`    ${r.from} ||--o{ ${r.to} : "${r.label ?? 'relates'}"`);
        }
      } else {
        for (let i = 0; i < entities.length - 1; i++) {
          lines.push(`    ${entities[i]} ||--o{ ${entities[i + 1]} : "has"`);
        }
      }
      return lines.join('\n');
    }

    case 'flowchart':
    default: {
      const lines = ['flowchart TD'];
      // Create node ids from entity names (sanitised)
      const ids = entities.map((e, i) => ({
        id: `N${i}`,
        label: e,
      }));
      for (const n of ids) {
        lines.push(`    ${n.id}["${n.label}"]`);
      }
      if (rels.length > 0) {
        for (const r of rels) {
          const fromNode = ids.find((n) => n.label === r.from);
          const toNode = ids.find((n) => n.label === r.to);
          if (fromNode && toNode) {
            lines.push(`    ${fromNode.id} -->|${r.label ?? ''}| ${toNode.id}`);
          }
        }
      } else {
        // Chain entities sequentially
        for (let i = 0; i < ids.length - 1; i++) {
          lines.push(`    ${ids[i].id} --> ${ids[i + 1].id}`);
        }
      }
      return lines.join('\n');
    }
  }
}

const diagramGenerate: ToolDefinition = {
  name: 'openclaw_diagram',
  description: 'Generate a Mermaid diagram from entities and relationships. Supports flowchart, sequence, class, and entity-relationship diagram types.',
  inputSchema: z.object({
    type: z.enum(['flowchart', 'sequence', 'class', 'er', 'entity-relationship']).default('flowchart'),
    entities: z.array(z.string()).min(1),
    relationships: z
      .array(
        z.object({
          from: z.string(),
          to: z.string(),
          label: z.string().optional(),
        }),
      )
      .optional(),
  }),
  capabilities: ['produces_artifacts'],
  timeoutMs: 5_000,
  execute: async (input: any, _ctx: ToolContext): Promise<ToolResult> => {
    try {
      Logger.info('[ExtendedTools] diagram_generate', { type: input.type, entityCount: input.entities?.length });
      if (!input.entities?.length) {
        return fail('INVALID_INPUT', 'At least one entity is required', false);
      }
      const mermaid = generateMermaidFromTemplate(
        input.type ?? 'flowchart',
        input.entities,
        input.relationships,
      );
      Logger.info('[ExtendedTools] diagram_generate: done');
      return ok(mermaid);
    } catch (err: any) {
      Logger.error('[ExtendedTools] diagram_generate failed', err);
      return fail('DIAGRAM_ERROR', err?.message || 'Diagram generation failed', false);
    }
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const extendedTools: ToolDefinition[] = [
  screenshotPage,
  pdfExtract,
  codeEval,
  generateChart,
  mathEval,
  diagramGenerate,
];

/**
 * Register all extended OpenClaw tools into the given tool registry.
 * Returns the number of tools registered.
 */
export function registerExtendedTools(registry: ToolRegistry): number {
  for (const tool of extendedTools) {
    try {
      registry.register(tool);
      Logger.info(`[OpenClaw:ExtendedTools] Registered tool: ${tool.name}`);
    } catch (err: any) {
      Logger.error(`[OpenClaw:ExtendedTools] Failed to register tool: ${tool.name}`, err);
    }
  }
  return extendedTools.length;
}
