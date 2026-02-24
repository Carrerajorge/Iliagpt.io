import express, { type Express } from "express";
import fs from "fs";
import path from "path";

const SW_CLEANUP_VERSION_PATTERN = /var APP_VERSION = '([^']*)';/;

function sanitizeAppVersion(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Keep the version safe to embed in a JS string literal.
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

  // Serve the SW cleanup script with a runtime APP_VERSION to ensure deploy verification
  // and client cache busting always reflect the actual container version.
  // This avoids incidents where the frontend build bakes "dev" while the server reports
  // the correct deployed SHA via APP_VERSION.
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

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (req, res, next) => {
    // If the request is for an asset that does not exist, do NOT serve index.html.
    // Serving index.html for missing JS chunks causes "MIME type text/html" errors
    // and prevents the frontend's ChunkLoadError recovery from triggering.
    if (req.originalUrl.startsWith("/assets/")) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
