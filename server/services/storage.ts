import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs";
import path from "path";
import { IStorageService } from "../lib/interfaces";
import { Logger } from "../lib/logger";

// ==========================================
// S3 Implementation
// ==========================================
export class S3StorageService implements IStorageService {
    private client: S3Client;
    private bucket: string;
    private publicUrlPrefix?: string;

    constructor() {
        this.client = new S3Client({
            region: process.env.AWS_REGION || "us-east-1",
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
            },
            endpoint: process.env.S3_ENDPOINT, // Optional for MinIO/DigitalOcean/R2
            forcePathStyle: !!process.env.S3_FORCE_PATH_STYLE,
        });
        this.bucket = process.env.S3_BUCKET || "";
        this.publicUrlPrefix = process.env.S3_PUBLIC_DOMAIN;
    }

    async upload(key: string, data: Buffer | string, contentType: string = "application/octet-stream"): Promise<string> {
        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: data,
            ContentType: contentType,
        });

        await this.client.send(command);
        return this.getPublicUrl(key);
    }

    async download(key: string): Promise<Buffer> {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
        });

        const response = await this.client.send(command);
        if (!response.Body) {
            throw new Error(`File not found: ${key}`);
        }

        // Convert stream to buffer
        return Buffer.from(await response.Body.transformToByteArray());
    }

    async delete(key: string): Promise<void> {
        await this.client.send(new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key,
        }));
    }

    getPublicUrl(key: string): string {
        if (this.publicUrlPrefix) {
            return `${this.publicUrlPrefix}/${key}`;
        }
        // Fallback for private buckets without CDN (Signed URL would be better for private)
        return `https://${this.bucket}.s3.amazonaws.com/${key}`;
    }
}

// ==========================================
// Filesystem Implementation (Fallback)
// ==========================================
export class FileSystemStorageService implements IStorageService {
    private basePath: string;
    private baseUrl: string;

    constructor() {
        this.basePath = path.join(process.cwd(), "artifacts"); // Default local dir
        this.baseUrl = "/api/files/artifacts"; // Route to serve these

        if (!fs.existsSync(this.basePath)) {
            fs.mkdirSync(this.basePath, { recursive: true });
        }
    }

    async upload(key: string, data: Buffer | string, contentType?: string): Promise<string> {
        const filePath = path.join(this.basePath, key);
        const dir = path.dirname(filePath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, data);
        return this.getPublicUrl(key);
    }

    async download(key: string): Promise<Buffer> {
        const filePath = path.join(this.basePath, key);
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${key}`);
        }
        return fs.readFileSync(filePath);
    }

    async delete(key: string): Promise<void> {
        const filePath = path.join(this.basePath, key);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }

    getPublicUrl(key: string): string {
        return `${this.baseUrl}/${key}`;
    }
}

// ==========================================
// Factory
// ==========================================
let storageInstance: IStorageService | null = null;

export function getStorageService(): IStorageService {
    if (storageInstance) return storageInstance;

    if (process.env.S3_BUCKET && process.env.AWS_ACCESS_KEY_ID) {
        Logger.info("Storage: Using S3 Driver");
        storageInstance = new S3StorageService();
    } else {
        Logger.info("Storage: Using Filesystem Driver (S3 credentials missing)");
        storageInstance = new FileSystemStorageService();
    }

    return storageInstance;
}

export const storageService = {
    getStorageService
};
