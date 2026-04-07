import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConnectorRegistry } from "../integrations/kernel/connectorRegistry";
import { CredentialVault } from "../integrations/kernel/credentialVault";
import { gmailManifest } from "../integrations/connectors/gmail/manifest";
import { googledriveManifest } from "../integrations/connectors/google-drive/manifest";
import { googlecalendarManifest } from "../integrations/connectors/google-calendar/manifest";
import type { ConnectorManifest, OAuthConfig } from "../integrations/kernel/types";

const GOOGLE_CONNECTORS = [gmailManifest, googledriveManifest, googlecalendarManifest];

describe("Connector OAuth system", () => {
  // ── Manifest validation ──────────────────────────────────────────

  describe("manifest validation", () => {
    it("all Google connectors use real Google OAuth authorization URLs", () => {
      for (const manifest of GOOGLE_CONNECTORS) {
        const oauth = manifest.authConfig as OAuthConfig;
        expect(oauth.authorizationUrl).toBe(
          "https://accounts.google.com/o/oauth2/v2/auth",
        );
        expect(oauth.tokenUrl).toBe("https://oauth2.googleapis.com/token");
      }
    });

    it("all Google connectors declare providerId: google", () => {
      for (const manifest of GOOGLE_CONNECTORS) {
        expect(manifest.providerId).toBe("google");
      }
    });

    it("all Google connectors use real googleapis.com scopes (no placeholders)", () => {
      for (const manifest of GOOGLE_CONNECTORS) {
        const oauth = manifest.authConfig as OAuthConfig;
        expect(oauth.scopes.length).toBeGreaterThan(0);
        for (const scope of oauth.scopes) {
          expect(scope).toMatch(/^https:\/\/www\.googleapis\.com\/auth\//);
        }
      }
    });

    it("all Google connectors require GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars", () => {
      for (const manifest of GOOGLE_CONNECTORS) {
        expect(manifest.requiredEnvVars).toContain("GOOGLE_CLIENT_ID");
        expect(manifest.requiredEnvVars).toContain("GOOGLE_CLIENT_SECRET");
      }
    });

    it("capabilities define input schemas with type: object", () => {
      for (const manifest of GOOGLE_CONNECTORS) {
        for (const cap of manifest.capabilities) {
          expect(cap.inputSchema.type).toBe("object");
          expect(cap.inputSchema.properties).toBeDefined();
          expect(cap.operationId).toBeTruthy();
          expect(cap.description.length).toBeGreaterThan(0);
        }
      }
    });
  });

  // ── ConnectorRegistry scope merging ──────────────────────────────

  describe("OAuth scope merging across same providerId", () => {
    it("merges scopes from all Google connectors sharing providerId", () => {
      const registry = new ConnectorRegistry();
      for (const manifest of GOOGLE_CONNECTORS) {
        registry.register(manifest);
      }

      // Simulate what connectorOAuthRouter does: collect scopes from all
      // connectors with the same providerId.
      const gmailOAuth = gmailManifest.authConfig as OAuthConfig;
      const mergedScopes = new Set(gmailOAuth.scopes);

      for (const m of registry.listEnabled()) {
        if (
          m.providerId === "google" &&
          m.connectorId !== "gmail" &&
          m.authConfig &&
          "scopes" in m.authConfig
        ) {
          for (const s of (m.authConfig as OAuthConfig).scopes) {
            mergedScopes.add(s);
          }
        }
      }

      // Should include scopes from all three connectors
      const allExpected = [
        ...gmailOAuth.scopes,
        ...(googledriveManifest.authConfig as OAuthConfig).scopes,
        ...(googlecalendarManifest.authConfig as OAuthConfig).scopes,
      ];
      for (const scope of allExpected) {
        expect(mergedScopes.has(scope)).toBe(true);
      }
      // Verify dedup: total unique scopes < sum of all scopes (or equal if no overlap)
      expect(mergedScopes.size).toBeLessThanOrEqual(allExpected.length);
      expect(mergedScopes.size).toBeGreaterThanOrEqual(3);
    });
  });

  // ── Client ID/Secret env resolution ──────────────────────────────

  describe("client ID/secret env resolution", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("falls back to GOOGLE_CLIENT_ID for Google-family connectors", async () => {
      // The getClientId helper in connectorOAuthRouter checks:
      //   1. {CONNECTOR_PREFIX}_CLIENT_ID
      //   2. {PROVIDER_PREFIX}_CLIENT_ID
      //   3. GOOGLE_CLIENT_ID (for providerId === "google")
      // We verify the env var naming convention used by the manifests.
      process.env.GOOGLE_CLIENT_ID = "test-google-id";
      process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";

      // Remove connector-specific env vars so fallback triggers
      delete process.env.GMAIL_CLIENT_ID;
      delete process.env.GOOGLE_DRIVE_CLIENT_ID;
      delete process.env.GOOGLE_CALENDAR_CLIENT_ID;

      // Simulate the normalizeEnvPrefix + lookup logic from the router
      function normalizeEnvPrefix(value: string): string {
        return String(value || "")
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "");
      }

      function getClientId(connectorId: string, providerId?: string): string {
        const connectorPrefix = normalizeEnvPrefix(connectorId);
        const providerPrefix = providerId ? normalizeEnvPrefix(providerId) : "";
        return (
          process.env[`${connectorPrefix}_CLIENT_ID`] ||
          (providerPrefix ? process.env[`${providerPrefix}_CLIENT_ID`] : "") ||
          (providerId === "google" ? process.env.GOOGLE_CLIENT_ID : "") ||
          ""
        );
      }

      for (const manifest of GOOGLE_CONNECTORS) {
        const id = getClientId(manifest.connectorId, manifest.providerId);
        expect(id).toBe("test-google-id");
      }
    });
  });

  // ── CredentialVault encryption round-trip ─────────────────────────

  describe("CredentialVault encryption", () => {
    it("encrypts and decrypts tokens symmetrically", () => {
      const vault = new CredentialVault();
      const token = "ya29.a0AfB_byC-test-access-token";

      const encrypted = vault.encrypt(token);
      expect(encrypted).not.toBe(token);
      expect(encrypted).toContain(":"); // "iv:tag:ciphertext" format

      const decrypted = vault.decrypt(encrypted);
      expect(decrypted).toBe(token);
    });

    it("returns non-encrypted strings unchanged from decrypt", () => {
      const vault = new CredentialVault();
      const plain = "plain-api-key-no-colons";
      expect(vault.decrypt(plain)).toBe(plain);
    });
  });

  // ── ConnectorRegistry lookup ──────────────────────────────────────

  describe("ConnectorRegistry connector-tool resolution", () => {
    it("resolves connectorId from a capability operationId", () => {
      const registry = new ConnectorRegistry();
      for (const manifest of GOOGLE_CONNECTORS) {
        registry.register(manifest);
      }

      expect(registry.isConnectorTool("gmail_search")).toBe(true);
      expect(registry.resolveConnectorId("gmail_search")).toBe("gmail");
      expect(registry.resolveConnectorId("google_drive_search")).toBe("google-drive");
      expect(registry.resolveConnectorId("google_calendar_list_events")).toBe(
        "google-calendar",
      );
      expect(registry.isConnectorTool("nonexistent_tool")).toBe(false);
    });
  });
});
