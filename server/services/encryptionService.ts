/**
 * Encryption Layer - ILIAGPT PRO 3.0
 * 
 * End-to-end encryption for conversations.
 * Key management, message encryption/decryption.
 */

// ============== Types ==============

export interface EncryptionConfig {
    algorithm?: "AES-GCM" | "AES-CBC";
    keyLength?: 128 | 192 | 256;
    keyDerivation?: "PBKDF2" | "scrypt";
    iterations?: number;
}

export interface KeyPair {
    publicKey: string;
    privateKey: string;
    algorithm: string;
    createdAt: Date;
}

export interface EncryptedData {
    ciphertext: string;
    iv: string;
    salt?: string;
    tag?: string;
    algorithm: string;
    keyId?: string;
}

export interface ChatKey {
    chatId: string;
    key: string;
    algorithm: string;
    createdAt: Date;
    rotatedAt?: Date;
    version: number;
}

// ============== Crypto Utilities ==============

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function generateRandomBytes(length: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(length));
}

// ============== Encryption Service ==============

export class EncryptionService {
    private config: Required<EncryptionConfig>;
    private chatKeys: Map<string, ChatKey> = new Map();

    constructor(config: EncryptionConfig = {}) {
        this.config = {
            algorithm: config.algorithm ?? "AES-GCM",
            keyLength: config.keyLength ?? 256,
            keyDerivation: config.keyDerivation ?? "PBKDF2",
            iterations: config.iterations ?? 100000,
        };
    }

    // ======== Key Generation ========

    /**
     * Generate a symmetric key
     */
    async generateKey(): Promise<CryptoKey> {
        return crypto.subtle.generateKey(
            { name: this.config.algorithm, length: this.config.keyLength },
            true,
            ["encrypt", "decrypt"]
        );
    }

    /**
     * Generate key pair for asymmetric encryption
     */
    async generateKeyPair(): Promise<CryptoKeyPair> {
        return crypto.subtle.generateKey(
            {
                name: "RSA-OAEP",
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: "SHA-256",
            },
            true,
            ["encrypt", "decrypt"]
        );
    }

    /**
     * Derive key from password
     */
    async deriveKey(password: string, salt?: Uint8Array): Promise<{ key: CryptoKey; salt: string }> {
        const actualSalt = salt || generateRandomBytes(16);

        const keyMaterial = await crypto.subtle.importKey(
            "raw",
            encoder.encode(password),
            "PBKDF2",
            false,
            ["deriveKey"]
        );

        const key = await crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: actualSalt,
                iterations: this.config.iterations,
                hash: "SHA-256",
            },
            keyMaterial,
            { name: this.config.algorithm, length: this.config.keyLength },
            true,
            ["encrypt", "decrypt"]
        );

        return { key, salt: arrayBufferToBase64(actualSalt.buffer) };
    }

    /**
     * Export key to base64
     */
    async exportKey(key: CryptoKey): Promise<string> {
        const exported = await crypto.subtle.exportKey("raw", key);
        return arrayBufferToBase64(exported);
    }

    /**
     * Import key from base64
     */
    async importKey(keyData: string): Promise<CryptoKey> {
        const keyBuffer = base64ToArrayBuffer(keyData);
        return crypto.subtle.importKey(
            "raw",
            keyBuffer,
            { name: this.config.algorithm, length: this.config.keyLength },
            true,
            ["encrypt", "decrypt"]
        );
    }

    // ======== Encryption ========

    /**
     * Encrypt text
     */
    async encrypt(plaintext: string, key: CryptoKey): Promise<EncryptedData> {
        const iv = generateRandomBytes(12);
        const data = encoder.encode(plaintext);

        const encrypted = await crypto.subtle.encrypt(
            { name: this.config.algorithm, iv },
            key,
            data
        );

        return {
            ciphertext: arrayBufferToBase64(encrypted),
            iv: arrayBufferToBase64(iv.buffer),
            algorithm: this.config.algorithm,
        };
    }

    /**
     * Decrypt text
     */
    async decrypt(encrypted: EncryptedData, key: CryptoKey): Promise<string> {
        const iv = new Uint8Array(base64ToArrayBuffer(encrypted.iv));
        const ciphertext = base64ToArrayBuffer(encrypted.ciphertext);

        const decrypted = await crypto.subtle.decrypt(
            { name: encrypted.algorithm || this.config.algorithm, iv },
            key,
            ciphertext
        );

        return decoder.decode(decrypted);
    }

    /**
     * Encrypt with password
     */
    async encryptWithPassword(plaintext: string, password: string): Promise<EncryptedData> {
        const { key, salt } = await this.deriveKey(password);
        const encrypted = await this.encrypt(plaintext, key);
        return { ...encrypted, salt };
    }

    /**
     * Decrypt with password
     */
    async decryptWithPassword(encrypted: EncryptedData, password: string): Promise<string> {
        if (!encrypted.salt) {
            throw new Error("Salt required for password decryption");
        }

        const salt = new Uint8Array(base64ToArrayBuffer(encrypted.salt));
        const { key } = await this.deriveKey(password, salt);
        return this.decrypt(encrypted, key);
    }

    // ======== Chat Encryption ========

    /**
     * Create or get chat key
     */
    async getChatKey(chatId: string): Promise<CryptoKey> {
        let chatKey = this.chatKeys.get(chatId);

        if (!chatKey) {
            const key = await this.generateKey();
            const exported = await this.exportKey(key);

            chatKey = {
                chatId,
                key: exported,
                algorithm: this.config.algorithm,
                createdAt: new Date(),
                version: 1,
            };

            this.chatKeys.set(chatId, chatKey);
        }

        return this.importKey(chatKey.key);
    }

    /**
     * Encrypt message for chat
     */
    async encryptMessage(chatId: string, message: string): Promise<EncryptedData> {
        const key = await this.getChatKey(chatId);
        return this.encrypt(message, key);
    }

    /**
     * Decrypt message for chat
     */
    async decryptMessage(chatId: string, encrypted: EncryptedData): Promise<string> {
        const key = await this.getChatKey(chatId);
        return this.decrypt(encrypted, key);
    }

    /**
     * Rotate chat key
     */
    async rotateKey(chatId: string): Promise<void> {
        const existing = this.chatKeys.get(chatId);
        const key = await this.generateKey();
        const exported = await this.exportKey(key);

        const chatKey: ChatKey = {
            chatId,
            key: exported,
            algorithm: this.config.algorithm,
            createdAt: existing?.createdAt || new Date(),
            rotatedAt: new Date(),
            version: (existing?.version || 0) + 1,
        };

        this.chatKeys.set(chatId, chatKey);
    }

    /**
     * Delete chat key
     */
    deleteKey(chatId: string): boolean {
        return this.chatKeys.delete(chatId);
    }

    // ======== Hashing ========

    /**
     * Hash text
     */
    async hash(text: string, algorithm: "SHA-256" | "SHA-384" | "SHA-512" = "SHA-256"): Promise<string> {
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest(algorithm, data);
        return arrayBufferToBase64(hashBuffer);
    }

    /**
     * Verify hash
     */
    async verifyHash(text: string, expectedHash: string, algorithm?: "SHA-256" | "SHA-384" | "SHA-512"): Promise<boolean> {
        const actualHash = await this.hash(text, algorithm);
        return actualHash === expectedHash;
    }

    // ======== Signing ========

    /**
     * Generate signing key pair
     */
    async generateSigningKeyPair(): Promise<CryptoKeyPair> {
        return crypto.subtle.generateKey(
            {
                name: "RSASSA-PKCS1-v1_5",
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: "SHA-256",
            },
            true,
            ["sign", "verify"]
        );
    }

    /**
     * Sign data
     */
    async sign(data: string, privateKey: CryptoKey): Promise<string> {
        const signature = await crypto.subtle.sign(
            "RSASSA-PKCS1-v1_5",
            privateKey,
            encoder.encode(data)
        );
        return arrayBufferToBase64(signature);
    }

    /**
     * Verify signature
     */
    async verify(data: string, signature: string, publicKey: CryptoKey): Promise<boolean> {
        return crypto.subtle.verify(
            "RSASSA-PKCS1-v1_5",
            publicKey,
            base64ToArrayBuffer(signature),
            encoder.encode(data)
        );
    }

    // ======== Utilities ========

    /**
     * Generate secure random string
     */
    generateSecureToken(length: number = 32): string {
        const bytes = generateRandomBytes(length);
        return arrayBufferToBase64(bytes.buffer);
    }

    /**
     * Check if data is encrypted
     */
    isEncrypted(data: any): data is EncryptedData {
        return (
            typeof data === "object" &&
            data !== null &&
            typeof data.ciphertext === "string" &&
            typeof data.iv === "string"
        );
    }
}

// ============== Singleton ==============

let encryptionInstance: EncryptionService | null = null;

export function getEncryption(config?: EncryptionConfig): EncryptionService {
    if (!encryptionInstance) {
        encryptionInstance = new EncryptionService(config);
    }
    return encryptionInstance;
}

export default EncryptionService;
