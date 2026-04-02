import fs from "fs/promises";
import path from "path";

import { pool } from "../db";

let ensured = false;

function splitStatements(sqlText: string): string[] {
  return sqlText
    .split("--> statement-breakpoint")
    .map((chunk) => chunk.trim())
    .filter((chunk) => {
      if (!chunk) {
        return false;
      }
      const meaningful = chunk.replace(/--.*$/gm, "").trim();
      return meaningful.length > 0;
    });
}

export async function ensureWorkflowTraceSchema(): Promise<void> {
  if (ensured) {
    return;
  }

  const migrationPath = path.resolve(process.cwd(), "migrations", "0025_workflow_run_traces_hardening.sql");
  const sqlText = await fs.readFile(migrationPath, "utf8");
  const statements = splitStatements(sqlText);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query("COMMIT");
    ensured = true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
