/**
 * Check i18n locale coverage against the English reference file.
 *
 * Compares `messages` and `literals` keys in each locale JSON against en.json.
 * Exits 0 if all locales meet the threshold (default 50%), 1 otherwise.
 *
 * Run with: `node --import tsx scripts/i18n/check-coverage.ts`
 */

import * as fs from "node:fs";
import * as path from "node:path";

const LOCALES_DIR = path.resolve(process.cwd(), "client/src/locales");
const THRESHOLD = parseFloat(process.argv.find(a => a.startsWith("--threshold="))?.split("=")[1] ?? "0");

interface LocaleBundle {
  metadata?: Record<string, string>;
  messages?: Record<string, string>;
  literals?: Record<string, string>;
}

function loadJson(filePath: string): LocaleBundle {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function countKeys(bundle: LocaleBundle): number {
  return Object.keys(bundle.messages ?? {}).length + Object.keys(bundle.literals ?? {}).length;
}

function main() {
  const en = loadJson(path.join(LOCALES_DIR, "en.json"));
  const totalKeys = countKeys(en);

  if (totalKeys === 0) {
    console.error("en.json has no messages/literals keys");
    process.exit(1);
  }

  const files = fs.readdirSync(LOCALES_DIR).filter(f => f.endsWith(".json") && f !== "en.json");
  let allPass = true;

  console.log(`Reference: en.json (${totalKeys} keys)  Threshold: ${THRESHOLD}%\n`);
  console.log("Locale  Keys  Coverage");
  console.log("------  ----  --------");

  for (const file of files.sort()) {
    const locale = loadJson(path.join(LOCALES_DIR, file));
    const keys = countKeys(locale);
    const pct = (keys / totalKeys) * 100;
    const pass = pct >= THRESHOLD;
    if (!pass) allPass = false;
    console.log(`${file.padEnd(8)} ${String(keys).padStart(4)}  ${pct.toFixed(1).padStart(6)}% ${pass ? "✓" : "✗"}`);
  }

  console.log(`\n${allPass ? "All locales pass" : "Some locales below threshold"}`);
  process.exit(allPass ? 0 : 1);
}

main();
