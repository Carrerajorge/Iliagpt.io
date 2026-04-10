import fs from "fs";
import path from "path";
import dotenv from "dotenv";

const PLACEHOLDER_ENV_VALUES = new Set(["undefined", "null", "missing", '""', "''"]);

const resolveRepoRoot = (startDir: string): string => {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (fs.existsSync(path.join(currentDir, "package.json"))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return startDir;
    }
    currentDir = parentDir;
  }
};

const rootDir = resolveRepoRoot(process.cwd());
const envFiles: string[] = [];

if (process.env.NODE_ENV === "production") {
  envFiles.push(".env.production.local", ".env.local", ".env.production", ".env");
} else if (process.env.NODE_ENV === "test") {
  envFiles.push(".env.test.local", ".env.test", ".env");
} else {
  envFiles.push(".env.local", ".env");
}

envFiles.forEach((envFile) => {
  const envPath = path.join(rootDir, envFile);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
});

for (const [key, value] of Object.entries(process.env)) {
  if (typeof value !== "string") continue;
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDER_ENV_VALUES.has(trimmed.toLowerCase())) {
    delete process.env[key];
  }
}

if (!process.env.OPENAI_API_KEY && process.env.OPENROUTER_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.OPENROUTER_API_KEY;
}

if (process.env.OPENROUTER_API_KEY && !process.env.OPENAI_BASE_URL) {
  process.env.OPENAI_BASE_URL = "https://openrouter.ai/api/v1";
}
process.env.ENV_LOADED_BY_BOOTSTRAP = "true";
