/**
 * ManifestLoader — Discovers and loads connector manifests at startup.
 *
 * Scans the connectors/ directory for manifest files, registers them in the
 * ConnectorRegistry, and optionally persists to the DB for auditing.
 */

import { connectorRegistry } from "./connectorRegistry";
import type { ConnectorManifest } from "./types";
import path from "path";
import fs from "fs/promises";

const CONNECTORS_DIR = path.resolve(import.meta.dirname || __dirname, "../connectors");
let initPromise: Promise<void> | null = null;

/** Load all connector manifests from the connectors directory */
export async function loadAllConnectorManifests(): Promise<ConnectorManifest[]> {
  const manifests: ConnectorManifest[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(CONNECTORS_DIR);
  } catch {
    console.log("[ManifestLoader] No connectors directory found — skipping");
    return manifests;
  }

  for (const entry of entries) {
    const connectorDir = path.join(CONNECTORS_DIR, entry);
    const stat = await fs.stat(connectorDir).catch(() => null);
    if (!stat?.isDirectory()) continue;

    // Try to import the manifest
    try {
      const manifestPath = path.join(connectorDir, "manifest.ts");
      const manifestJsPath = path.join(connectorDir, "manifest.js");

      let manifestModule: { manifest?: ConnectorManifest; default?: ConnectorManifest } | null = null;

      // Check if manifest file exists
      const tsExists = await fs.access(manifestPath).then(() => true).catch(() => false);
      const jsExists = await fs.access(manifestJsPath).then(() => true).catch(() => false);

      if (tsExists || jsExists) {
        const importPath = tsExists ? manifestPath : manifestJsPath;
        manifestModule = await import(importPath);
      }

      if (!manifestModule) {
        // Try index.ts as fallback
        const indexPath = path.join(connectorDir, "index.ts");
        const indexJsPath = path.join(connectorDir, "index.js");
        const idxTsExists = await fs.access(indexPath).then(() => true).catch(() => false);
        const idxJsExists = await fs.access(indexJsPath).then(() => true).catch(() => false);
        if (idxTsExists || idxJsExists) {
          manifestModule = await import(idxTsExists ? indexPath : indexJsPath);
        }
      }

      if (!manifestModule) continue;

      const manifest =
        manifestModule.manifest ||
        manifestModule.default ||
        Object.values(manifestModule).find((value) => {
          if (!value || typeof value !== "object") return false;
          const candidate = value as Partial<ConnectorManifest>;
          return typeof candidate.connectorId === "string" && candidate.connectorId.trim().length > 0;
        });
      if (!manifest || !manifest.connectorId) {
        console.warn(`[ManifestLoader] Skipping ${entry} — no valid manifest export`);
        continue;
      }

      // Validate required env vars
      const missingEnvVars = (manifest.requiredEnvVars || []).filter(
        (v) => !process.env[v]
      );
      if (missingEnvVars.length > 0) {
        console.warn(
          `[ManifestLoader] ${manifest.connectorId}: missing env vars: ${missingEnvVars.join(", ")} — registering anyway`
        );
      }

      manifests.push(manifest);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ManifestLoader] Failed to load connector "${entry}": ${msg}`);
    }
  }

  return manifests;
}

/** Initialize: load manifests → register in ConnectorRegistry → seed DB */
export async function initializeConnectorManifests(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const manifests = await loadAllConnectorManifests();

    for (const manifest of manifests) {
      connectorRegistry.register(manifest);
    }

    // Also register any connector handlers alongside manifests
    for (const manifest of manifests) {
      try {
        const handlerPath = path.join(CONNECTORS_DIR, manifest.connectorId, "handler.ts");
        const handlerJsPath = path.join(CONNECTORS_DIR, manifest.connectorId, "handler.js");

        const tsExists = await fs.access(handlerPath).then(() => true).catch(() => false);
        const jsExists = await fs.access(handlerJsPath).then(() => true).catch(() => false);

        if (tsExists || jsExists) {
          const handlerModule = await import(tsExists ? handlerPath : handlerJsPath);
          const handlerCandidates = [
            handlerModule.handler,
            handlerModule.default,
            ...Object.values(handlerModule),
          ];

          let resolvedHandler: any = null;
          for (const candidate of handlerCandidates) {
            if (!candidate) continue;

            if (typeof candidate === "function") {
              // Support createXHandler-style exports that return a handler object.
              try {
                const maybe = candidate();
                if (maybe && typeof maybe.execute === "function") {
                  resolvedHandler = maybe;
                  break;
                }
              } catch {
                // ignore
              }
              continue;
            }

            if (typeof candidate === "object" && typeof (candidate as any).execute === "function") {
              resolvedHandler = candidate;
              break;
            }
          }

          if (resolvedHandler) {
            connectorRegistry.registerHandler(manifest.connectorId, resolvedHandler);
            console.log(`[ManifestLoader] Handler registered: ${manifest.connectorId}`);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[ManifestLoader] Failed to load handler for "${manifest.connectorId}": ${msg}`);
      }
    }

    // Seed DB (best-effort — doesn't block startup)
    seedManifestsToDB(manifests).catch((err) => {
      console.warn(`[ManifestLoader] DB seed failed: ${err?.message || err}`);
    });

    console.log(`[ManifestLoader] Initialized ${manifests.length} connectors`);
  })().catch((err) => {
    // Allow retry if init fails (e.g. transient FS/DB issues in dev).
    initPromise = null;
    throw err;
  });

  return initPromise;
}

/** Best-effort: upsert manifests into the connector_manifests table */
async function seedManifestsToDB(manifests: ConnectorManifest[]): Promise<void> {
  if (manifests.length === 0) return;

  try {
    const { db } = await import("../../db");
    const { connectorManifests } = await import("../../../shared/schema/integration");

    for (const manifest of manifests) {
      await db
        .insert(connectorManifests)
        .values({
          connectorId: manifest.connectorId,
          version: manifest.version,
          displayName: manifest.displayName,
          category: manifest.category,
          authType: manifest.authType,
          manifest: manifest as unknown as Record<string, unknown>,
          isEnabled: "true",
          capabilityCount: manifest.capabilities.length,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: connectorManifests.connectorId,
          set: {
            version: manifest.version,
            displayName: manifest.displayName,
            category: manifest.category,
            authType: manifest.authType,
            manifest: manifest as unknown as Record<string, unknown>,
            capabilityCount: manifest.capabilities.length,
            updatedAt: new Date(),
          },
        })
        .catch(() => {
          // Table might not exist yet — that's OK
        });
    }
  } catch {
    // DB not available yet — skip silently
  }
}
