export interface SandboxRunOutput {
  stdout: string;
  stderr: string;
  code: number;
  signal: string | null;
  output: string;
}

export interface SandboxErrorLine {
  line: number;
  column?: number;
  message?: string;
}

export interface SandboxRunResult {
  run: SandboxRunOutput;
  compile?: SandboxRunOutput;
  errorLines: SandboxErrorLine[];
  language: string;
  version: string;
  usedFallback: boolean;
  artifacts: Array<{
    type: string;
    name: string;
    data: string;
    mimeType: string;
  }>;
}

export interface SandboxRuntime {
  language: string;
  version: string;
  aliases: string[];
  runtime?: string;
}

export interface SandboxRuntimes {
  runtimes: SandboxRuntime[];
  supportedLanguages: string[];
  aliases: Record<string, string[]>;
}

const RUNNABLE_LANGUAGES = new Set([
  "javascript", "js", "typescript", "ts",
  "python", "py", "python3",
  "go", "golang",
  "rust", "rs",
  "c", "cpp", "c++",
  "java",
  "ruby", "rb",
  "php",
  "swift",
  "kotlin", "kt",
  "scala",
  "csharp", "cs", "c#",
  "bash", "sh",
  "perl",
  "lua",
  "r",
  "haskell", "hs",
  "elixir", "ex",
  "clojure", "clj",
  "fsharp", "f#",
  "ocaml", "ml",
  "dart",
  "julia", "jl",
  "nim",
  "zig",
  "crystal",
  "d",
  "erlang",
  "fortran",
  "pascal",
  "prolog",
  "racket",
  "scheme",
  "sql", "sqlite",
  "cobol",
  "awk",
  "brainfuck", "bf",
  "lisp", "commonlisp",
  "powershell", "ps1",
]);

let cachedRuntimes: SandboxRuntimes | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getSandboxRuntimes(): Promise<SandboxRuntimes> {
  const now = Date.now();
  if (cachedRuntimes && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedRuntimes;
  }

  const response = await fetch("/api/sandbox/runtimes");
  
  if (!response.ok) {
    throw new Error(`Failed to fetch runtimes: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  cachedRuntimes = {
    runtimes: data.runtimes || [],
    supportedLanguages: data.supportedLanguages || [],
    aliases: data.aliases || {},
  };
  cacheTimestamp = now;

  return cachedRuntimes;
}

export async function executeInSandbox(
  code: string,
  language: string,
  stdin?: string,
  args?: string[]
): Promise<SandboxRunResult> {
  const response = await fetch("/api/sandbox/execute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code,
      language,
      stdin,
      args,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Execution failed: ${response.status}`);
  }

  const result = await response.json();
  
  return {
    run: result.run || {
      stdout: "",
      stderr: "",
      code: 0,
      signal: null,
      output: "",
    },
    compile: result.compile,
    errorLines: result.errorLines || [],
    language: result.language || language,
    version: result.version || "unknown",
    usedFallback: result.usedFallback || false,
    artifacts: result.artifacts || [],
  };
}

export function isLanguageRunnable(language: string): boolean {
  if (!language) return false;
  return RUNNABLE_LANGUAGES.has(language.toLowerCase());
}

export function normalizeLanguage(language: string): string {
  const lang = language.toLowerCase().trim();
  
  const aliases: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    python3: "python",
    golang: "go",
    rs: "rust",
    rb: "ruby",
    kt: "kotlin",
    cs: "csharp",
    "c#": "csharp",
    "c++": "cpp",
    sh: "bash",
    hs: "haskell",
    ex: "elixir",
    clj: "clojure",
    "f#": "fsharp",
    ml: "ocaml",
    jl: "julia",
    bf: "brainfuck",
    commonlisp: "lisp",
    ps1: "powershell",
    sqlite: "sql",
  };

  return aliases[lang] || lang;
}
