import "./config/load-env";
import { initTracing } from "./lib/tracing";

// Initialize Distributed Tracing
initTracing({ serviceName: "iliagpt-worker" });

import { createWorker, QUEUE_NAMES } from "./lib/queueFactory";
import { deliverNotificationWebhookOrThrow } from "./lib/notificationWebhookDelivery";
import { UploadJobData } from "./services/uploadQueue";
import { Logger } from "./lib/logger";
type Job = any;
import { syncStripePaidInvoicesToPayments } from "./services/stripePaymentsSyncService";
import type { ChannelIngestJob } from "./channels/types";
import { processChannelIngestJob } from "./channels/channelIngestService";

const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "5");

Logger.info(`Starting Worker Process (Concurrency: ${WORKER_CONCURRENCY})...`);

// ==========================================
// 1. Upload Queue Worker
// ==========================================
createWorker<UploadJobData, any>(QUEUE_NAMES.UPLOAD, async (job) => {
    Logger.info(`[UploadJob:${job.id}] Processing: ${job.data.fileName} (${job.data.size} bytes)`);

    try {
        const { fileId, storagePath, mimeType, fileName } = job.data;
        const fs = await import("fs");
        const pathMod = await import("path");
        const { storage } = await import("./db/storage");
        const { ObjectStorageService } = await import("./services/objectStorageService");
        const { processDocument } = await import("./services/documentProcessingService");
        const { chunkText } = await import("./services/semanticChunking");
        const { generateEmbeddingsBatch } = await import("./services/embeddingsService");

        await storage.updateFileStatus(fileId, "processing");

        // ── FAST PATH: Images don't need OCR pre-processing ──────────────────
        // The AI model receives the image directly as a base64 attachment during
        // chat, so there's no text to extract here. Running Grok Vision + Tesseract
        // fallback was the 1-minute bottleneck for image uploads.
        const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/bmp", "image/webp", "image/tiff"];
        if (IMAGE_MIME_TYPES.includes(mimeType.toLowerCase())) {
            await storage.updateFileStatus(fileId, "ready");
            Logger.info(`[UploadJob:${job.id}] Image fast-path: marked ${fileId} ready (no OCR needed).`);
            return { processed: true, chunks: 0, textLength: 0, method: "image-fast-path" };
        }
        // ─────────────────────────────────────────────────────────────────────

        let content: Buffer | undefined;
        let fileReadSuccess = false;

        const uploadsDir = pathMod.default.resolve(process.cwd(), "uploads");
        const localCandidates: string[] = [];

        if (storagePath.startsWith('/objects/uploads/')) {
            localCandidates.push(pathMod.default.join(uploadsDir, storagePath.replace('/objects/uploads/', '')));
        }
        if (storagePath.startsWith('/objects/')) {
            localCandidates.push(pathMod.default.join(uploadsDir, storagePath.replace('/objects/', '')));
        }

        // 1. Try local paths
        for (const localFilePath of localCandidates) {
            const safePrefix = uploadsDir + pathMod.default.sep;
            if (!localFilePath.startsWith(safePrefix) && localFilePath !== uploadsDir) {
                continue;
            }

            // Polling in background worker is acceptable and safe
            let attempts = 0;
            const maxAttempts = 60; // 3 seconds max
            while (!fs.default.existsSync(localFilePath) && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 50));
                attempts++;
            }

            if (fs.default.existsSync(localFilePath)) {
                const stat = await fs.promises.stat(localFilePath);
                if (stat.size === 0) {
                    let sizeAttempts = 0;
                    while (sizeAttempts < 20) {
                        await new Promise(resolve => setTimeout(resolve, 50));
                        const reStat = await fs.promises.stat(localFilePath);
                        if (reStat.size > 0) break;
                        sizeAttempts++;
                    }
                }

                content = await fs.promises.readFile(localFilePath);
                if (content.length > 0) {
                    fileReadSuccess = true;
                    break;
                }
            }
        }

        // 2. Try object storage
        if (!fileReadSuccess) {
            try {
                const svc = new ObjectStorageService();
                const objectFile = await svc.getObjectEntityFile(storagePath);
                content = await svc.getFileContent(objectFile);
                if (content && content.length > 0) {
                    fileReadSuccess = true;
                }
            } catch (storageError: any) {
                Logger.warn(`[UploadJob:${job.id}] Object storage read failed for ${storagePath}: ${storageError.message}`);
            }
        }

        if (!fileReadSuccess || !content || content.length === 0) {
            throw new Error('File content could not be read from any storage source');
        }

        const result = await processDocument(content, mimeType, fileName);

        if (!result.text || result.text.trim().length === 0) {
            await storage.updateFileStatus(fileId, "ready");
            return { processed: true, chunks: 0, textLength: 0 };
        }

        const chunks = chunkText(result.text, 1500, 150);
        const chunksWithoutEmbeddings = chunks.map((chunk) => ({
            fileId,
            content: chunk.content,
            embedding: null,
            chunkIndex: chunk.chunkIndex,
            pageNumber: chunk.pageNumber || null,
            metadata: null,
        }));

        await storage.createFileChunks(chunksWithoutEmbeddings);
        await storage.updateFileStatus(fileId, "ready");

        // Compute embeddings directly inside this background run
        try {
            const texts = chunks.map(c => c.content);
            const embeddings = await generateEmbeddingsBatch(texts);
            for (let i = 0; i < chunks.length; i++) {
                await storage.updateFileChunkEmbedding(fileId, chunks[i].chunkIndex, embeddings[i]);
            }
        } catch (embedError: any) {
            Logger.error(`[UploadJob:${job.id}] Embedding generation failed - file exists but lacks embeddings: ${embedError.message}`);
        }

        Logger.info(`[UploadJob:${job.id}] Completed. Generated ${chunks.length} chunks.`);
        return { processed: true, chunks: chunks.length };

    } catch (error: any) {
        Logger.error(`[UploadJob:${job.id}] Failed: ${error.message}`);
        try {
            const { storage } = await import("./db/storage");
            await storage.updateFileStatus(job.data.fileId, "error");
        } catch (updateError: any) {
            Logger.error(`[UploadJob:${job.id}] Could not set file status to error: ${updateError.message}`);
        }
        throw error;
    }
}); // No .on() handlers needed here as they are handled in queueFactory or global events if needed, 
// but we can add them to the worker instance if we want specific logging.

// ==========================================
// 1.5 Channel Ingest Worker (Telegram / WhatsApp Cloud)
// ==========================================
const channelIngestWorker = createWorker<ChannelIngestJob, any>(QUEUE_NAMES.CHANNEL_INGEST, async (job: Job<ChannelIngestJob>) => {
    Logger.info(`[ChannelIngestJob:${job.id}] Channel=${(job.data as any)?.channel}`);
    await processChannelIngestJob(job.data);
    return { ok: true };
});

if (channelIngestWorker) {
    channelIngestWorker.on("ready", () => Logger.info("Channel Ingest Worker ready"));
    channelIngestWorker.on("error", (e: any) => Logger.error("Channel Ingest Worker error", e));
} else {
    Logger.warn("Channel Ingest Worker disabled (check REDIS_URL).");
}

// ==========================================
// 2. Parallel Processing Worker (The Engine)
// ==========================================

// Types from the old engine
type TaskType = "chunk" | "embed" | "analyze" | "ocr" | "vision" | "pii" | "quality" | "custom" | "pdf-generate" | "excel-parse";
interface ProcessingTaskData {
    [key: string]: any;
}

// Processor Logic (Migrated from in-memory engine)
// Processor Logic (PROD Implementation)
const processors: Record<TaskType, (data: any) => Promise<any>> = {
    chunk: async (data: { text: string }) => {
        // Simple recursive character text splitter logic
        const chunkSize = 1000;
        const overlap = 200;
        const chunks: string[] = [];

        // Basic implementation (production would use langchain's splitter)
        for (let i = 0; i < data.text.length; i += (chunkSize - overlap)) {
            chunks.push(data.text.slice(i, i + chunkSize));
        }

        return { chunks, count: chunks.length };
    },

    embed: async (data: { texts: string[] }) => {
        const OpenAIApi = (await import("openai")).default;
        const openai = new OpenAIApi({ apiKey: process.env.OPENAI_API_KEY });
        const timeoutMs = Number(process.env.WORKER_EMBED_TIMEOUT_MS) || 30000;
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await openai.embeddings.create(
                { model: "text-embedding-3-small", input: data.texts },
                { signal: controller.signal }
            );
            return { embeddings: response.data.map(d => d.embedding), usage: response.usage };
        } finally {
            clearTimeout(tid);
        }
    },

    analyze: async (data: { content: string }) => {
        const wordCount = data.content.split(/\s+/).length;
        const charCount = data.content.length;
        const readingTimeMinutes = Math.ceil(wordCount / 200);

        return {
            wordCount,
            charCount,
            readingTimeMinutes,
            language: "detected-auto", // Placeholder for 'franc'
        };
    },

    ocr: async (data: { buffer: { type: 'Buffer', data: number[] } }) => {
        // Handle Buffer from JSON (Redis serialization)
        const buffer = Buffer.from(data.buffer.data);

        const serviceUrl = process.env.OCR_SERVICE_URL;

        // Prefer the decoupled OCR microservice (PaddleOCR primary + Tesseract fallback).
        if (serviceUrl) {
            try {
                const url = new URL("/v1/ocr", serviceUrl);
                url.searchParams.set("engine", "auto");
                url.searchParams.set("lang", "eng");

                const isPdf = buffer.subarray(0, 4).toString("ascii") === "%PDF";
                const filename = isPdf ? "upload.pdf" : "upload.png";
                const mime = isPdf ? "application/pdf" : "image/png";

                const form = new FormData();
                form.append("file", new Blob([buffer], { type: mime }), filename);

                const ocrTimeout = Number(process.env.WORKER_OCR_TIMEOUT_MS) || 60000;
                const ocrController = new AbortController();
                const ocrTid = setTimeout(() => ocrController.abort(), ocrTimeout);
                let resp: Response;
                try {
                    resp = await fetch(url.toString(), { method: "POST", body: form, signal: ocrController.signal });
                } finally {
                    clearTimeout(ocrTid);
                }
                if (resp.ok) {
                    const json: any = await resp.json();
                    const avg = typeof json.avg_confidence === "number" ? json.avg_confidence : undefined;
                    return {
                        text: String(json.text ?? ""),
                        confidence: avg !== undefined ? avg * 100 : undefined,
                        engine: json.engine ?? "unknown",
                        timingsMs: json.timings_ms ?? undefined,
                    };
                }
            } catch {
                // Best-effort: fall back to local OCR.
            }
        }

        // Fallback (legacy): Tesseract.js implementation
        const Tesseract = (await import("tesseract.js")).default;
        const { data: { text, confidence } } = await Tesseract.recognize(buffer, "eng");

        return { text, confidence, engine: "tesseract.js" };
    },

    vision: async (_data: { image: string }) => {
        // Vision processing not yet implemented; raise a structured error so callers handle it explicitly.
        throw Object.assign(new Error("Vision processor not yet implemented (PROCESSOR_NOT_IMPLEMENTED)"), {
            code: "PROCESSOR_NOT_IMPLEMENTED",
            processor: "vision",
        });
    },

    pii: async (_data: { text: string }) => {
        // PII detection not yet implemented; raise explicitly rather than returning misleading zeros.
        throw Object.assign(new Error("PII processor not yet implemented (PROCESSOR_NOT_IMPLEMENTED)"), {
            code: "PROCESSOR_NOT_IMPLEMENTED",
            processor: "pii",
        });
    },

    quality: async (_data: { text: string }) => {
        // Quality scorer not yet implemented; raise explicitly.
        throw Object.assign(new Error("Quality processor not yet implemented (PROCESSOR_NOT_IMPLEMENTED)"), {
            code: "PROCESSOR_NOT_IMPLEMENTED",
            processor: "quality",
        });
    },

    custom: async (data: { fn: string }) => {
        return { error: "Custom function execution disabled for security" };
    },

    "pdf-generate": async (data: any) => {
        const { generatePdfFromHtml } = await import("./services/pdfGeneration");
        const buffer = await generatePdfFromHtml(data.html, data.options);
        // In a real worker, we might upload this buffer to S3/Storage and return the URL.
        // For this local/hybrid setup, we might return the buffer base64 encoded or save to temp.
        // Returning base64 for simplicity in this isomorphic setup
        return { pdfBase64: buffer.toString('base64'), fileName: data.outputFilename };
    },

    "excel-parse": async (data: any) => {
        const { parseSpreadsheet } = await import("./services/spreadsheetAnalyzer");
        const fs = await import("fs/promises");

        // In a real worker, we download from S3. Here we might read from disk if shared volume.
        // Assuming job data contains a path accessible to worker
        const buffer = await fs.readFile(data.filePath);
        const result = await parseSpreadsheet(buffer, data.mimeType);

        // We might store the result in DB here or return it
        return result;
    }
};

const processingWorker = createWorker(QUEUE_NAMES.PROCESSING, async (job: Job) => {
    Logger.info(`[ProcessJob:${job.id}] Type: ${job.name}`);

    try {
        const processor = processors[job.name as TaskType];
        if (!processor) {
            throw new Error(`Unknown task type: ${job.name}`);
        }

        const result = await processor(job.data);
        return result;

    } catch (error) {
        Logger.error(`[ProcessJob:${job.id}] Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        throw error;
    }
});

// --- Change the bottom of worker.ts to this ---

if (processingWorker) {
    processingWorker.on("ready", () => Logger.info("Processing Worker ready"));
    processingWorker.on("error", (e: any) => Logger.error("Processing Worker error", e));
} else {
    Logger.error("❌ processingWorker could not be initialized. Check REDIS_URL.");
}

// ==========================================
// 3. Payments Sync Worker (Stripe -> DB)
// ==========================================

type PaymentsSyncJobData = {
    maxInvoices: number;
    startingAfter?: string;
    fromDate: string;
    toDate: string;
};

const paymentsSyncWorker = createWorker<PaymentsSyncJobData, any>(QUEUE_NAMES.PAYMENTS_SYNC, async (job: Job) => {
    Logger.info(`[PaymentsSyncJob:${job.id}] Starting Stripe sync...`);

    const fromDate = new Date(job.data?.fromDate);
    const toDate = new Date(job.data?.toDate);

    const result = await syncStripePaidInvoicesToPayments({
        maxInvoices: job.data?.maxInvoices ?? 200,
        startingAfter: job.data?.startingAfter,
        fromDate,
        toDate,
        onProgress: async (p) => {
            await job.updateProgress({
                fetched: p.fetched,
                paid: p.paid,
                synced: p.synced,
                created: p.created,
                updated: p.updated,
                matchedUsers: p.matchedUsers,
                unmatchedUsers: p.unmatchedUsers,
                errors: p.errors,
                cursor: p.cursor,
                maxInvoices: p.maxInvoices,
            });
        },
    });

    Logger.info(`[PaymentsSyncJob:${job.id}] Finished Stripe sync: synced=${result.synced} created=${result.created} updated=${result.updated} errors=${result.errors}`);
    return result;
});

if (paymentsSyncWorker) {
    paymentsSyncWorker.on("ready", () => Logger.info("Payments Sync Worker ready"));
    paymentsSyncWorker.on("error", (e: any) => Logger.error("Payments Sync Worker error", e));
}

// ==========================================
// 4. Notification webhook worker (EventBus → user webhooks)
// ==========================================

const webhookNotificationWorker = createWorker(QUEUE_NAMES.WEBHOOK_NOTIFICATION, async (job: Job) => {
    Logger.info(`[WebhookNotification:${job.id}] deliver`);
    await deliverNotificationWebhookOrThrow(job.data);
    return { delivered: true };
});

if (webhookNotificationWorker) {
    webhookNotificationWorker.on("ready", () => Logger.info("Webhook Notification Worker ready"));
    webhookNotificationWorker.on("error", (e: any) => Logger.error("Webhook Notification Worker error", e));
}

// ==========================================
// Lifecycle
// ==========================================

const shutdown = async () => {
    Logger.info("Shutting down workers...");
    process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
