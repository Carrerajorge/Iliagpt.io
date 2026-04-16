import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let cachedLocalUploadsDir: string | null = null;

function getCandidateUploadDirs(): string[] {
  const configuredDir = process.env.LOCAL_UPLOADS_DIR?.trim();
  const candidates = [
    configuredDir,
    path.resolve(process.cwd(), "uploads"),
    path.resolve(os.homedir(), ".iliagpt", "uploads"),
    path.resolve(os.tmpdir(), "iliagpt", "uploads"),
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(candidates.map((candidate) => path.resolve(candidate))));
}

function canUseUploadsDir(candidate: string): boolean {
  try {
    fs.mkdirSync(candidate, { recursive: true, mode: 0o750 });
    fs.accessSync(candidate, fs.constants.R_OK | fs.constants.W_OK);

    const probePath = path.join(
      candidate,
      `.upload-probe-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    fs.writeFileSync(probePath, "ok", { mode: 0o600 });
    fs.unlinkSync(probePath);
    return true;
  } catch {
    return false;
  }
}

export function getLocalUploadsDir(): string {
  if (cachedLocalUploadsDir) {
    return cachedLocalUploadsDir;
  }

  for (const candidate of getCandidateUploadDirs()) {
    if (canUseUploadsDir(candidate)) {
      cachedLocalUploadsDir = candidate;
      return candidate;
    }
  }

  throw new Error("No writable local uploads directory is available");
}

export function getLocalObjectStorageDir(): string {
  return path.join(getLocalUploadsDir(), "objects");
}

export function resolveLocalUploadPath(objectId: string): string {
  return path.resolve(getLocalUploadsDir(), objectId);
}

export function resolveLocalUploadCandidates(storagePath: string): string[] {
  const uploadsDir = getLocalUploadsDir();
  const candidates: string[] = [];

  if (storagePath.startsWith("/objects/uploads/")) {
    candidates.push(path.resolve(uploadsDir, storagePath.replace("/objects/uploads/", "")));
  }
  if (storagePath.startsWith("/objects/")) {
    candidates.push(path.resolve(uploadsDir, storagePath.replace("/objects/", "")));
  }

  return Array.from(new Set(candidates)).filter((candidate) =>
    isPathWithinLocalUploadsDir(candidate, uploadsDir),
  );
}

export function isPathWithinLocalUploadsDir(candidatePath: string, uploadsDir: string = getLocalUploadsDir()): boolean {
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedUploadsDir = path.resolve(uploadsDir);
  return (
    resolvedCandidate === resolvedUploadsDir ||
    resolvedCandidate.startsWith(`${resolvedUploadsDir}${path.sep}`)
  );
}

export function resetLocalUploadsDirForTests(): void {
  cachedLocalUploadsDir = null;
}
