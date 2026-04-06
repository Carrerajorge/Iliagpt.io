/**
 * Checks whether SQL migration files on disk are all registered in the Drizzle
 * journal. Logs a warning (or in production, an error) if orphan files are found.
 * This prevents silent schema drift when migrations are added without updating the journal.
 */
import fs from "fs";
import path from "path";
import { Logger } from "./logger";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations/migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta/_journal.json");

export async function checkMigrationDrift(): Promise<void> {
  try {
    if (!fs.existsSync(JOURNAL_PATH)) {
      Logger.warn("[MigrationDrift] Journal file not found; skipping drift check", { path: JOURNAL_PATH });
      return;
    }

    const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const journaledTags = new Set(journal.entries.map((e) => e.tag));

    const sqlFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => path.basename(f, ".sql"));

    const orphans = sqlFiles.filter((tag) => !journaledTags.has(tag));

    if (orphans.length === 0) {
      Logger.info("[MigrationDrift] All migration files are registered in the journal");
      return;
    }

    const msg = `[MigrationDrift] ${orphans.length} SQL migration file(s) on disk are NOT in the Drizzle journal and will NOT be applied by drizzle-kit migrate: ${orphans.join(", ")}`;

    if (process.env.NODE_ENV === "production") {
      Logger.error(msg, { orphans });
      // Do not crash — surface the problem without breaking startup
    } else {
      Logger.warn(msg, { orphans });
    }
  } catch (err: any) {
    Logger.warn("[MigrationDrift] Failed to run drift check", { error: err?.message });
  }
}
