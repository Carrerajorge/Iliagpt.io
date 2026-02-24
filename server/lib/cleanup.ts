import fs from "fs/promises";
import path from "path";
import { Logger } from "./logger";

const CLEANUP_DIRS = ["uploads", "artifacts", "uploads/temp"];
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 horas

async function cleanupDirectory(dirPath: string) {
  try {
    const fullPath = path.resolve(process.cwd(), dirPath);

    // Check if dir exists
    try {
      await fs.access(fullPath);
    } catch {
      return; // Dir doesn't exist, skip
    }

    const files = await fs.readdir(fullPath);
    const now = Date.now();
    let deletedCount = 0;
    let deletedDirs = 0;

    for (const file of files) {
      if (file === ".gitkeep") continue;

      const filePath = path.join(fullPath, file);
      try {
        const stats = await fs.stat(filePath);
        if (now - stats.mtimeMs > MAX_AGE_MS) {
          // Es viejo, borrar
          if (stats.isDirectory()) {
            await fs.rm(filePath, { recursive: true, force: true });
            deletedDirs++;
          } else {
            await fs.unlink(filePath);
            deletedCount++;
          }
        }
      } catch (err) {
        console.error(`Error processing file ${filePath}:`, err);
      }
    }

    if (deletedCount > 0 || deletedDirs > 0) {
      Logger.info(`[Cleanup] Deleted ${deletedCount} old files and ${deletedDirs} old directories from ${dirPath}`);
    }
  } catch (error) {
    Logger.error(`[Cleanup] Failed to cleanup ${dirPath}:`, error);
  }
}

export async function runCleanup() {
  Logger.info("[Cleanup] Starting daily cleanup...");
  for (const dir of CLEANUP_DIRS) {
    await cleanupDirectory(dir);
  }
  Logger.info("[Cleanup] Finished.");
}

// Si se ejecuta directamente (ESM-compatible)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runCleanup().catch(console.error);
}
