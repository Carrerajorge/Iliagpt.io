/**
 * LaTeX to readable text for Excel
 * 
 * Converts basic LaTeX symbols to Unicode while preserving the original expression
 * for complex constructs. This ensures formulas remain readable and copyable.
 */

/**
 * Convert basic LaTeX symbols to Unicode for Excel display
 * Preserves complex expressions as-is to avoid corruption
 */
export function formatLatexForExcel(latex: string): string {
  if (!latex || typeof latex !== 'string') {
    return '';
  }
  
  let formatted = latex.trim();
  
  // Only convert simple, standalone Greek letters and symbols
  // These are safe substitutions that don't affect structure
  const safeSubstitutions: Record<string, string> = {
    // Greek lowercase
    '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ',
    '\\epsilon': 'ε', '\\zeta': 'ζ', '\\eta': 'η', '\\theta': 'θ',
    '\\iota': 'ι', '\\kappa': 'κ', '\\lambda': 'λ', '\\mu': 'μ',
    '\\nu': 'ν', '\\xi': 'ξ', '\\pi': 'π', '\\rho': 'ρ',
    '\\sigma': 'σ', '\\tau': 'τ', '\\upsilon': 'υ', '\\phi': 'φ',
    '\\chi': 'χ', '\\psi': 'ψ', '\\omega': 'ω',
    // Greek uppercase
    '\\Gamma': 'Γ', '\\Delta': 'Δ', '\\Theta': 'Θ', '\\Lambda': 'Λ',
    '\\Xi': 'Ξ', '\\Pi': 'Π', '\\Sigma': 'Σ', '\\Phi': 'Φ',
    '\\Psi': 'Ψ', '\\Omega': 'Ω',
    // Common operators and symbols
    '\\infty': '∞', '\\partial': '∂', '\\nabla': '∇',
    '\\leq': '≤', '\\le': '≤', '\\geq': '≥', '\\ge': '≥',
    '\\neq': '≠', '\\ne': '≠', '\\approx': '≈', '\\equiv': '≡',
    '\\pm': '±', '\\times': '×', '\\div': '÷', '\\cdot': '·',
    '\\ldots': '…', '\\cdots': '⋯',
    '\\forall': '∀', '\\exists': '∃',
    '\\in': '∈', '\\notin': '∉', '\\subset': '⊂', '\\supset': '⊃',
    '\\cup': '∪', '\\cap': '∩', '\\emptyset': '∅',
    '\\rightarrow': '→', '\\to': '→', '\\leftarrow': '←',
    '\\Rightarrow': '⇒', '\\Leftarrow': '⇐',
    '\\neg': '¬', '\\land': '∧', '\\lor': '∨',
  };
  
  // Apply safe substitutions
  for (const [cmd, symbol] of Object.entries(safeSubstitutions)) {
    const escapedCmd = cmd.replace(/\\/g, '\\\\');
    formatted = formatted.replace(new RegExp(escapedCmd + '(?![a-zA-Z])', 'g'), symbol);
  }
  
  return formatted;
}

/**
 * Extract LaTeX expressions from text with $...$ or $$...$$ delimiters
 */
export function extractLatexExpressions(text: string): { latex: string; isBlock: boolean; start: number; end: number }[] {
  const expressions: { latex: string; isBlock: boolean; start: number; end: number }[] = [];
  
  // Block math first ($$...$$)
  const blockRegex = /\$\$([\s\S]+?)\$\$/g;
  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    expressions.push({
      latex: match[1].trim(),
      isBlock: true,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  
  // Inline math ($...$) - avoid overlapping with block math
  const inlineRegex = /\$([^$]+?)\$/g;
  while ((match = inlineRegex.exec(text)) !== null) {
    const overlaps = expressions.some(
      exp => match!.index >= exp.start && match!.index < exp.end
    );
    if (!overlaps) {
      expressions.push({
        latex: match[1],
        isBlock: false,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  
  return expressions.sort((a, b) => a.start - b.start);
}

/**
 * Convert all LaTeX in a text string to readable format
 */
export function convertLatexInText(text: string): string {
  const expressions = extractLatexExpressions(text);
  if (expressions.length === 0) return text;
  
  let result = '';
  let lastEnd = 0;
  
  for (const expr of expressions) {
    result += text.slice(lastEnd, expr.start);
    result += formatLatexForExcel(expr.latex);
    lastEnd = expr.end;
  }
  
  result += text.slice(lastEnd);
  return result;
}
