import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import type { Root, Element, Text } from 'hast';
import { visit } from 'unist-util-visit';

const MAX_MARKDOWN_LENGTH = 20000;

/**
 * Common LaTeX commands that indicate mathematical content
 */
const LATEX_COMMANDS = [
  'int', 'sum', 'prod', 'lim', 'frac', 'sqrt', 'sin', 'cos', 'tan', 'log', 'ln',
  'exp', 'infty', 'alpha', 'beta', 'gamma', 'delta', 'theta', 'pi', 'sigma',
  'partial', 'nabla', 'cdot', 'times', 'div', 'pm', 'mp', 'leq', 'geq', 'neq',
  'approx', 'equiv', 'subset', 'supset', 'cup', 'cap', 'in', 'notin', 'forall',
  'exists', 'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow', 'vec', 'hat',
  'bar', 'dot', 'ddot', 'binom', 'matrix', 'begin', 'end', 'left', 'right',
  'over', 'to', 'mapsto', 'implies', 'iff', 'land', 'lor', 'neg', 'oplus',
  'otimes', 'mathbb', 'mathcal', 'mathbf', 'mathrm', 'text'
];

/**
 * Wrap raw LaTeX expressions in $ delimiters so remark-math can parse them.
 * Detects expressions containing LaTeX commands like \int, \frac, \sin, etc.
 */
function wrapRawLatex(text: string): string {
  const lines = text.split('\n');
  const processedLines = lines.map(line => {
    // Skip lines that are already properly delimited
    if (line.includes('$') || line.includes('\\[') || line.includes('\\(')) {
      return line;
    }
    
    // Check if line contains LaTeX commands
    const hasLatex = LATEX_COMMANDS.some(cmd => line.includes(`\\${cmd}`));
    if (!hasLatex) {
      return line;
    }
    
    const trimmed = line.trim();
    
    // If line is purely a math expression (starts with \ and is mostly math), wrap entire line
    if (trimmed.startsWith('\\')) {
      return `$$${trimmed}$$`;
    }
    
    // Find where math expression starts (first backslash) and extract it
    // Common pattern: "text: \int ... dx" or "text: \frac{...}{...}"
    const colonIndex = line.lastIndexOf(':');
    if (colonIndex !== -1) {
      const beforeColon = line.substring(0, colonIndex + 1);
      const afterColon = line.substring(colonIndex + 1).trim();
      
      // Check if what follows the colon contains LaTeX
      const afterHasLatex = LATEX_COMMANDS.some(cmd => afterColon.includes(`\\${cmd}`));
      if (afterHasLatex && afterColon.startsWith('\\')) {
        // Wrap everything after the colon as math
        return `${beforeColon} $${afterColon}$`;
      }
    }
    
    // For lines like "f(x) = expression" or inline math, try to identify math segments
    // Match continuous math expressions starting with \command and including related content
    let result = line;
    
    // Pattern: match from first \command to end of math-like content
    // This captures: \int ... dx, \frac{}{}, \sin(x), etc.
    const mathStartPattern = /\\(int|sum|prod|lim|frac|sqrt|sin|cos|tan|log|ln|exp|partial|nabla|vec|hat|bar|binom|left|right)/;
    const match = result.match(mathStartPattern);
    
    if (match && match.index !== undefined) {
      const startIdx = match.index;
      // Find where this math expression likely ends
      // Look for: end of line, or a sentence-ending pattern not part of math
      let endIdx = result.length;
      
      // Extract the potential math portion
      const mathPortion = result.substring(startIdx);
      
      // Wrap the entire math portion
      result = result.substring(0, startIdx) + `$${mathPortion}$`;
    }
    
    return result;
  });
  
  return processedLines.join('\n');
}

function normalizeMarkdown(text: string): string {
  if (text.length > MAX_MARKDOWN_LENGTH) {
    throw new Error("Markdown payload too large");
  }

  let normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  
  // Convert LaTeX bracket delimiters to dollar delimiters
  normalized = normalized.replace(/\\\[/g, '$$').replace(/\\\]/g, '$$');
  normalized = normalized.replace(/\\\(/g, '$').replace(/\\\)/g, '$');
  
  // Wrap any remaining raw LaTeX expressions
  normalized = wrapRawLatex(normalized);
  
  return normalized;
}

/**
 * Custom rehype plugin that converts math nodes to TipTap-compatible format.
 * Instead of rendering math with KaTeX, it creates span elements with
 * data-type="inlineMath" that TipTap's MathExtension can parse.
 */
function rehypePreserveMath() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      
      // Handle inline math: <span class="math math-inline">...</span>
      if (
        node.tagName === 'span' &&
        node.properties?.className &&
        Array.isArray(node.properties.className) &&
        node.properties.className.includes('math-inline')
      ) {
        const latex = extractTextFromNode(node);
        // Create a TipTap-compatible math span
        const mathSpan: Element = {
          type: 'element',
          tagName: 'span',
          properties: {
            'data-type': 'inlineMath',
            'data-latex': latex,
            'data-evaluate': 'no',
            'data-display': 'no'
          },
          children: [{ type: 'text', value: `$${latex}$` }]
        };
        (parent as Element).children.splice(index, 1, mathSpan);
        return;
      }
      
      // Handle display math: <div class="math math-display">...</div>
      if (
        node.tagName === 'div' &&
        node.properties?.className &&
        Array.isArray(node.properties.className) &&
        node.properties.className.includes('math-display')
      ) {
        const latex = extractTextFromNode(node);
        // Create a TipTap-compatible math span with display mode
        const mathSpan: Element = {
          type: 'element',
          tagName: 'span',
          properties: {
            'data-type': 'inlineMath',
            'data-latex': latex,
            'data-evaluate': 'no',
            'data-display': 'yes'
          },
          children: [{ type: 'text', value: `$$${latex}$$` }]
        };
        // Wrap in a paragraph
        const paragraph: Element = {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [mathSpan]
        };
        (parent as Element).children.splice(index, 1, paragraph);
        return;
      }
    });
  };
}

/**
 * Extract text content from a HAST node recursively
 */
function extractTextFromNode(node: Element | Text): string {
  if (node.type === 'text') {
    return node.value;
  }
  if (node.type === 'element' && node.children) {
    return node.children.map(child => extractTextFromNode(child as Element | Text)).join('');
  }
  return '';
}

export function markdownToHtml(markdown: string): string {
  if (!markdown || markdown.trim() === '') {
    return '<p></p>';
  }

  try {
    const normalized = normalizeMarkdown(markdown);
    const result = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath)
      .use(remarkRehype, { allowDangerousHtml: false })
      .use(rehypeKatex)
      .use(rehypeStringify, { allowDangerousHtml: false })
      .processSync(normalized);
    
    return String(result) || '<p></p>';
  } catch (error) {
    console.error('[markdownToHtml] Parse error:', error);
    return `<p>${markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
  }
}

export function markdownToHtmlAsync(markdown: string): Promise<string> {
  if (!markdown || markdown.trim() === '') {
    return Promise.resolve('<p></p>');
  }

  try {
    const normalized = normalizeMarkdown(markdown);
    return unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath)
      .use(remarkRehype, { allowDangerousHtml: false })
      .use(rehypeKatex)
      .use(rehypeStringify, { allowDangerousHtml: false })
      .process(normalized)
      .then(result => String(result) || '<p></p>')
      .catch(error => {
        console.error('[markdownToHtml] Parse error:', error);
        return `<p>${markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
      });
  } catch (error) {
    console.error('[markdownToHtml] Parse error:', error);
    return Promise.resolve(`<p>${markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`);
  }
}

/**
 * Converts markdown to HTML suitable for TipTap editor.
 * Unlike markdownToHtml, this function preserves $...$ and $$...$$ math delimiters
 * instead of rendering them with KaTeX. This allows TipTap's MathExtension to
 * properly handle the math content and preserve the LaTeX in node.attrs.latex.
 * 
 * Use this function when loading content into TipTap editor.
 * Use markdownToHtml for display-only rendering (e.g., chat messages).
 */
export function markdownToTipTap(markdown: string): string {
  if (!markdown || markdown.trim() === '') {
    return '<p></p>';
  }

  try {
    const normalized = normalizeMarkdown(markdown);
    const result = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath)
      .use(remarkRehype, { allowDangerousHtml: false })
      .use(rehypePreserveMath) // Use our custom plugin instead of rehypeKatex
      .use(rehypeStringify, { allowDangerousHtml: false })
      .processSync(normalized);
    
    return String(result) || '<p></p>';
  } catch (error) {
    console.error('[markdownToTipTap] Parse error:', error);
    return `<p>${markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
  }
}
