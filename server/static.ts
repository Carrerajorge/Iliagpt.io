import express, { type Express } from "express";
import fs from "fs";
import path from "path";

const SW_CLEANUP_VERSION_PATTERN = /var APP_VERSION = '([^']*)';/;

function sanitizeAppVersion(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const safe = trimmed.replace(/[^A-Za-z0-9._-]/g, "");
  return safe || null;
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.get("/sw-cleanup.js", (_req, res) => {
    const runtimeVersion =
      sanitizeAppVersion(process.env.APP_VERSION) ??
      sanitizeAppVersion(process.env.VITE_APP_VERSION) ??
      "dev";

    const distSwCleanupPath = path.join(distPath, "sw-cleanup.js");
    const fallbackSwCleanupPath = path.resolve(
      process.cwd(),
      "client",
      "public",
      "sw-cleanup.js",
    );

    let src: string;
    try {
      src = fs.readFileSync(distSwCleanupPath, "utf-8");
    } catch {
      src = fs.readFileSync(fallbackSwCleanupPath, "utf-8");
    }

    const body = src.replace(
      SW_CLEANUP_VERSION_PATTERN,
      `var APP_VERSION = '${runtimeVersion}';`,
    );

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.send(body);
  });

  app.use("/assets", express.static(path.join(distPath, "assets"), {
    maxAge: "1y",
    immutable: true,
    etag: true,
    lastModified: false,
  }));

  app.use(express.static(distPath, {
    maxAge: 0,
    etag: true,
    index: false,
  }));

  app.use("*", (req, res, next) => {
    if (req.originalUrl.startsWith("/assets/")) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
