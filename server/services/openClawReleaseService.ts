import path from "node:path";
import { readFile } from "node:fs/promises";
import { DEFAULT_OPENCLAW_RELEASE_TAG } from "@shared/openclawRelease";
import {
  resolveEmbeddedOpenClawPackageJsonPathSync,
  type OpenClawEmbeddedResolveOptions,
} from "./openClawEmbeddedAssets";

const OPENCLAW_OWNER = "openclaw";
const OPENCLAW_REPO = "openclaw";
const OPENCLAW_RELEASE_REFRESH_MINUTES = 15;
export { DEFAULT_OPENCLAW_RELEASE_TAG };

type OpenClawReleaseInfo = {
  tagName: string;
  name: string;
  htmlUrl: string;
  tarballUrl: string | null;
  zipballUrl: string | null;
  publishedAt: string | null;
  overview: string;
  importantNotes: string[];
  highlights: string[];
  notes: string;
  reactionCount: number;
  isLatest: boolean;
};

type EmbeddedOpenClawMetadata = {
  packageRoot: string;
  packageVersion: string | null;
  repositoryUrl: string;
  changelogSections: Map<string, string>;
};

function normalizeReleaseVersion(value: string): string {
  return value.trim().replace(/^v/i, "");
}

function normalizeReleaseTag(value: string): string {
  const normalized = normalizeReleaseVersion(value);
  return normalized ? `v${normalized}` : DEFAULT_OPENCLAW_RELEASE_TAG;
}

function stripMarkdown(value: string): string {
  return value
    .replace(/^#+\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function extractOverview(body: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((entry) => stripMarkdown(entry))
    .filter(Boolean);
  return paragraphs[0] || "Sin resumen disponible para esta release.";
}

function extractHighlights(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => stripMarkdown(line.replace(/^[-*]\s+/, "")))
    .filter(Boolean)
    .slice(0, 6);
}

function extractImportantNotes(body: string): string[] {
  const collected = new Set<string>();
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trimEnd());

  let currentSection = "";
  for (const line of lines) {
    const headingMatch = line.match(/^###\s+(.+)$/);
    if (headingMatch) {
      currentSection = headingMatch[1].trim().toLowerCase();
      continue;
    }

    if (!/^[-*]\s+/.test(line)) {
      continue;
    }

    if (
      currentSection.includes("breaking") ||
      currentSection.includes("security") ||
      currentSection.includes("fix")
    ) {
      collected.add(stripMarkdown(line.replace(/^[-*]\s+/, "")));
    }
  }

  if (collected.size > 0) {
    return [...collected].filter(Boolean).slice(0, 3);
  }

  return body
    .split(/\r?\n/)
    .map((line) => stripMarkdown(line))
    .filter(Boolean)
    .filter((line) => /important|note|breaking|compat|security/i.test(line))
    .slice(0, 3);
}

function extractRepositoryUrl(
  repository: unknown,
  homepage: unknown,
): string {
  const rawValue =
    typeof repository === "string"
      ? repository
      : repository && typeof repository === "object" && typeof (repository as { url?: unknown }).url === "string"
        ? (repository as { url: string }).url
        : typeof homepage === "string"
          ? homepage
          : `https://github.com/${OPENCLAW_OWNER}/${OPENCLAW_REPO}`;

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return `https://github.com/${OPENCLAW_OWNER}/${OPENCLAW_REPO}`;
  }

  return trimmed
    .replace(/^git\+/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
}

function parseChangelogSections(changelog: string): Map<string, string> {
  const sections = new Map<string, string>();
  const headingMatches = [...changelog.matchAll(/^##\s+(.+)$/gm)];

  for (let index = 0; index < headingMatches.length; index += 1) {
    const current = headingMatches[index];
    const heading = current[1]?.trim() || "";
    if (!/^\d{4}\.\d+\.\d+(?:[-.][A-Za-z0-9]+)*$/.test(heading)) {
      continue;
    }

    const start = (current.index ?? 0) + current[0].length;
    const end = index + 1 < headingMatches.length
      ? headingMatches[index + 1].index ?? changelog.length
      : changelog.length;
    sections.set(normalizeReleaseVersion(heading), changelog.slice(start, end).trim());
  }

  return sections;
}

async function loadEmbeddedOpenClawMetadata(
  resolveOptions: OpenClawEmbeddedResolveOptions = {},
): Promise<EmbeddedOpenClawMetadata | null> {
  const packageJsonPath = resolveEmbeddedOpenClawPackageJsonPathSync(resolveOptions);
  if (!packageJsonPath) {
    return null;
  }

  const packageRoot = path.dirname(packageJsonPath);

  try {
    const [packageJsonRaw, changelogRaw] = await Promise.all([
      readFile(packageJsonPath, "utf8"),
      readFile(path.join(packageRoot, "CHANGELOG.md"), "utf8").catch(() => ""),
    ]);

    const parsed = JSON.parse(packageJsonRaw) as {
      version?: string;
      repository?: unknown;
      homepage?: unknown;
    };

    return {
      packageRoot,
      packageVersion:
        typeof parsed.version === "string" && parsed.version.trim()
          ? parsed.version.trim()
          : null,
      repositoryUrl: extractRepositoryUrl(parsed.repository, parsed.homepage),
      changelogSections: parseChangelogSections(changelogRaw),
    };
  } catch {
    return null;
  }
}

function toEmbeddedReleaseInfo(params: {
  version: string;
  notes: string;
  repositoryUrl: string;
  isLatest: boolean;
}): OpenClawReleaseInfo {
  const tagName = normalizeReleaseTag(params.version);
  return {
    tagName,
    name: `openclaw ${normalizeReleaseVersion(tagName)}`,
    htmlUrl: `${params.repositoryUrl}/releases/tag/${tagName}`,
    tarballUrl: null,
    zipballUrl: null,
    publishedAt: null,
    overview: extractOverview(params.notes),
    importantNotes: extractImportantNotes(params.notes),
    highlights: extractHighlights(params.notes),
    notes: params.notes,
    reactionCount: 0,
    isLatest: params.isLatest,
  };
}

function resolveRequestedRelease(
  requestedTag: string,
  metadata: EmbeddedOpenClawMetadata,
): OpenClawReleaseInfo | null {
  const requestedVersion = normalizeReleaseVersion(requestedTag);
  const requestedNotes = metadata.changelogSections.get(requestedVersion);

  if (requestedNotes != null) {
    return toEmbeddedReleaseInfo({
      version: requestedVersion,
      notes: requestedNotes,
      repositoryUrl: metadata.repositoryUrl,
      isLatest: metadata.packageVersion === requestedVersion,
    });
  }

  if (metadata.packageVersion === requestedVersion) {
    return toEmbeddedReleaseInfo({
      version: requestedVersion,
      notes: "",
      repositoryUrl: metadata.repositoryUrl,
      isLatest: true,
    });
  }

  return null;
}

function resolveLatestRelease(
  metadata: EmbeddedOpenClawMetadata,
): OpenClawReleaseInfo | null {
  if (!metadata.packageVersion) {
    return null;
  }

  return toEmbeddedReleaseInfo({
    version: metadata.packageVersion,
    notes: metadata.changelogSections.get(metadata.packageVersion) || "",
    repositoryUrl: metadata.repositoryUrl,
    isLatest: true,
  });
}

export async function getOpenClawReleaseSnapshot(
  tag: string,
  resolveOptions: OpenClawEmbeddedResolveOptions = {},
): Promise<{
  requestedTag: string;
  syncedAt: string;
  bundled: {
    version: string | null;
    matchesRequested: boolean;
  };
  requestedRelease: OpenClawReleaseInfo | null;
  latestRelease: OpenClawReleaseInfo | null;
  sync: {
    status: "synced" | "update_available" | "tracking_requested" | "offline";
    summary: string;
    autoRefreshMinutes: number;
    latestMatchesRequested: boolean;
  };
  errors: string[];
}> {
  const requestedTag = normalizeReleaseTag(tag.trim() || DEFAULT_OPENCLAW_RELEASE_TAG);
  const metadata = await loadEmbeddedOpenClawMetadata(resolveOptions);

  if (!metadata) {
    return {
      requestedTag,
      syncedAt: new Date().toISOString(),
      bundled: {
        version: null,
        matchesRequested: false,
      },
      requestedRelease: null,
      latestRelease: null,
      sync: {
        status: "offline",
        summary:
          "No se pudo leer el OpenClaw embebido en esta build. La referencia nativa no está disponible.",
        autoRefreshMinutes: OPENCLAW_RELEASE_REFRESH_MINUTES,
        latestMatchesRequested: false,
      },
      errors: ["Embedded OpenClaw package could not be resolved."],
    };
  }

  const requestedRelease = resolveRequestedRelease(requestedTag, metadata);
  const latestRelease = resolveLatestRelease(metadata);
  const bundledMatchesRequested =
    metadata.packageVersion != null &&
    normalizeReleaseVersion(requestedTag) === metadata.packageVersion;
  const latestMatchesRequested = Boolean(
    requestedRelease &&
      latestRelease &&
      requestedRelease.tagName === latestRelease.tagName,
  );

  let status: "synced" | "update_available" | "tracking_requested" | "offline" = "offline";
  let summary =
    "No se pudo resolver la release nativa embebida de OpenClaw.";
  const errors: string[] = [];

  if (requestedRelease && latestRelease && latestMatchesRequested) {
    status = "synced";
    summary = `OpenClaw ${requestedRelease.tagName} está integrado nativamente en esta build.`;
  } else if (requestedRelease && latestRelease) {
    status = "update_available";
    summary = `Esta build integra OpenClaw ${latestRelease.tagName}; la referencia solicitada ${requestedRelease.tagName} queda documentada en el changelog embebido.`;
  } else if (latestRelease) {
    status = bundledMatchesRequested ? "synced" : "tracking_requested";
    summary = bundledMatchesRequested
      ? `OpenClaw ${latestRelease.tagName} está integrado nativamente en esta build.`
      : `ILIAGPT integra OpenClaw ${latestRelease.tagName} nativamente; la tag solicitada ${requestedTag} no está disponible en el changelog embebido.`;

    if (!bundledMatchesRequested) {
      errors.push(
        `Requested release ${requestedTag} is not present in the embedded OpenClaw changelog.`,
      );
    }
  }

  return {
    requestedTag,
    syncedAt: new Date().toISOString(),
    bundled: {
      version: metadata.packageVersion,
      matchesRequested: bundledMatchesRequested,
    },
    requestedRelease,
    latestRelease,
    sync: {
      status,
      summary,
      autoRefreshMinutes: OPENCLAW_RELEASE_REFRESH_MINUTES,
      latestMatchesRequested,
    },
    errors,
  };
}
