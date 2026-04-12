/**
 * Check i18n locale coverage and locale registry integrity.
 *
 * Validates that all registry locales have bundles, that the 100-locale registry
 * stays coherent, and optionally enforces a minimum key-coverage threshold
 * against `en.json` using `--threshold=<percent>`.
 *
 * Run with: `node --import tsx scripts/i18n/check-coverage.ts`
 */

import fs from "node:fs/promises";
import path from "node:path";

type LocaleBundle = {
  metadata?: {
    name?: string;
    nativeName?: string;
    rtl?: boolean;
  };
  messages?: Record<string, string>;
  literals?: Record<string, string>;
};

const projectRoot = process.cwd();
const registryPath = path.resolve(projectRoot, "client/src/locales/registry.ts");
const localesDir = path.resolve(projectRoot, "client/src/locales");
const threshold = parseFloat(process.argv.find((arg) => arg.startsWith("--threshold="))?.split("=")[1] ?? "0");

function extractRegistryCodes(source: string): string[] {
  const matches = [...source.matchAll(/code:\s*"([a-z-]+)"/g)];
  return matches.map((match) => match[1]);
}

async function readLocaleBundle(code: string): Promise<LocaleBundle> {
  const filePath = path.join(localesDir, `${code}.json`);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as LocaleBundle;
}

function countKeys(bundle: LocaleBundle): number {
  return Object.keys(bundle.messages ?? {}).length + Object.keys(bundle.literals ?? {}).length;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const registrySource = await fs.readFile(registryPath, "utf8");
  const registryCodes = extractRegistryCodes(registrySource);
  const uniqueCodes = new Set(registryCodes);
  const localeEntries = await fs.readdir(localesDir, { withFileTypes: true });
  const localeFiles = localeEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.replace(/\.json$/u, ""))
    .sort();

  assert(registryCodes.length === 100, `Expected 100 supported locales in registry, found ${registryCodes.length}`);
  assert(uniqueCodes.size === registryCodes.length, "Language registry contains duplicate locale codes");

  const missingFiles = registryCodes.filter((code) => !localeFiles.includes(code));
  assert(missingFiles.length === 0, `Missing locale files: ${missingFiles.join(", ")}`);

  const unexpectedFiles = localeFiles.filter((code) => !uniqueCodes.has(code));
  assert(unexpectedFiles.length === 0, `Unexpected locale files without registry entry: ${unexpectedFiles.join(", ")}`);

  for (const code of registryCodes) {
    const bundle = await readLocaleBundle(code);
    assert(bundle.metadata?.name, `Locale ${code} is missing metadata.name`);
    assert(bundle.metadata?.nativeName, `Locale ${code} is missing metadata.nativeName`);
    assert(bundle.messages && typeof bundle.messages === "object", `Locale ${code} is missing messages object`);
    assert(bundle.literals && typeof bundle.literals === "object", `Locale ${code} is missing literals object`);
  }

  const en = await readLocaleBundle("en");
  const es = await readLocaleBundle("es");
  const totalKeys = countKeys(en);

  assert(totalKeys > 0, "en.json has no messages/literals keys");
  assert(countKeys(es) > 0, "es.json has no messages/literals keys");

  let allPass = true;

  console.log(`Reference: en.json (${totalKeys} keys)  Threshold: ${threshold}%\n`);
  console.log("Locale  Keys  Coverage");
  console.log("------  ----  --------");

  for (const file of localeFiles.filter((code) => code !== "en").sort()) {
    const locale = await readLocaleBundle(file);
    const keys = countKeys(locale);
    const pct = (keys / totalKeys) * 100;
    const pass = pct >= threshold;
    if (!pass) allPass = false;
    console.log(`${`${file}.json`.padEnd(8)} ${String(keys).padStart(4)}  ${pct.toFixed(1).padStart(6)}% ${pass ? "✓" : "✗"}`);
  }

  console.log(`\n${allPass ? "All locales pass" : "Some locales below threshold"}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
