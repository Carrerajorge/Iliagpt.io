import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { OPENCLAW_RELEASE_VERSION } from "@shared/openclawRelease";
import {
  listEmbeddedOpenClawPackageRootCandidatesSync,
  resolveEmbeddedOpenClawControlUiRootSync,
  resolveEmbeddedOpenClawPackageJsonPathSync,
  resolveEmbeddedOpenClawPackageRootSync,
} from "./openClawEmbeddedAssets";

async function withTempDir<T>(fn: (root: string) => Promise<T>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "iliagpt-openclaw-embed-"));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeJson(filePath: string, payload: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload), "utf-8");
}

async function writeFile(filePath: string, contents = "") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf-8");
}

describe("openClawEmbeddedAssets", () => {
  it("resolves the embedded package root from server/openclaw under cwd", async () => {
    await withTempDir(async (root) => {
      const appRoot = path.join(root, "app");
      const packageRoot = path.join(appRoot, "server", "openclaw");
      await writeJson(path.join(packageRoot, "package.json"), {
        name: "openclaw",
        version: OPENCLAW_RELEASE_VERSION,
      });

      expect(resolveEmbeddedOpenClawPackageRootSync({ cwd: appRoot })).toBe(packageRoot);
      expect(resolveEmbeddedOpenClawPackageJsonPathSync({ cwd: appRoot })).toBe(
        path.join(packageRoot, "package.json"),
      );
    });
  });

  it("resolves the bundled control-ui from node_modules/@hola/openclaw beside dist", async () => {
    await withTempDir(async (root) => {
      const appRoot = path.join(root, "app");
      const packageRoot = path.join(appRoot, "node_modules", "@hola", "openclaw");
      const controlUiRoot = path.join(packageRoot, "dist", "control-ui");
      const moduleUrl = pathToFileURL(path.join(appRoot, "dist", "index.mjs")).toString();

      await writeJson(path.join(packageRoot, "package.json"), {
        name: "openclaw",
        version: OPENCLAW_RELEASE_VERSION,
      });
      await writeFile(path.join(controlUiRoot, "index.html"), "<html>ok</html>\n");

      expect(resolveEmbeddedOpenClawControlUiRootSync({ moduleUrl })).toBe(controlUiRoot);
    });
  });

  it("keeps sibling openclaw layouts in the candidate list for compiled runtimes", async () => {
    await withTempDir(async (root) => {
      const appRoot = path.join(root, "app");
      const moduleUrl = pathToFileURL(path.join(appRoot, "dist", "index.mjs")).toString();
      const candidates = listEmbeddedOpenClawPackageRootCandidatesSync({ moduleUrl });

      expect(candidates).toContain(path.join(appRoot, "openclaw"));
      expect(candidates).toContain(path.join(appRoot, "server", "openclaw"));
      expect(candidates).toContain(path.join(appRoot, "node_modules", "@hola", "openclaw"));
    });
  });
});
