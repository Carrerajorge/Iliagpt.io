/**
 * Artifact Encryption Service
 * 
 * Features:
 * - AES-256-GCM encryption for generated documents
 * - Per-user encryption keys
 * - Secure key derivation (PBKDF2)
 * - Encrypted file storage and retrieval
 */

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

// Encryption configuration
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

export interface EncryptedArtifact {
    id: string;
    originalName: string;
    encryptedPath: string;
    iv: string;          // Base64
    authTag: string;     // Base64
    salt: string;        // Base64
    createdAt: Date;
    size: number;
    mimeType: string;
}

export interface EncryptionConfig {
    storageDir: string;
    masterKeyEnvVar: string;
}

const DEFAULT_CONFIG: EncryptionConfig = {
    storageDir: "./data/encrypted",
    masterKeyEnvVar: "ARTIFACT_ENCRYPTION_KEY",
};

let config = { ...DEFAULT_CONFIG };

// Initialize encryption service
export async function initEncryption(customConfig: Partial<EncryptionConfig> = {}): Promise<void> {
    config = { ...DEFAULT_CONFIG, ...customConfig };
    await fs.mkdir(config.storageDir, { recursive: true });
    console.log("[ArtifactEncryption] Initialized");
}

// Get master key from environment
function getMasterKey(): Buffer {
    const keyHex = process.env[config.masterKeyEnvVar];

    if (!keyHex) {
        // Generate a warning but provide a fallback for development
        console.warn(`[ArtifactEncryption] ${config.masterKeyEnvVar} not set, using insecure default`);
        return crypto.createHash("sha256").update("dev-key-do-not-use-in-production").digest();
    }

    return Buffer.from(keyHex, "hex");
}

// Derive user-specific key from master key + user ID
function deriveUserKey(userId: string, salt: Buffer): Buffer {
    const masterKey = getMasterKey();
    const userSecret = Buffer.concat([masterKey, Buffer.from(userId)]);

    return crypto.pbkdf2Sync(
        userSecret,
        salt,
        PBKDF2_ITERATIONS,
        KEY_LENGTH,
        "sha512"
    );
}

// Encrypt a buffer
export function encryptBuffer(
    data: Buffer,
    userId: string
): { encrypted: Buffer; iv: Buffer; authTag: Buffer; salt: Buffer } {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = deriveUserKey(userId, salt);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });

    const encrypted = Buffer.concat([
        cipher.update(data),
        cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return { encrypted, iv, authTag, salt };
}

// Decrypt a buffer
export function decryptBuffer(
    encrypted: Buffer,
    iv: Buffer,
    authTag: Buffer,
    salt: Buffer,
    userId: string
): Buffer {
    const key = deriveUserKey(userId, salt);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });

    decipher.setAuthTag(authTag);

    return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
    ]);
}

// Encrypt and store a file
export async function encryptArtifact(
    data: Buffer,
    originalName: string,
    userId: string,
    mimeType: string
): Promise<EncryptedArtifact> {
    const id = crypto.randomUUID();
    const { encrypted, iv, authTag, salt } = encryptBuffer(data, userId);

    const encryptedPath = path.join(config.storageDir, `${id}.enc`);
    await fs.writeFile(encryptedPath, encrypted);

    const artifact: EncryptedArtifact = {
        id,
        originalName,
        encryptedPath,
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
        salt: salt.toString("base64"),
        createdAt: new Date(),
        size: data.length,
        mimeType,
    };

    // Store metadata
    const metadataPath = path.join(config.storageDir, `${id}.meta.json`);
    await fs.writeFile(metadataPath, JSON.stringify(artifact, null, 2));

    console.log(`[ArtifactEncryption] Encrypted ${originalName} -> ${id}`);

    return artifact;
}

// Decrypt and retrieve a file
export async function decryptArtifact(
    artifactId: string,
    userId: string
): Promise<{ data: Buffer; metadata: EncryptedArtifact }> {
    const metadataPath = path.join(config.storageDir, `${artifactId}.meta.json`);
    const encryptedPath = path.join(config.storageDir, `${artifactId}.enc`);

    // Load metadata
    const metadataJson = await fs.readFile(metadataPath, "utf-8");
    const metadata: EncryptedArtifact = JSON.parse(metadataJson);

    // Load encrypted data
    const encrypted = await fs.readFile(encryptedPath);

    // Decrypt
    const data = decryptBuffer(
        encrypted,
        Buffer.from(metadata.iv, "base64"),
        Buffer.from(metadata.authTag, "base64"),
        Buffer.from(metadata.salt, "base64"),
        userId
    );

    return { data, metadata };
}

// Delete an encrypted artifact
export async function deleteEncryptedArtifact(artifactId: string): Promise<boolean> {
    try {
        const metadataPath = path.join(config.storageDir, `${artifactId}.meta.json`);
        const encryptedPath = path.join(config.storageDir, `${artifactId}.enc`);

        await fs.unlink(encryptedPath);
        await fs.unlink(metadataPath);

        console.log(`[ArtifactEncryption] Deleted ${artifactId}`);
        return true;
    } catch (error) {
        console.error(`[ArtifactEncryption] Delete error for ${artifactId}:`, error);
        return false;
    }
}

// List encrypted artifacts for a specific pattern
export async function listEncryptedArtifacts(): Promise<EncryptedArtifact[]> {
    const files = await fs.readdir(config.storageDir);
    const artifacts: EncryptedArtifact[] = [];

    for (const file of files) {
        if (file.endsWith(".meta.json")) {
            try {
                const content = await fs.readFile(
                    path.join(config.storageDir, file),
                    "utf-8"
                );
                artifacts.push(JSON.parse(content));
            } catch {
                // Skip invalid files
            }
        }
    }

    return artifacts.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

// Re-encrypt artifact for new user (key transfer)
export async function reEncryptForUser(
    artifactId: string,
    fromUserId: string,
    toUserId: string
): Promise<EncryptedArtifact> {
    // Decrypt with old user key
    const { data, metadata } = await decryptArtifact(artifactId, fromUserId);

    // Re-encrypt with new user key
    const newArtifact = await encryptArtifact(
        data,
        metadata.originalName,
        toUserId,
        metadata.mimeType
    );

    // Delete old artifact
    await deleteEncryptedArtifact(artifactId);

    console.log(`[ArtifactEncryption] Re-encrypted ${artifactId} for user ${toUserId}`);

    return newArtifact;
}

// Generate a new encryption key (for setup)
export function generateEncryptionKey(): string {
    return crypto.randomBytes(KEY_LENGTH).toString("hex");
}

// Verify encryption key validity
export function verifyKeyFormat(keyHex: string): boolean {
    try {
        const buffer = Buffer.from(keyHex, "hex");
        return buffer.length === KEY_LENGTH;
    } catch {
        return false;
    }
}

export default {
    initEncryption,
    encryptBuffer,
    decryptBuffer,
    encryptArtifact,
    decryptArtifact,
    deleteEncryptedArtifact,
    listEncryptedArtifacts,
    reEncryptForUser,
    generateEncryptionKey,
    verifyKeyFormat,
};
