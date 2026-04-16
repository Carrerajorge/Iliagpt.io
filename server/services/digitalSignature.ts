/**
 * Digital Signature Service
 * Provides document hashing, verification, and basic digital signatures.
 * Uses Node.js crypto (no external PDF signing library needed).
 */

import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";

export interface SignatureResult {
  documentHash: string;
  signature: string;
  signedAt: string;
  signer: string;
  algorithm: string;
  verified: boolean;
}

export interface VerificationResult {
  valid: boolean;
  documentHash: string;
  expectedHash: string;
  signedAt?: string;
  signer?: string;
  message: string;
}

export interface SignatureMetadata {
  documentId: string;
  documentName: string;
  hash: string;
  signature: string;
  signer: string;
  signedAt: string;
  algorithm: string;
}

const SIGNATURES_DIR = path.join(process.cwd(), "uploads", "signatures");

async function ensureSignaturesDir(): Promise<void> {
  await fs.mkdir(SIGNATURES_DIR, { recursive: true });
}

/**
 * Generate a SHA-256 hash of a document file.
 */
export async function hashDocument(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Hash document content from buffer.
 */
export function hashContent(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Sign a document with HMAC-SHA256 (symmetric key signing).
 * For production use, this could be upgraded to RSA/ECDSA with proper key management.
 */
export async function signDocument(
  filePath: string,
  signer: string,
  secretKey?: string
): Promise<SignatureResult> {
  const docHash = await hashDocument(filePath);
  const key = secretKey || process.env.DOCUMENT_SIGNING_KEY || "iliagpt-default-signing-key";
  const signedAt = new Date().toISOString();

  // Create HMAC signature of hash + signer + timestamp
  const signaturePayload = `${docHash}:${signer}:${signedAt}`;
  const signature = crypto
    .createHmac("sha256", key)
    .update(signaturePayload)
    .digest("hex");

  // Store signature metadata
  await ensureSignaturesDir();
  const metadataPath = path.join(SIGNATURES_DIR, `${docHash}.sig.json`);
  const metadata: SignatureMetadata = {
    documentId: docHash.substring(0, 12),
    documentName: path.basename(filePath),
    hash: docHash,
    signature,
    signer,
    signedAt,
    algorithm: "hmac-sha256",
  };
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

  return {
    documentHash: docHash,
    signature,
    signedAt,
    signer,
    algorithm: "hmac-sha256",
    verified: true,
  };
}

/**
 * Verify a document signature.
 */
export async function verifySignature(
  filePath: string,
  expectedSignature: string,
  signer: string,
  signedAt: string,
  secretKey?: string
): Promise<VerificationResult> {
  const docHash = await hashDocument(filePath);
  const key = secretKey || process.env.DOCUMENT_SIGNING_KEY || "iliagpt-default-signing-key";

  const signaturePayload = `${docHash}:${signer}:${signedAt}`;
  const computedSignature = crypto
    .createHmac("sha256", key)
    .update(signaturePayload)
    .digest("hex");

  const valid = computedSignature === expectedSignature;

  return {
    valid,
    documentHash: docHash,
    expectedHash: docHash,
    signedAt,
    signer,
    message: valid
      ? "Document signature is valid — document has not been tampered with"
      : "INVALID — document may have been modified after signing",
  };
}

/**
 * Verify a document using stored signature metadata.
 */
export async function verifyByHash(
  filePath: string
): Promise<VerificationResult> {
  const docHash = await hashDocument(filePath);
  const metadataPath = path.join(SIGNATURES_DIR, `${docHash}.sig.json`);

  try {
    const raw = await fs.readFile(metadataPath, "utf-8");
    const metadata: SignatureMetadata = JSON.parse(raw);

    return verifySignature(
      filePath,
      metadata.signature,
      metadata.signer,
      metadata.signedAt
    );
  } catch {
    return {
      valid: false,
      documentHash: docHash,
      expectedHash: "unknown",
      message: "No signature found for this document",
    };
  }
}

/**
 * List all signed documents.
 */
export async function listSignedDocuments(): Promise<SignatureMetadata[]> {
  await ensureSignaturesDir();
  const files = await fs.readdir(SIGNATURES_DIR);
  const sigFiles = files.filter((f) => f.endsWith(".sig.json"));

  const results: SignatureMetadata[] = [];
  for (const file of sigFiles) {
    try {
      const raw = await fs.readFile(path.join(SIGNATURES_DIR, file), "utf-8");
      results.push(JSON.parse(raw));
    } catch {
      // Skip corrupted files
    }
  }

  return results.sort((a, b) => new Date(b.signedAt).getTime() - new Date(a.signedAt).getTime());
}
