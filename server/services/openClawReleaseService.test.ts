import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_OPENCLAW_RELEASE_TAG, OPENCLAW_RELEASE_VERSION } from "@shared/openclawRelease";
import { getOpenClawReleaseSnapshot } from "./openClawReleaseService";

async function withTempEmbeddedOpenClaw<T>(fn: (root: string) => Promise<T>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "iliagpt-openclaw-release-"));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("getOpenClawReleaseSnapshot", () => {
  it("reads the embedded release snapshot without calling GitHub APIs", async () => {
    await withTempEmbeddedOpenClaw(async (root) => {
      const appRoot = path.join(root, "app");
      const packageRoot = path.join(appRoot, "server", "openclaw");

      await fs.mkdir(packageRoot, { recursive: true });
      await fs.writeFile(
        path.join(packageRoot, "package.json"),
        JSON.stringify(
          {
            name: "openclaw",
            version: OPENCLAW_RELEASE_VERSION,
            repository: {
              type: "git",
              url: "git+https://github.com/openclaw/openclaw.git",
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(
        path.join(packageRoot, "CHANGELOG.md"),
        `# Changelog

## Unreleased

## ${OPENCLAW_RELEASE_VERSION}

### Breaking

- Remove legacy extension relay.

### Changes

- Add native skill install flow.

### Fixes

- Harden exec approvals.

## 2026.3.13

### Changes

- Previous release notes.
`,
        "utf8",
      );

      const snapshot = await getOpenClawReleaseSnapshot(DEFAULT_OPENCLAW_RELEASE_TAG, {
        cwd: appRoot,
        argv1: path.join(appRoot, "dist", "index.mjs"),
      });

      expect(snapshot.bundled.version).toBe(OPENCLAW_RELEASE_VERSION);
      expect(snapshot.bundled.matchesRequested).toBe(true);
      expect(snapshot.requestedRelease?.tagName).toBe(DEFAULT_OPENCLAW_RELEASE_TAG);
      expect(snapshot.latestRelease?.tagName).toBe(DEFAULT_OPENCLAW_RELEASE_TAG);
      expect(snapshot.sync.status).toBe("synced");
      expect(snapshot.sync.latestMatchesRequested).toBe(true);
      expect(snapshot.requestedRelease?.highlights).toContain("Add native skill install flow.");
      expect(snapshot.requestedRelease?.importantNotes).toContain("Remove legacy extension relay.");
      expect(snapshot.errors).toEqual([]);
    });
  });

  it("reports the embedded bundled version when the requested tag is older", async () => {
    await withTempEmbeddedOpenClaw(async (root) => {
      const appRoot = path.join(root, "app");
      const packageRoot = path.join(appRoot, "server", "openclaw");

      await fs.mkdir(packageRoot, { recursive: true });
      await fs.writeFile(
        path.join(packageRoot, "package.json"),
        JSON.stringify({ name: "openclaw", version: OPENCLAW_RELEASE_VERSION }, null, 2),
        "utf8",
      );
      await fs.writeFile(
        path.join(packageRoot, "CHANGELOG.md"),
        `# Changelog

## ${OPENCLAW_RELEASE_VERSION}

### Changes

- Latest embedded release.

## 2026.3.13

### Changes

- Prior embedded release.
`,
        "utf8",
      );

      const snapshot = await getOpenClawReleaseSnapshot("v2026.3.13", {
        cwd: appRoot,
        argv1: path.join(appRoot, "dist", "index.mjs"),
      });

      expect(snapshot.bundled.version).toBe(OPENCLAW_RELEASE_VERSION);
      expect(snapshot.requestedRelease?.tagName).toBe("v2026.3.13");
      expect(snapshot.latestRelease?.tagName).toBe(DEFAULT_OPENCLAW_RELEASE_TAG);
      expect(snapshot.sync.status).toBe("update_available");
      expect(snapshot.sync.latestMatchesRequested).toBe(false);
    });
  });
});
