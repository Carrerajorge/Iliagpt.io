import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const NATIVE_SESSION_ROOT = "iliagpt-openclaw-native";
const WORKSPACE_ROOT = "iliagpt-openclaw-workspaces";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

async function cleanupDirectory(baseDir: string, maxAgeMs: number): Promise<number> {
  let cleanedCount = 0;
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const now = Date.now();

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const dirPath = path.join(baseDir, entry.name);
      try {
        const stats = await fs.stat(dirPath);
        if (now - stats.mtimeMs > maxAgeMs) {
          await fs.rm(dirPath, { recursive: true, force: true });
          cleanedCount++;
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          console.warn(`[WorkspaceGC] Error checking/removing ${dirPath}:`, err.message);
        }
      }
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      console.warn(`[WorkspaceGC] Error reading base directory ${baseDir}:`, err.message);
    }
  }
  return cleanedCount;
}

export async function runWorkspaceGarbageCollector(): Promise<void> {
  const tmpDir = os.tmpdir();
  
  const customWorkspaceRoot = process.env.OPENCLAW_WORKSPACE_ROOT?.trim()
    ? path.resolve(process.env.OPENCLAW_WORKSPACE_ROOT)
    : path.join(tmpDir, WORKSPACE_ROOT);

  const nativeRoot = path.join(tmpDir, NATIVE_SESSION_ROOT);

  const [workspacesCleaned, sessionsCleaned] = await Promise.all([
    cleanupDirectory(customWorkspaceRoot, MAX_AGE_MS),
    cleanupDirectory(nativeRoot, MAX_AGE_MS)
  ]);

  if (workspacesCleaned > 0 || sessionsCleaned > 0) {
    console.log(`[WorkspaceGC] Swept ${workspacesCleaned} stale workspaces and ${sessionsCleaned} stale native sessions.`);
  }
}
