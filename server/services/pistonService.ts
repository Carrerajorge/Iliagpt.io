import * as codeInterpreter from "./codeInterpreterService";

const PISTON_API_URL = "https://emkc.org/api/v2/piston";
const EXECUTION_TIMEOUT_MS = 30000;
const MEMORY_LIMIT_BYTES = 128 * 1024 * 1024;
const MAX_RETRIES = 1;

export interface PistonExecuteRequest {
  language: string;
  version: string;
  files: Array<{ name?: string; content: string }>;
  stdin?: string;
  args?: string[];
  compile_timeout?: number;
  run_timeout?: number;
  compile_memory_limit?: number;
  run_memory_limit?: number;
}

export interface PistonRunResult {
  stdout: string;
  stderr: string;
  code: number;
  signal: string | null;
  output: string;
}

export interface PistonExecuteResponse {
  language: string;
  version: string;
  run: PistonRunResult;
  compile?: PistonRunResult;
}

export interface PistonRuntime {
  language: string;
  version: string;
  aliases: string[];
  runtime?: string;
}

export interface ErrorLine {
  line: number;
  column?: number;
  message?: string;
}

export interface ExecuteResult {
  run: PistonRunResult;
  compile?: PistonRunResult;
  errorLines: ErrorLine[];
  language: string;
  version: string;
  usedFallback?: boolean;
  artifacts?: Array<{
    type: string;
    name: string;
    data: string;
    mimeType: string;
  }>;
}

interface LanguageConfig {
  language: string;
  version: string;
  filename?: string;
}

export const LANGUAGE_MAP: Record<string, LanguageConfig> = {
  javascript: { language: "javascript", version: "*", filename: "main.js" },
  js: { language: "javascript", version: "*", filename: "main.js" },
  typescript: { language: "typescript", version: "*", filename: "main.ts" },
  ts: { language: "typescript", version: "*", filename: "main.ts" },
  python: { language: "python", version: "3", filename: "main.py" },
  py: { language: "python", version: "3", filename: "main.py" },
  python3: { language: "python", version: "3", filename: "main.py" },
  go: { language: "go", version: "*", filename: "main.go" },
  golang: { language: "go", version: "*", filename: "main.go" },
  rust: { language: "rust", version: "*", filename: "main.rs" },
  rs: { language: "rust", version: "*", filename: "main.rs" },
  c: { language: "c", version: "*", filename: "main.c" },
  cpp: { language: "c++", version: "*", filename: "main.cpp" },
  "c++": { language: "c++", version: "*", filename: "main.cpp" },
  java: { language: "java", version: "*", filename: "Main.java" },
  ruby: { language: "ruby", version: "*", filename: "main.rb" },
  rb: { language: "ruby", version: "*", filename: "main.rb" },
  php: { language: "php", version: "*", filename: "main.php" },
  swift: { language: "swift", version: "*", filename: "main.swift" },
  kotlin: { language: "kotlin", version: "*", filename: "Main.kt" },
  kt: { language: "kotlin", version: "*", filename: "Main.kt" },
  scala: { language: "scala", version: "*", filename: "Main.scala" },
  csharp: { language: "csharp", version: "*", filename: "Main.cs" },
  cs: { language: "csharp", version: "*", filename: "Main.cs" },
  "c#": { language: "csharp", version: "*", filename: "Main.cs" },
  bash: { language: "bash", version: "*", filename: "main.sh" },
  sh: { language: "bash", version: "*", filename: "main.sh" },
  perl: { language: "perl", version: "*", filename: "main.pl" },
  lua: { language: "lua", version: "*", filename: "main.lua" },
  r: { language: "r", version: "*", filename: "main.r" },
  haskell: { language: "haskell", version: "*", filename: "main.hs" },
  hs: { language: "haskell", version: "*", filename: "main.hs" },
  elixir: { language: "elixir", version: "*", filename: "main.exs" },
  ex: { language: "elixir", version: "*", filename: "main.exs" },
  clojure: { language: "clojure", version: "*", filename: "main.clj" },
  clj: { language: "clojure", version: "*", filename: "main.clj" },
  fsharp: { language: "fsharp", version: "*", filename: "Main.fs" },
  "f#": { language: "fsharp", version: "*", filename: "Main.fs" },
  ocaml: { language: "ocaml", version: "*", filename: "main.ml" },
  ml: { language: "ocaml", version: "*", filename: "main.ml" },
  dart: { language: "dart", version: "*", filename: "main.dart" },
  julia: { language: "julia", version: "*", filename: "main.jl" },
  jl: { language: "julia", version: "*", filename: "main.jl" },
  nim: { language: "nim", version: "*", filename: "main.nim" },
  zig: { language: "zig", version: "*", filename: "main.zig" },
  crystal: { language: "crystal", version: "*", filename: "main.cr" },
  d: { language: "d", version: "*", filename: "main.d" },
  erlang: { language: "erlang", version: "*", filename: "main.erl" },
  fortran: { language: "fortran", version: "*", filename: "main.f90" },
  pascal: { language: "pascal", version: "*", filename: "main.pas" },
  prolog: { language: "prolog", version: "*", filename: "main.pl" },
  racket: { language: "racket", version: "*", filename: "main.rkt" },
  scheme: { language: "scheme", version: "*", filename: "main.scm" },
  sql: { language: "sqlite3", version: "*", filename: "main.sql" },
  sqlite: { language: "sqlite3", version: "*", filename: "main.sql" },
  cobol: { language: "cobol", version: "*", filename: "main.cob" },
  awk: { language: "awk", version: "*", filename: "main.awk" },
  brainfuck: { language: "brainfuck", version: "*", filename: "main.bf" },
  bf: { language: "brainfuck", version: "*", filename: "main.bf" },
  lisp: { language: "lisp", version: "*", filename: "main.lisp" },
  commonlisp: { language: "lisp", version: "*", filename: "main.lisp" },
  powershell: { language: "powershell", version: "*", filename: "main.ps1" },
  ps1: { language: "powershell", version: "*", filename: "main.ps1" },
};

let cachedRuntimes: PistonRuntime[] | null = null;
let runtimesCacheTime: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), EXECUTION_TIMEOUT_MS);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        console.warn(`[Piston] Rate limited on attempt ${attempt + 1}`);
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
      }

      return response;
    } catch (error: any) {
      lastError = error;
      console.error(`[Piston] Request failed on attempt ${attempt + 1}:`, error.message);

      if (error.name === "AbortError") {
        throw new Error("Request timeout exceeded");
      }

      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error("All retry attempts failed");
}

export async function getSupportedRuntimes(): Promise<PistonRuntime[]> {
  const now = Date.now();
  if (cachedRuntimes && now - runtimesCacheTime < CACHE_TTL_MS) {
    return cachedRuntimes;
  }

  try {
    const response = await fetchWithRetry(`${PISTON_API_URL}/runtimes`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch runtimes: ${response.status} ${response.statusText}`);
    }

    const runtimes: PistonRuntime[] = await response.json();
    cachedRuntimes = runtimes;
    runtimesCacheTime = now;

    return runtimes;
  } catch (error) {
    console.error("[Piston] Failed to fetch runtimes:", error);
    if (cachedRuntimes) {
      return cachedRuntimes;
    }
    throw error;
  }
}

export function parseErrorLines(stderr: string, language: string): ErrorLine[] {
  const errorLines: ErrorLine[] = [];
  const normalizedLang = LANGUAGE_MAP[language.toLowerCase()]?.language || language.toLowerCase();

  const lines = stderr.split("\n");

  for (const line of lines) {
    let match: RegExpMatchArray | null = null;

    switch (normalizedLang) {
      case "python":
        match = line.match(/File\s+"[^"]*",\s+line\s+(\d+)(?:,\s+in\s+\w+)?/i);
        if (match) {
          errorLines.push({ line: parseInt(match[1], 10) });
        }
        match = line.match(/^\s*File\s+"<[^>]+>",\s+line\s+(\d+)/);
        if (match) {
          errorLines.push({ line: parseInt(match[1], 10) });
        }
        break;

      case "javascript":
      case "typescript":
        match = line.match(/at\s+.*\(.*:(\d+):(\d+)\)/);
        if (match) {
          errorLines.push({
            line: parseInt(match[1], 10),
            column: parseInt(match[2], 10),
          });
        }
        match = line.match(/^\s*.*:(\d+):(\d+)/);
        if (match && !errorLines.some((e) => e.line === parseInt(match![1], 10))) {
          errorLines.push({
            line: parseInt(match[1], 10),
            column: parseInt(match[2], 10),
          });
        }
        match = line.match(/at\s+.*:(\d+):(\d+)/);
        if (match && !errorLines.some((e) => e.line === parseInt(match![1], 10))) {
          errorLines.push({
            line: parseInt(match[1], 10),
            column: parseInt(match[2], 10),
          });
        }
        break;

      case "go":
        match = line.match(/\.\/\w+\.go:(\d+):(\d+):/);
        if (match) {
          errorLines.push({
            line: parseInt(match[1], 10),
            column: parseInt(match[2], 10),
          });
        }
        match = line.match(/\w+\.go:(\d+):(\d+)/);
        if (match && !errorLines.some((e) => e.line === parseInt(match![1], 10))) {
          errorLines.push({
            line: parseInt(match[1], 10),
            column: parseInt(match[2], 10),
          });
        }
        break;

      case "rust":
        match = line.match(/--> [\w.]+:(\d+):(\d+)/);
        if (match) {
          errorLines.push({
            line: parseInt(match[1], 10),
            column: parseInt(match[2], 10),
          });
        }
        match = line.match(/(\d+)\s*\|/);
        if (match && parseInt(match[1], 10) > 0) {
          const lineNum = parseInt(match[1], 10);
          if (!errorLines.some((e) => e.line === lineNum)) {
            errorLines.push({ line: lineNum });
          }
        }
        break;

      case "c":
      case "c++":
        match = line.match(/\w+\.(c|cpp|h|hpp):(\d+):(\d+):\s*(error|warning)/i);
        if (match) {
          errorLines.push({
            line: parseInt(match[2], 10),
            column: parseInt(match[3], 10),
            message: match[4],
          });
        }
        match = line.match(/:(\d+):(\d+):\s*(error|warning|note)/i);
        if (match && !errorLines.some((e) => e.line === parseInt(match![1], 10))) {
          errorLines.push({
            line: parseInt(match[1], 10),
            column: parseInt(match[2], 10),
            message: match[3],
          });
        }
        break;

      case "java":
        match = line.match(/at\s+[\w.$]+\([\w.]+:(\d+)\)/);
        if (match) {
          errorLines.push({ line: parseInt(match[1], 10) });
        }
        match = line.match(/\.java:(\d+):\s*(error|warning)/i);
        if (match && !errorLines.some((e) => e.line === parseInt(match![1], 10))) {
          errorLines.push({
            line: parseInt(match[1], 10),
            message: match[2],
          });
        }
        break;

      case "kotlin":
        match = line.match(/\.kt:(\d+):(\d+):/);
        if (match) {
          errorLines.push({
            line: parseInt(match[1], 10),
            column: parseInt(match[2], 10),
          });
        }
        break;

      case "ruby":
        match = line.match(/\.rb:(\d+):/);
        if (match) {
          errorLines.push({ line: parseInt(match[1], 10) });
        }
        break;

      case "php":
        match = line.match(/on line (\d+)/i);
        if (match) {
          errorLines.push({ line: parseInt(match[1], 10) });
        }
        break;

      case "csharp":
        match = line.match(/\.cs\((\d+),(\d+)\)/);
        if (match) {
          errorLines.push({
            line: parseInt(match[1], 10),
            column: parseInt(match[2], 10),
          });
        }
        break;

      case "scala":
        match = line.match(/\.scala:(\d+):(\d+):/);
        if (match) {
          errorLines.push({
            line: parseInt(match[1], 10),
            column: parseInt(match[2], 10),
          });
        }
        break;

      case "swift":
        match = line.match(/\.swift:(\d+):(\d+):/);
        if (match) {
          errorLines.push({
            line: parseInt(match[1], 10),
            column: parseInt(match[2], 10),
          });
        }
        break;

      case "haskell":
        match = line.match(/\.hs:(\d+):(\d+):/);
        if (match) {
          errorLines.push({
            line: parseInt(match[1], 10),
            column: parseInt(match[2], 10),
          });
        }
        break;

      default:
        match = line.match(/:(\d+):(\d+)/);
        if (match) {
          const lineNum = parseInt(match[1], 10);
          if (lineNum > 0 && !errorLines.some((e) => e.line === lineNum)) {
            errorLines.push({
              line: lineNum,
              column: parseInt(match[2], 10),
            });
          }
        }
        match = line.match(/line\s+(\d+)/i);
        if (match) {
          const lineNum = parseInt(match[1], 10);
          if (!errorLines.some((e) => e.line === lineNum)) {
            errorLines.push({ line: lineNum });
          }
        }
        break;
    }
  }

  const uniqueLines = errorLines.filter(
    (error, index, self) =>
      index === self.findIndex((e) => e.line === error.line && e.column === error.column)
  );

  return uniqueLines.sort((a, b) => a.line - b.line);
}

export async function executeCode(
  languageInput: string,
  code: string,
  stdin?: string,
  args?: string[]
): Promise<ExecuteResult> {
  const langConfig = LANGUAGE_MAP[languageInput.toLowerCase()];

  if (!langConfig) {
    throw new Error(`Unsupported language: ${languageInput}. Available: ${Object.keys(LANGUAGE_MAP).join(", ")}`);
  }

  const { language, version, filename } = langConfig;
  const isPython = language === "python";

  try {
    const requestBody: PistonExecuteRequest = {
      language,
      version,
      files: [{ name: filename, content: code }],
      stdin: stdin || "",
      args: args || [],
      compile_timeout: EXECUTION_TIMEOUT_MS,
      run_timeout: EXECUTION_TIMEOUT_MS,
      compile_memory_limit: MEMORY_LIMIT_BYTES,
      run_memory_limit: MEMORY_LIMIT_BYTES,
    };

    console.log(`[Piston] Executing ${language} (${version}) code...`);

    const response = await fetchWithRetry(`${PISTON_API_URL}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Piston API error: ${response.status} - ${errorText}`);
    }

    const result: PistonExecuteResponse = await response.json();

    const stderr = result.run?.stderr || result.compile?.stderr || "";
    const errorLines = parseErrorLines(stderr, language);

    return {
      run: result.run,
      compile: result.compile,
      errorLines,
      language: result.language,
      version: result.version,
      artifacts: [],
    };
  } catch (error: any) {
    console.error(`[Piston] Execution failed for ${language}:`, error.message);

    if (isPython) {
      console.log("[Piston] Falling back to local Python interpreter...");
      try {
        const localResult = await codeInterpreter.executeCode(code, {
          language: "python",
        });

        const stderr = localResult.run.stderr || "";
        const errorLines = parseErrorLines(stderr, "python");

        return {
          run: {
            stdout: localResult.run.stdout || "",
            stderr: localResult.run.stderr || "",
            code: localResult.run.status === "success" ? 0 : 1,
            signal: null,
            output: (localResult.run.stdout || "") + (localResult.run.stderr || ""),
          },
          errorLines,
          language: "python",
          version: "3.x (local)",
          usedFallback: true,
          artifacts: localResult.artifacts.map((a) => ({
            type: a.type,
            name: a.name,
            data: a.data,
            mimeType: a.mimeType,
          })),
        };
      } catch (fallbackError: any) {
        console.error("[Piston] Local fallback also failed:", fallbackError.message);
        throw new Error(`Both Piston and local execution failed: ${error.message}`);
      }
    }

    throw error;
  }
}

export async function getLanguageInfo(languageInput: string): Promise<{
  supported: boolean;
  pistonLanguage?: string;
  version?: string;
  filename?: string;
}> {
  const langConfig = LANGUAGE_MAP[languageInput.toLowerCase()];

  if (!langConfig) {
    return { supported: false };
  }

  try {
    const runtimes = await getSupportedRuntimes();
    const runtime = runtimes.find(
      (r) =>
        r.language === langConfig.language ||
        r.aliases.includes(langConfig.language)
    );

    if (runtime) {
      return {
        supported: true,
        pistonLanguage: runtime.language,
        version: runtime.version,
        filename: langConfig.filename,
      };
    }

    return {
      supported: true,
      pistonLanguage: langConfig.language,
      version: langConfig.version,
      filename: langConfig.filename,
    };
  } catch {
    return {
      supported: true,
      pistonLanguage: langConfig.language,
      version: langConfig.version,
      filename: langConfig.filename,
    };
  }
}

export function getSupportedLanguages(): string[] {
  return [...new Set(Object.values(LANGUAGE_MAP).map((c) => c.language))];
}

export function getLanguageAliases(): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};

  for (const [alias, config] of Object.entries(LANGUAGE_MAP)) {
    if (!aliases[config.language]) {
      aliases[config.language] = [];
    }
    if (alias !== config.language) {
      aliases[config.language].push(alias);
    }
  }

  return aliases;
}
