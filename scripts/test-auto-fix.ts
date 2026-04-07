import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import chokidar from "chokidar";

type FixerMode = "codex" | "none";

interface Options {
  watch: boolean;
  command: string;
  fixer: FixerMode;
  maxAttempts: number;
  debounceMs: number;
  cwd: string;
}

const DEFAULT_COMMAND = "npm run test:run";
const DEFAULT_GLOBS = [
  "server/**/*.{ts,tsx,js,jsx}",
  "client/**/*.{ts,tsx,js,jsx}",
  "shared/**/*.{ts,tsx,js,jsx}",
  "tests/**/*.{ts,tsx,js,jsx}",
  "scripts/**/*.{ts,tsx,js,jsx,sh,cjs,mjs}",
  "package.json",
  "vitest.config.ts",
  "vitest.client.config.ts",
];
const DEFAULT_IGNORED = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  "**/coverage/**",
  "**/.codex/test-failures/**",
];

function printHelp(): void {
  console.log(`Uso:
  npm run test:auto
  npm run test:auto:watch
  node --import tsx scripts/test-auto-fix.ts --command "npm run test:ci:chat-core"

Opciones:
  --watch                 Observa cambios y vuelve a correr el comando
  --command "<cmd>"       Comando de test a ejecutar
  --fixer codex|none      Usa Codex para intentar corregir fallos
  --max-attempts <n>      Intentos máximos por ciclo (default: 2)
  --debounce-ms <n>       Debounce del watcher (default: 900)
  --cwd <dir>             Directorio de trabajo (default: cwd actual)
  --help                  Muestra esta ayuda

Ejemplos:
  node --import tsx scripts/test-auto-fix.ts --command "npm run test:run -- server/__tests__/gptPromptHierarchy.test.ts"
  node --import tsx scripts/test-auto-fix.ts --watch --command "npm run test:ci:chat-core" --fixer codex
`);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    watch: false,
    command: DEFAULT_COMMAND,
    fixer: "codex",
    maxAttempts: 2,
    debounceMs: 900,
    cwd: process.cwd(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--watch") {
      options.watch = true;
      continue;
    }
    if (arg === "--command") {
      options.command = argv[i + 1] || options.command;
      i += 1;
      continue;
    }
    if (arg.startsWith("--command=")) {
      options.command = arg.slice("--command=".length);
      continue;
    }
    if (arg === "--fixer") {
      const value = (argv[i + 1] || "").trim();
      if (value === "codex" || value === "none") {
        options.fixer = value;
      }
      i += 1;
      continue;
    }
    if (arg.startsWith("--fixer=")) {
      const value = arg.slice("--fixer=".length).trim();
      if (value === "codex" || value === "none") {
        options.fixer = value;
      }
      continue;
    }
    if (arg === "--max-attempts") {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.maxAttempts = Math.trunc(parsed);
      }
      i += 1;
      continue;
    }
    if (arg.startsWith("--max-attempts=")) {
      const parsed = Number(arg.slice("--max-attempts=".length));
      if (Number.isFinite(parsed) && parsed > 0) {
        options.maxAttempts = Math.trunc(parsed);
      }
      continue;
    }
    if (arg === "--debounce-ms") {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.debounceMs = Math.trunc(parsed);
      }
      i += 1;
      continue;
    }
    if (arg.startsWith("--debounce-ms=")) {
      const parsed = Number(arg.slice("--debounce-ms=".length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.debounceMs = Math.trunc(parsed);
      }
      continue;
    }
    if (arg === "--cwd") {
      options.cwd = path.resolve(argv[i + 1] || options.cwd);
      i += 1;
      continue;
    }
    if (arg.startsWith("--cwd=")) {
      options.cwd = path.resolve(arg.slice("--cwd=".length));
    }
  }

  return options;
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function ensureFailureDir(cwd: string): Promise<string> {
  const failureDir = path.join(cwd, ".codex", "test-failures");
  await fs.mkdir(failureDir, { recursive: true });
  return failureDir;
}

async function writeFailureArtifacts(
  cwd: string,
  command: string,
  output: string,
  attempt: number,
): Promise<{ logPath: string; metaPath: string }> {
  const dir = await ensureFailureDir(cwd);
  const stamp = nowStamp();
  const logPath = path.join(dir, `${stamp}.log`);
  const metaPath = path.join(dir, `${stamp}.json`);
  const latestLogPath = path.join(dir, "latest.log");
  const latestMetaPath = path.join(dir, "latest.json");

  const meta = {
    command,
    attempt,
    createdAt: new Date().toISOString(),
    cwd,
    logPath,
  };

  await fs.writeFile(logPath, output, "utf8");
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
  await fs.writeFile(latestLogPath, output, "utf8");
  await fs.writeFile(latestMetaPath, JSON.stringify(meta, null, 2), "utf8");

  return { logPath, metaPath };
}

async function runShellCommand(command: string, cwd: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });

    let output = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });

    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, output });
    });
  });
}

function buildCodexPrompt(command: string, logPath: string): string {
  return `Hay un comando de tests fallando en este repositorio.

Comando exacto:
${command}

Log del fallo:
${logPath}

Tarea:
1. Lee el log.
2. Corrige la causa raíz en el código o en los tests solo si el test está incorrecto.
3. No debilites asserts ni ocultes errores reales.
4. Vuelve a ejecutar exactamente este comando hasta que pase.
5. Mantén los cambios acotados al fallo.

Al final, resume qué corregiste y confirma si el comando quedó en verde.`;
}

async function runCodexFix(command: string, cwd: string, logPath: string): Promise<number> {
  const codexBin = process.env.CODEX_BIN || "codex";
  const prompt = buildCodexPrompt(command, logPath);
  console.log(`\n[test:auto] Lanzando auto-fix con Codex...\n`);
  const result = await runShellCommand(
    `"${codexBin}" exec --full-auto -C "${cwd}" ${JSON.stringify(prompt)}`,
    cwd,
  );
  return result.exitCode;
}

async function runCycle(options: Options): Promise<boolean> {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    console.log(`\n[test:auto] Intento ${attempt}/${options.maxAttempts}`);
    console.log(`[test:auto] Ejecutando: ${options.command}\n`);

    const result = await runShellCommand(options.command, options.cwd);
    if (result.exitCode === 0) {
      console.log(`\n[test:auto] OK. El comando pasó.\n`);
      return true;
    }

    const { logPath } = await writeFailureArtifacts(options.cwd, options.command, result.output, attempt);
    console.error(`\n[test:auto] Falló el comando. Log guardado en ${logPath}`);

    if (options.fixer === "none" || attempt >= options.maxAttempts) {
      continue;
    }

    const fixExitCode = await runCodexFix(options.command, options.cwd, logPath);
    if (fixExitCode !== 0) {
      console.error(`[test:auto] Codex no pudo completar la corrección automática (exit ${fixExitCode}).`);
    }
  }

  return false;
}

async function runWatchMode(options: Options): Promise<void> {
  let active = false;
  let pending = false;
  let timer: NodeJS.Timeout | null = null;

  const trigger = async (reason: string) => {
    if (active) {
      pending = true;
      return;
    }

    active = true;
    console.log(`\n[test:auto] Cambio detectado (${reason}). Reejecutando...\n`);
    try {
      await runCycle(options);
    } finally {
      active = false;
      if (pending) {
        pending = false;
        void trigger("cambios acumulados");
      }
    }
  };

  const watcher = chokidar.watch(DEFAULT_GLOBS, {
    cwd: options.cwd,
    ignored: DEFAULT_IGNORED,
    ignoreInitial: true,
  });

  const schedule = (reason: string) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      void trigger(reason);
    }, options.debounceMs);
  };

  watcher.on("all", (event, file) => schedule(`${event}: ${file}`));

  console.log(`[test:auto] Watch activo en ${options.cwd}`);
  console.log(`[test:auto] Observando cambios y ejecutando: ${options.command}`);
  await runCycle(options);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.watch) {
    await runWatchMode(options);
    return;
  }

  const ok = await runCycle(options);
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error("[test:auto] Error fatal:", error);
  process.exit(1);
});
