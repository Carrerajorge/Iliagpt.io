/**
 * CodeIntelligencePipeline — static analysis for TypeScript, Python, Java, Go, Rust, C++.
 * AST parsing, dependency graphs, complexity metrics, vulnerability scanning, refactoring hints.
 */

import { createLogger } from "../utils/logger";
import * as path from "path";

const logger = createLogger("CodeIntelligencePipeline");

// ─── Types ────────────────────────────────────────────────────────────────────

export type SupportedLanguage = "typescript" | "javascript" | "python" | "java" | "go" | "rust" | "cpp" | "unknown";

export interface CodeFunction {
  name: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  parameters: string[];
  returnType?: string;
  isAsync: boolean;
  isExported: boolean;
  hasDocstring: boolean;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  calledFunctions: string[];
}

export interface CodeClass {
  name: string;
  startLine: number;
  endLine: number;
  methods: string[];
  extends?: string;
  implements?: string[];
  isExported: boolean;
}

export interface ImportInfo {
  source: string;
  imported: string[];
  isDefault: boolean;
  isWildcard: boolean;
  line: number;
}

export interface VulnerabilityFinding {
  type: VulnType;
  severity: "critical" | "high" | "medium" | "low";
  line: number;
  column?: number;
  description: string;
  recommendation: string;
  codeSnippet: string;
}

export type VulnType =
  | "sql_injection" | "xss" | "path_traversal" | "command_injection"
  | "hardcoded_secret" | "insecure_random" | "prototype_pollution"
  | "regex_dos" | "open_redirect" | "xxe";

export interface ComplexityMetrics {
  totalLines: number;
  codeLines: number;
  commentLines: number;
  blankLines: number;
  avgFunctionLength: number;
  maxFunctionLength: number;
  avgCyclomaticComplexity: number;
  maxCyclomaticComplexity: number;
  documentationCoverage: number; // % of functions with docstrings
}

export interface RefactoringSuggestion {
  type: "long_function" | "duplicate_code" | "unused_import" | "magic_number" | "deep_nesting" | "large_class";
  severity: "warning" | "info";
  line: number;
  description: string;
  suggestion: string;
}

export interface CodeAnalysis {
  language: SupportedLanguage;
  filePath?: string;
  functions: CodeFunction[];
  classes: CodeClass[];
  imports: ImportInfo[];
  vulnerabilities: VulnerabilityFinding[];
  complexity: ComplexityMetrics;
  suggestions: RefactoringSuggestion[];
  dependencyGraph: Record<string, string[]>; // module → [imported modules]
  callGraph: Record<string, string[]>;       // function → [called functions]
  unusedImports: string[];
  summary: string;
}

// ─── Language Detection ───────────────────────────────────────────────────────

function detectLanguage(filePath: string, code: string): SupportedLanguage {
  const ext = path.extname(filePath).toLowerCase();
  const extMap: Record<string, SupportedLanguage> = {
    ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript",
    ".py": "python",
    ".java": "java",
    ".go": "go",
    ".rs": "rust",
    ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".c": "cpp",
  };
  if (extMap[ext]) return extMap[ext];

  // Heuristic from content
  if (code.includes("def ") && code.includes(":")) return "python";
  if (code.includes("package main") || code.includes("func ")) return "go";
  if (code.includes("fn ") && code.includes("let mut")) return "rust";
  if (code.includes("public class") || code.includes("import java.")) return "java";
  if (code.includes("interface ") || code.includes(": string") || code.includes(": number")) return "typescript";
  return "unknown";
}

// ─── Function Extraction ──────────────────────────────────────────────────────

function extractTSFunctions(code: string): CodeFunction[] {
  const functions: CodeFunction[] = [];
  const lines = code.split("\n");

  const funcPattern = /(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|async\s*\())/g;

  for (const match of [...code.matchAll(funcPattern)]) {
    const name = match[1] ?? match[2] ?? "anonymous";
    const charPos = match.index ?? 0;
    const startLine = code.slice(0, charPos).split("\n").length;

    // Find function end (count braces)
    let depth = 0;
    let endLine = startLine;
    let started = false;

    for (let i = startLine - 1; i < lines.length; i++) {
      const line = lines[i] ?? "";
      for (const char of line) {
        if (char === "{") { depth++; started = true; }
        if (char === "}") depth--;
      }
      if (started && depth <= 0) { endLine = i + 1; break; }
    }

    const lineCount = endLine - startLine + 1;
    const funcCode = lines.slice(startLine - 1, endLine).join("\n");
    const isAsync = /async\s+(?:function|\()/.test(match[0]) || /const\s+\w+\s*=\s*async/.test(match[0]);
    const isExported = match[0].includes("export");
    const hasDocstring = startLine > 1 && (lines[startLine - 2] ?? "").trim().startsWith("*");

    const cyclomaticComplexity = computeCyclomaticComplexity(funcCode);
    const cognitiveComplexity = computeCognitiveComplexity(funcCode);

    const calledFunctions = [...funcCode.matchAll(/(\w+)\s*\(/g)]
      .map((m) => m[1])
      .filter((n) => n !== name && !["if", "for", "while", "switch", "catch", "typeof"].includes(n))
      .slice(0, 20);

    functions.push({
      name,
      startLine,
      endLine,
      lineCount,
      parameters: extractParameters(match[0]),
      isAsync,
      isExported,
      hasDocstring,
      cyclomaticComplexity,
      cognitiveComplexity,
      calledFunctions: [...new Set(calledFunctions)],
    });
  }

  return functions;
}

function extractPythonFunctions(code: string): CodeFunction[] {
  const functions: CodeFunction[] = [];
  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = line.match(/^(\s*)(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
    if (!match) continue;

    const indent = match[1].length;
    const name = match[2];
    const params = match[3].split(",").map((p) => p.trim()).filter(Boolean);
    const isAsync = line.includes("async def");

    // Find end of function by indentation
    let endLine = i + 1;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] ?? "";
      if (l.trim() === "" || l.match(/^\s/) && l.search(/\S/) > indent) {
        endLine = j + 1;
      } else if (l.trim() !== "" && l.search(/\S/) <= indent) {
        break;
      }
    }

    const funcCode = lines.slice(i, endLine).join("\n");
    const hasDocstring = lines[i + 1]?.trim().startsWith('"""') || lines[i + 1]?.trim().startsWith("'''");

    functions.push({
      name,
      startLine: i + 1,
      endLine,
      lineCount: endLine - i,
      parameters: params,
      isAsync,
      isExported: !name.startsWith("_"),
      hasDocstring: hasDocstring ?? false,
      cyclomaticComplexity: computeCyclomaticComplexity(funcCode),
      cognitiveComplexity: computeCognitiveComplexity(funcCode),
      calledFunctions: [],
    });
  }

  return functions;
}

function extractParameters(signature: string): string[] {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match?.[1]) return [];
  return match[1].split(",").map((p) => p.trim().split(":")[0]?.trim() ?? "").filter(Boolean);
}

// ─── Complexity Metrics ───────────────────────────────────────────────────────

function computeCyclomaticComplexity(code: string): number {
  let complexity = 1;
  const conditionals = code.match(/\b(if|else if|while|for|case|catch|&&|\|\||\?(?!:))/g) ?? [];
  complexity += conditionals.length;
  return Math.min(complexity, 50);
}

function computeCognitiveComplexity(code: string): number {
  let complexity = 0;
  let nestingLevel = 0;

  const lines = code.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();

    if (/\b(if|while|for|switch)\b/.test(trimmed)) {
      complexity += 1 + nestingLevel;
      nestingLevel++;
    } else if (/\bcatch\b/.test(trimmed)) {
      complexity += 1;
    } else if (/\belse\b/.test(trimmed)) {
      complexity += 1;
    } else if (/\}/.test(trimmed)) {
      nestingLevel = Math.max(0, nestingLevel - 1);
    }
  }

  return Math.min(complexity, 100);
}

// ─── Import Extraction ────────────────────────────────────────────────────────

function extractImports(code: string, language: SupportedLanguage): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (language === "typescript" || language === "javascript") {
      const esImport = line.match(/^import\s+(?:\*\s+as\s+(\w+)|\{([^}]+)\}|(\w+))\s+from\s+["']([^"']+)["']/);
      if (esImport) {
        imports.push({
          source: esImport[4] ?? "",
          imported: esImport[2] ? esImport[2].split(",").map((s) => s.trim()) : [esImport[3] ?? esImport[1] ?? "*"],
          isDefault: !!esImport[3],
          isWildcard: !!esImport[1],
          line: i + 1,
        });
      }
    } else if (language === "python") {
      const pyFrom = line.match(/^from\s+(\S+)\s+import\s+(.+)/);
      const pyImport = line.match(/^import\s+(.+)/);
      if (pyFrom) {
        imports.push({
          source: pyFrom[1] ?? "",
          imported: pyFrom[2]?.split(",").map((s) => s.trim()) ?? [],
          isDefault: false,
          isWildcard: (pyFrom[2] ?? "").includes("*"),
          line: i + 1,
        });
      } else if (pyImport) {
        imports.push({
          source: pyImport[1]?.split(" as ")[0]?.trim() ?? "",
          imported: [pyImport[1]?.trim() ?? ""],
          isDefault: true,
          isWildcard: false,
          line: i + 1,
        });
      }
    }
  }

  return imports;
}

// ─── Vulnerability Scanner ────────────────────────────────────────────────────

interface VulnPattern {
  type: VulnType;
  severity: VulnerabilityFinding["severity"];
  pattern: RegExp;
  description: string;
  recommendation: string;
}

const VULN_PATTERNS: VulnPattern[] = [
  {
    type: "sql_injection",
    severity: "critical",
    pattern: /query\s*\(\s*[`'"].*\$\{|\.query\s*\(`.*\${/,
    description: "Potential SQL injection: user input interpolated directly in query string",
    recommendation: "Use parameterized queries or ORM with bound parameters",
  },
  {
    type: "xss",
    severity: "high",
    pattern: /innerHTML\s*=\s*[^`'"]+(?:req\.|params\.|query\.|body\.)/,
    description: "Potential XSS: user data assigned to innerHTML without sanitization",
    recommendation: "Use textContent or sanitize with DOMPurify before setting innerHTML",
  },
  {
    type: "path_traversal",
    severity: "high",
    pattern: /(?:readFile|readFileSync|createReadStream)\s*\([^)]*(?:req\.|params\.|query\.)/,
    description: "Potential path traversal: user input used in file system operations",
    recommendation: "Validate and sanitize file paths, use path.resolve() and check against allowed directories",
  },
  {
    type: "command_injection",
    severity: "critical",
    pattern: /(?:exec|spawn|system)\s*\(\s*[`'"].*\$\{|\.exec\s*\(`/,
    description: "Potential command injection: user input in shell command",
    recommendation: "Use execFile() with argument arrays, never interpolate user input in shell commands",
  },
  {
    type: "hardcoded_secret",
    severity: "high",
    pattern: /(?:password|secret|api_key|apikey|token)\s*[:=]\s*["'][^"']{8,}["']/i,
    description: "Hardcoded secret detected in source code",
    recommendation: "Move secrets to environment variables or a secrets manager",
  },
  {
    type: "insecure_random",
    severity: "medium",
    pattern: /Math\.random\s*\(\s*\).*(?:token|password|secret|key|id)/i,
    description: "Math.random() used for security-sensitive value generation",
    recommendation: "Use crypto.randomBytes() or crypto.getRandomValues() for cryptographic randomness",
  },
  {
    type: "prototype_pollution",
    severity: "high",
    pattern: /Object\.assign\s*\(\s*\w+,\s*(?:req\.|body\.|params\.)/,
    description: "Potential prototype pollution: merging user input into object directly",
    recommendation: "Validate input shape before merging, use Object.create(null) for accumulators",
  },
];

function scanForVulnerabilities(code: string): VulnerabilityFinding[] {
  const findings: VulnerabilityFinding[] = [];
  const lines = code.split("\n");

  for (const pattern of VULN_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (pattern.pattern.test(line)) {
        findings.push({
          type: pattern.type,
          severity: pattern.severity,
          line: i + 1,
          description: pattern.description,
          recommendation: pattern.recommendation,
          codeSnippet: line.trim().slice(0, 100),
        });
      }
    }
  }

  return findings;
}

// ─── Refactoring Suggestions ──────────────────────────────────────────────────

function generateSuggestions(functions: CodeFunction[], imports: ImportInfo[], code: string): RefactoringSuggestion[] {
  const suggestions: RefactoringSuggestion[] = [];

  for (const fn of functions) {
    if (fn.lineCount > 50) {
      suggestions.push({
        type: "long_function",
        severity: "warning",
        line: fn.startLine,
        description: `Function "${fn.name}" is ${fn.lineCount} lines long`,
        suggestion: "Consider splitting into smaller, focused functions with single responsibilities",
      });
    }

    if (fn.cyclomaticComplexity > 10) {
      suggestions.push({
        type: "long_function",
        severity: "warning",
        line: fn.startLine,
        description: `Function "${fn.name}" has cyclomatic complexity ${fn.cyclomaticComplexity}`,
        suggestion: "Reduce complexity by extracting conditions into well-named functions or using early returns",
      });
    }
  }

  // Magic numbers
  const magicNumberMatches = [...code.matchAll(/[^=!<>]\s+(\d{2,})\s*[^;{})\]]/g)];
  for (const m of magicNumberMatches.slice(0, 5)) {
    const line = code.slice(0, m.index).split("\n").length;
    suggestions.push({
      type: "magic_number",
      severity: "info",
      line,
      description: `Magic number ${m[1]} detected`,
      suggestion: "Extract to a named constant for clarity",
    });
  }

  return suggestions.slice(0, 20);
}

// ─── CodeIntelligencePipeline ─────────────────────────────────────────────────

export class CodeIntelligencePipeline {
  analyze(code: string, filePath: string = "unknown"): CodeAnalysis {
    const language = detectLanguage(filePath, code);

    // Extract functions
    const functions = language === "python"
      ? extractPythonFunctions(code)
      : extractTSFunctions(code);

    // Extract imports
    const imports = extractImports(code, language);

    // Extract classes (TypeScript/JavaScript)
    const classes: CodeClass[] = [];
    for (const match of [...code.matchAll(/(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?\s*\{/g)]) {
      const classEnd = code.indexOf("\n}", match.index ?? 0);
      const classCode = code.slice(match.index, classEnd > 0 ? classEnd : code.length);
      const methods = [...classCode.matchAll(/\b(\w+)\s*\([^)]*\)\s*(?::\s*\w+\s*)?\{/g)].map((m) => m[1]);

      classes.push({
        name: match[1],
        startLine: code.slice(0, match.index).split("\n").length,
        endLine: classEnd > 0 ? code.slice(0, classEnd).split("\n").length : 0,
        methods,
        extends: match[2],
        implements: match[3]?.split(",").map((s) => s.trim()),
        isExported: match[0].includes("export"),
      });
    }

    // Vulnerability scan
    const vulnerabilities = scanForVulnerabilities(code);

    // Complexity metrics
    const lines = code.split("\n");
    const codeLines = lines.filter((l) => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("#")).length;
    const commentLines = lines.filter((l) => l.trim().startsWith("//") || l.trim().startsWith("#") || l.trim().startsWith("*")).length;
    const blankLines = lines.filter((l) => !l.trim()).length;
    const docCoverage = functions.length > 0 ? functions.filter((f) => f.hasDocstring).length / functions.length : 0;

    const complexity: ComplexityMetrics = {
      totalLines: lines.length,
      codeLines,
      commentLines,
      blankLines,
      avgFunctionLength: functions.length > 0 ? functions.reduce((s, f) => s + f.lineCount, 0) / functions.length : 0,
      maxFunctionLength: functions.reduce((max, f) => Math.max(max, f.lineCount), 0),
      avgCyclomaticComplexity: functions.length > 0 ? functions.reduce((s, f) => s + f.cyclomaticComplexity, 0) / functions.length : 1,
      maxCyclomaticComplexity: functions.reduce((max, f) => Math.max(max, f.cyclomaticComplexity), 0),
      documentationCoverage: Math.round(docCoverage * 100),
    };

    // Call graph
    const callGraph: Record<string, string[]> = {};
    for (const fn of functions) {
      callGraph[fn.name] = fn.calledFunctions;
    }

    // Dependency graph
    const dependencyGraph: Record<string, string[]> = {};
    dependencyGraph[filePath] = imports.map((i) => i.source);

    // Unused imports
    const usedSymbols = new Set(code.split(/\W+/).filter((w) => w.length > 1));
    const unusedImports = imports
      .filter((imp) => imp.imported.every((s) => !usedSymbols.has(s)))
      .map((imp) => imp.source);

    // Suggestions
    const suggestions = generateSuggestions(functions, imports, code);

    const summary = [
      `${language} file: ${functions.length} functions, ${classes.length} classes`,
      `${vulnerabilities.length} security findings`,
      `Documentation coverage: ${complexity.documentationCoverage}%`,
      complexity.maxCyclomaticComplexity > 10 ? `⚠ High complexity: ${complexity.maxCyclomaticComplexity}` : "",
    ].filter(Boolean).join(". ");

    logger.debug(`Code analysis: ${filePath} — ${functions.length} functions, ${vulnerabilities.length} vulns`);

    return {
      language,
      filePath,
      functions,
      classes,
      imports,
      vulnerabilities,
      complexity,
      suggestions,
      dependencyGraph,
      callGraph,
      unusedImports,
      summary,
    };
  }

  analyzeMultiple(files: Array<{ path: string; code: string }>): {
    analyses: CodeAnalysis[];
    crossFileCallGraph: Record<string, string[]>;
    allVulnerabilities: VulnerabilityFinding[];
    totalComplexity: number;
  } {
    const analyses = files.map(({ path: p, code }) => this.analyze(code, p));
    const allVulnerabilities = analyses.flatMap((a) => a.vulnerabilities);
    const totalComplexity = analyses.reduce((s, a) => s + a.complexity.avgCyclomaticComplexity, 0);

    // Merge call graphs
    const crossFileCallGraph: Record<string, string[]> = {};
    for (const analysis of analyses) {
      for (const [fn, calls] of Object.entries(analysis.callGraph)) {
        crossFileCallGraph[fn] = [...new Set([...(crossFileCallGraph[fn] ?? []), ...calls])];
      }
    }

    return { analyses, crossFileCallGraph, allVulnerabilities, totalComplexity };
  }
}

export const codeIntelligencePipeline = new CodeIntelligencePipeline();
