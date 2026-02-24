import { drainConnections, runMigrations } from "./db";

async function main(): Promise<void> {
  try {
    console.log("[migrate] Running database migrations...");
    await runMigrations();
    console.log("[migrate] Migrations completed successfully");
  } finally {
    await drainConnections();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[migrate] Migration failed:", error);
    process.exit(1);
  });
