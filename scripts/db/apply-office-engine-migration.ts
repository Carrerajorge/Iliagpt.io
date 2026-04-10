/**
 * One-shot apply of migrations/0103_add_office_engine_tables.sql.
 *
 * The repo uses drizzle-kit only for migrations 0000-0003. Newer ad-hoc
 * SQL files (0100+) are applied manually. This script reads the 0103 file
 * and executes it against the live DB using the existing connection
 * (server/db.ts). Idempotent because the SQL uses CREATE TABLE IF NOT EXISTS.
 *
 * Run with: `npx tsx scripts/db/apply-office-engine-migration.ts`
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../../server/db";

async function main() {
  const file = path.resolve(process.cwd(), "migrations", "0103_add_office_engine_tables.sql");
  // eslint-disable-next-line no-console
  console.log(`Applying ${file}…`);
  const text = await fs.readFile(file, "utf8");
  // node-postgres can't run multi-statement SQL via $-bound queries, so we
  // execute the file as a single raw text query. drizzle's `sql.raw` does
  // exactly that.
  await db.execute(sql.raw(text));
  // eslint-disable-next-line no-console
  console.log("✓ Migration 0103 applied");
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Migration failed:", err);
  process.exit(1);
});
