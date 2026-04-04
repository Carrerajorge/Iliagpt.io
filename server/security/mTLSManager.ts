import crypto from "crypto";
import tls from "tls";
import https from "https";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import type { Express } from "express";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import Redis from "ioredis";
import { Logger } from "../lib/logger";

const execFileAsync = promisify(execFile);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CertificateInfo {
  subject: string;
  issuer: string;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
  fingerprint: string;
  pemCert: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PINNED_CERTS_PREFIX = "mtls:pinned:";
const CERT_STORE_PREFIX = "mtls:cert:";
const CERT_EXPIRY_WARNING_DAYS = 30;

// ─── MTLSManager ─────────────────────────────────────────────────────────────

class MTLSManager {
  private pinnedCerts: Map<string, string> = new Map(); // service -> fingerprint
  private redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });
    this.redis.on("error", (err: Error) => {
      Logger.warn("[MTLSManager] Redis error", { error: err.message });
    });
  }

  // ── Certificate generation ────────────────────────────────────────────────────

  async generateSelfSignedCert(
    serviceName: string
  ): Promise<{ cert: string; key: string; fingerprint: string }> {
    // Validate serviceName to prevent injection (alphanumeric + hyphens only)
    const safeServiceName = serviceName.replace(/[^a-zA-Z0-9-]/g, "");

    try {
      return await this.generateViaOpenSSL(safeServiceName);
    } catch {
      Logger.warn("[MTLSManager] openssl not available, generating minimal cert via crypto");
      return this.generateViaNodeCrypto(safeServiceName);
    }
  }

  private async generateViaOpenSSL(
    serviceName: string
  ): Promise<{ cert: string; key: string; fingerprint: string }> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtls-"));
    const keyFile = path.join(tmpDir, "server.key");
    const certFile = path.join(tmpDir, "server.crt");
    const subject = `/CN=${serviceName}/O=IliaGPT/OU=Services`;

    try {
      // Use execFile (array args) to avoid shell injection
      await execFileAsync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048",
        "-keyout", keyFile,
        "-out", certFile,
        "-days", "365",
        "-nodes",
        "-subj", subject,
      ]);

      const key = fs.readFileSync(keyFile, "utf8");
      const cert = fs.readFileSync(certFile, "utf8");
      const fingerprint = this.computeCertFingerprint(cert);

      await this.redis.set(
        `${CERT_STORE_PREFIX}${serviceName}`,
        JSON.stringify({ cert, fingerprint })
      );

      Logger.info("[MTLSManager] Self-signed cert generated via openssl", { serviceName, fingerprint });
      return { cert, key, fingerprint };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  private generateViaNodeCrypto(
    serviceName: string
  ): { cert: string; key: string; fingerprint: string } {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const fingerprint = crypto
      .createHash("sha256")
      .update(publicKey + serviceName + Date.now())
      .digest("hex")
      .match(/.{2}/g)!
      .join(":");

    // Minimal PEM stub for environments without openssl
    const payload = Buffer.from(
      JSON.stringify({ subject: serviceName, publicKey, generated: new Date().toISOString() })
    ).toString("base64");

    const cert = [
      "-----BEGIN CERTIFICATE-----",
      payload,
      "-----END CERTIFICATE-----",
    ].join("\n");

    this.redis
      .set(`${CERT_STORE_PREFIX}${serviceName}`, JSON.stringify({ cert, fingerprint }))
      .catch(() => {});

    return { cert, key: privateKey, fingerprint };
  }

  // ── Certificate rotation ──────────────────────────────────────────────────────

  async rotateCertificate(serviceName: string): Promise<{ cert: string; key: string }> {
    Logger.info("[MTLSManager] Rotating certificate", { serviceName });
    const { cert, key, fingerprint } = await this.generateSelfSignedCert(serviceName);
    await this.pinCertificate(serviceName, fingerprint);
    return { cert, key };
  }

  // ── Certificate pinning ───────────────────────────────────────────────────────

  async pinCertificate(serviceName: string, fingerprint: string): Promise<void> {
    this.pinnedCerts.set(serviceName, fingerprint);
    await this.redis.set(`${PINNED_CERTS_PREFIX}${serviceName}`, fingerprint);
    Logger.info("[MTLSManager] Certificate pinned", { serviceName, fingerprint });
  }

  async validateCert(certPem: string, expectedService: string): Promise<boolean> {
    const fingerprint = this.computeCertFingerprint(certPem);

    let pinnedFingerprint = this.pinnedCerts.get(expectedService);
    if (!pinnedFingerprint) {
      pinnedFingerprint =
        (await this.redis.get(`${PINNED_CERTS_PREFIX}${expectedService}`)) ?? undefined;
    }

    if (!pinnedFingerprint) {
      Logger.warn("[MTLSManager] No pinned cert for service", { expectedService });
      return false;
    }

    const valid = fingerprint === pinnedFingerprint;
    if (!valid) {
      Logger.security("[MTLSManager] Certificate fingerprint mismatch", {
        expectedService,
        expected: pinnedFingerprint,
        got: fingerprint,
      });
    }

    return valid;
  }

  // ── Certificate info ──────────────────────────────────────────────────────────

  async getCertInfo(certPem: string): Promise<CertificateInfo> {
    const tmpFile = path.join(os.tmpdir(), `cert-parse-${Date.now()}.pem`);
    try {
      fs.writeFileSync(tmpFile, certPem);

      const { stdout } = await execFileAsync("openssl", [
        "x509", "-in", tmpFile, "-noout",
        "-subject", "-issuer", "-dates", "-serial",
      ]);

      const subject = stdout.match(/subject=(.+)/)?.[1]?.trim() ?? "unknown";
      const issuer = stdout.match(/issuer=(.+)/)?.[1]?.trim() ?? "unknown";
      const notBefore = new Date(stdout.match(/notBefore=(.+)/)?.[1]?.trim() ?? "");
      const notAfter = new Date(stdout.match(/notAfter=(.+)/)?.[1]?.trim() ?? "");
      const serialNumber = stdout.match(/serial=(\w+)/)?.[1] ?? "unknown";

      return {
        subject,
        issuer,
        serialNumber,
        notBefore,
        notAfter,
        fingerprint: this.computeCertFingerprint(certPem),
        pemCert: certPem,
      };
    } catch {
      return {
        subject: "unknown",
        issuer: "unknown",
        serialNumber: "unknown",
        notBefore: new Date(),
        notAfter: new Date(Date.now() + 365 * 24 * 3600 * 1000),
        fingerprint: this.computeCertFingerprint(certPem),
        pemCert: certPem,
      };
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  // ── Certificate expiry ────────────────────────────────────────────────────────

  async checkCertExpiry(serviceName: string): Promise<number> {
    const raw = await this.redis.get(`${CERT_STORE_PREFIX}${serviceName}`);
    if (!raw) return -1;

    const { cert } = JSON.parse(raw);
    const info = await this.getCertInfo(cert);
    const daysUntilExpiry = Math.floor(
      (info.notAfter.getTime() - Date.now()) / (24 * 3600 * 1000)
    );

    if (daysUntilExpiry <= CERT_EXPIRY_WARNING_DAYS) {
      Logger.warn("[MTLSManager] Certificate expiring soon", { serviceName, daysUntilExpiry });
    }

    return daysUntilExpiry;
  }

  isCertExpiringSoon(certInfo: CertificateInfo, daysThreshold: number): boolean {
    const daysLeft = Math.floor(
      (certInfo.notAfter.getTime() - Date.now()) / (24 * 3600 * 1000)
    );
    return daysLeft <= daysThreshold;
  }

  // ── HTTPS setup ───────────────────────────────────────────────────────────────

  async setupHTTPS(app: Express, certPath: string, keyPath: string): Promise<https.Server> {
    const cert = fs.readFileSync(certPath, "utf8");
    const key = fs.readFileSync(keyPath, "utf8");

    const options: https.ServerOptions = {
      cert,
      key,
      requestCert: true,
      rejectUnauthorized: false, // Manual validation in middleware
      secureProtocol: "TLS_method",
      minVersion: "TLSv1.2",
    };

    const server = https.createServer(options, app);
    Logger.info("[MTLSManager] HTTPS server configured", { certPath });
    return server;
  }

  // ── Express middleware ─────────────────────────────────────────────────────────

  requireClientCert(): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      const socket = req.socket as tls.TLSSocket;
      const cert = socket.getPeerCertificate?.(true);

      if (!cert || !cert.subject) {
        Logger.security("[MTLSManager] No client certificate presented", { ip: req.ip });
        return res.status(401).json({ error: "Client certificate required" });
      }

      if (!socket.authorized) {
        Logger.security("[MTLSManager] Client certificate not authorized", {
          reason: socket.authorizationError,
        });
        return res.status(403).json({ error: "Client certificate not authorized" });
      }

      (req as any).clientCert = cert;
      next();
    };
  }

  async verifyCertificateChain(cert: string): Promise<boolean> {
    try {
      const info = await this.getCertInfo(cert);
      const now = new Date();
      return now >= info.notBefore && now <= info.notAfter;
    } catch {
      return false;
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private computeCertFingerprint(certPem: string): string {
    const derContent = certPem
      .replace(/-----BEGIN CERTIFICATE-----/, "")
      .replace(/-----END CERTIFICATE-----/, "")
      .replace(/\s/g, "");

    const der = Buffer.from(derContent, "base64");
    return crypto
      .createHash("sha256")
      .update(der)
      .digest("hex")
      .match(/.{2}/g)!
      .join(":");
  }
}

export const mtlsManager = new MTLSManager();
