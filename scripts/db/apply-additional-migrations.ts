import fs from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../../server/db";

const EXTRA_MIGRATIONS = [
  path.resolve(process.cwd(), "migrations", "0100_add_performance_indexes.sql"),
  path.resolve(process.cwd(), "migrations", "0101_add_missing_admin_tables.sql"),
  path.resolve(process.cwd(), "migrations", "0102_add_derived_amount_columns.sql"),
  path.resolve(process.cwd(), "migrations", "0103_add_office_engine_tables.sql"),
  path.resolve(process.cwd(), "migrations", "migrations", "fix_oauth_states.sql"),
] as const;

async function applyMigration(filePath: string) {
  try {
    const contents = await fs.readFile(filePath, "utf8");
    await db.execute(sql.raw(contents));
    // eslint-disable-next-line no-console
    console.log(`Applied ${path.relative(process.cwd(), filePath)}`);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function main() {
  for (const migrationPath of EXTRA_MIGRATIONS) {
    await applyMigration(migrationPath);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to apply additional migrations:", error);
  process.exit(1);
});
