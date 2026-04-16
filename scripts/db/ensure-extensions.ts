/**
 * Ensure required PostgreSQL extensions exist before running migrations.
 *
 * Uses raw pg (not Drizzle) so it works before any tables exist.
 * Run with: `node --import tsx scripts/db/ensure-extensions.ts`
 */

import pg from "pg";

const { Pool } = pg;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await pool.query('CREATE EXTENSION IF NOT EXISTS "vector"');
    console.log("Ensured pgcrypto and vector extensions");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Failed to ensure extensions:", err);
  process.exit(1);
});
