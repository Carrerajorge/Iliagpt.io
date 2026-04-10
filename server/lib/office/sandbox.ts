/**
 * Per-run sandbox filesystem for Office Engine runs.
 *
 * Each run gets an isolated directory under $OFFICE_ENGINE_ROOT/<run_id>/
 * ($TMPDIR/office-engine by default). All read/write paths are resolved
 * against the sandbox root; any attempt to escape with ".." or an absolute
 * path is rejected with a PATH_ESCAPE error.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

export class SandboxPathEscapeError extends Error {
  constructor(relative: string, resolved: string) {
    super(`Sandbox path escape: "${relative}" resolved to "${resolved}"`);
    this.name = "SandboxPathEscapeError";
  }
}

export interface Sandbox {
  readonly runId: string;
  readonly root: string;
  resolve(relative: string): string;
  writeBinary(relative: string, data: Buffer): Promise<string>;
  writeText(relative: string, data: string): Promise<string>;
  readBinary(relative: string): Promise<Buffer>;
  readText(relative: string): Promise<string>;
  exists(relative: string): Promise<boolean>;
  mkdir(relative: string): Promise<string>;
  list(relative?: string): Promise<string[]>;
  dispose(): Promise<void>;
}

function getRoot(): string {
  const envRoot = process.env.OFFICE_ENGINE_ROOT;
  if (envRoot && envRoot.length > 0) return path.resolve(envRoot);
  return path.join(os.tmpdir(), "office-engine");
}

export async function createSandbox(runId: string): Promise<Sandbox> {
  // Basic runId hygiene — uuids only, plus dashes. Rejects traversal attempts.
  if (!/^[a-zA-Z0-9_\-]+$/.test(runId)) {
    throw new Error(`Invalid runId "${runId}": must match [a-zA-Z0-9_-]+`);
  }

  const root = path.join(getRoot(), runId);
  await fs.mkdir(root, { recursive: true });

  const resolve = (relative: string): string => {
    if (path.isAbsolute(relative)) {
      throw new SandboxPathEscapeError(relative, relative);
    }
    const joined = path.resolve(root, relative);
    const rel = path.relative(root, joined);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new SandboxPathEscapeError(relative, joined);
    }
    return joined;
  };

  const ensureParent = async (abs: string): Promise<void> => {
    await fs.mkdir(path.dirname(abs), { recursive: true });
  };

  const sandbox: Sandbox = {
    runId,
    root,
    resolve,
    async writeBinary(relative, data) {
      const abs = resolve(relative);
      await ensureParent(abs);
      await fs.writeFile(abs, data);
      return abs;
    },
    async writeText(relative, data) {
      const abs = resolve(relative);
      await ensureParent(abs);
      await fs.writeFile(abs, data, "utf8");
      return abs;
    },
    async readBinary(relative) {
      return fs.readFile(resolve(relative));
    },
    async readText(relative) {
      return fs.readFile(resolve(relative), "utf8");
    },
    async exists(relative) {
      try {
        await fs.stat(resolve(relative));
        return true;
      } catch {
        return false;
      }
    },
    async mkdir(relative) {
      const abs = resolve(relative);
      await fs.mkdir(abs, { recursive: true });
      return abs;
    },
    async list(relative = ".") {
      const abs = resolve(relative);
      try {
        return await fs.readdir(abs);
      } catch {
        return [];
      }
    },
    async dispose() {
      // Best-effort recursive cleanup. Never throws.
      try {
        await fs.rm(root, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };

  return sandbox;
}
