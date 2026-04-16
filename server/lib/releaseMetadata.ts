import fs from "fs";
import path from "path";

export interface ReleaseManifest {
  app_version: string;
  app_sha: string;
  image_tag: string | null;
  package_version: string;
  built_at: string | null;
}

export interface RuntimeReleaseMetadata extends ReleaseManifest {
  source: "manifest" | "env";
}

let cachedManifest: ReleaseManifest | null | undefined;
let cachedPackageVersion: string | null | undefined;

function sanitizeReleaseValue(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed || null;
}

function getManifestCandidates(env: NodeJS.ProcessEnv): string[] {
  const candidates = [
    sanitizeReleaseValue(env.RELEASE_MANIFEST_PATH),
    path.resolve(process.cwd(), "dist", "release-manifest.json"),
    path.resolve(process.cwd(), "release-manifest.json"),
    path.resolve(import.meta.dirname, "release-manifest.json"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return Array.from(new Set(candidates));
}

function readReleaseManifest(env: NodeJS.ProcessEnv): ReleaseManifest | null {
  if (cachedManifest !== undefined) {
    return cachedManifest;
  }

  for (const candidate of getManifestCandidates(env)) {
    try {
      const raw = fs.readFileSync(candidate, "utf-8");
      const parsed = JSON.parse(raw) as Partial<ReleaseManifest>;
      cachedManifest = {
        app_version: sanitizeReleaseValue(parsed.app_version) ?? "unknown",
        app_sha: sanitizeReleaseValue(parsed.app_sha) ?? sanitizeReleaseValue(parsed.app_version) ?? "unknown",
        image_tag: sanitizeReleaseValue(parsed.image_tag),
        package_version: sanitizeReleaseValue(parsed.package_version) ?? "unknown",
        built_at: sanitizeReleaseValue(parsed.built_at),
      };
      return cachedManifest;
    } catch {
      continue;
    }
  }

  cachedManifest = null;
  return cachedManifest;
}

function readPackageVersionFallback(): string | null {
  if (cachedPackageVersion !== undefined) {
    return cachedPackageVersion;
  }

  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    cachedPackageVersion = sanitizeReleaseValue(parsed.version);
  } catch {
    cachedPackageVersion = null;
  }

  return cachedPackageVersion;
}

export function getReleaseMetadata(env: NodeJS.ProcessEnv = process.env): RuntimeReleaseMetadata {
  const manifest = readReleaseManifest(env);
  const appVersion =
    sanitizeReleaseValue(manifest?.app_version) ??
    sanitizeReleaseValue(env.APP_VERSION) ??
    sanitizeReleaseValue(env.VITE_APP_VERSION) ??
    sanitizeReleaseValue(env.npm_package_version) ??
    "unknown";

  return {
    app_version: appVersion,
    app_sha:
      sanitizeReleaseValue(manifest?.app_sha) ??
      sanitizeReleaseValue(env.APP_SHA) ??
      sanitizeReleaseValue(env.GITHUB_SHA) ??
      appVersion,
    image_tag:
      sanitizeReleaseValue(manifest?.image_tag) ??
      sanitizeReleaseValue(env.IMAGE_TAG),
    package_version:
      sanitizeReleaseValue(manifest?.package_version) ??
      sanitizeReleaseValue(env.npm_package_version) ??
      readPackageVersionFallback() ??
      "unknown",
    built_at:
      sanitizeReleaseValue(manifest?.built_at) ??
      sanitizeReleaseValue(env.BUILD_TIMESTAMP),
    source: manifest ? "manifest" : "env",
  };
}

export function clearReleaseMetadataCacheForTests() {
  cachedManifest = undefined;
  cachedPackageVersion = undefined;
}
