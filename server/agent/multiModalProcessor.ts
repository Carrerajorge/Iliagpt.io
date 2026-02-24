/**
 * Multi-Modal Processor for ILIAGPT PRO 3.0
 * 
 * Processes multiple content types:
 * - Image analysis with vision AI
 * - Audio transcription
 * - Video frame extraction and analysis
 * - Document understanding (PDFs, scanned images)
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";

// ============================================
// Types and Interfaces
// ============================================

export type MediaType = "image" | "audio" | "video" | "document" | "unknown";

export interface MediaInput {
    id: string;
    type: MediaType;
    source: "file" | "url" | "base64" | "buffer";
    data: string | Buffer;
    mimeType?: string;
    metadata?: Record<string, any>;
}

export interface VisionResult {
    description: string;
    labels: string[];
    objects: Array<{ name: string; confidence: number; boundingBox?: any }>;
    text?: string; // OCR text if detected
    colors: string[];
    safeSearch?: { adult: boolean; medical: boolean; violent: boolean };
    metadata: Record<string, any>;
}

export interface AudioResult {
    transcription: string;
    segments: Array<{
        text: string;
        startTime: number;
        endTime: number;
        speaker?: string;
        confidence: number;
    }>;
    language: string;
    duration: number;
    speakers?: string[];
}

export interface VideoResult {
    duration: number;
    frames: Array<{
        timestamp: number;
        description: string;
        objects: string[];
    }>;
    transcription?: AudioResult;
    scenes: Array<{
        startTime: number;
        endTime: number;
        description: string;
    }>;
    summary: string;
}

export interface DocumentResult {
    text: string;
    pages: number;
    tables: Array<{
        page: number;
        rows: string[][];
    }>;
    images: Array<{
        page: number;
        description: string;
    }>;
    structure: {
        title?: string;
        headings: string[];
        sections: Array<{ title: string; content: string }>;
    };
    language: string;
}

export interface ProcessingResult {
    id: string;
    inputId: string;
    type: MediaType;
    success: boolean;
    result: VisionResult | AudioResult | VideoResult | DocumentResult | null;
    error?: string;
    processingTime: number;
}

export interface ProcessingOptions {
    extractText?: boolean;
    detectObjects?: boolean;
    transcribe?: boolean;
    extractFrames?: boolean;
    frameInterval?: number; // seconds
    language?: string;
    detailed?: boolean;
}

// ============================================
// Multi-Modal Processor Class
// ============================================

export class MultiModalProcessor extends EventEmitter {
    private processingQueue: Map<string, { input: MediaInput; status: string }>;
    private cache: Map<string, ProcessingResult>;

    // External API handlers (to be injected)
    private visionHandler?: (image: Buffer | string) => Promise<VisionResult>;
    private audioHandler?: (audio: Buffer | string) => Promise<AudioResult>;
    private documentHandler?: (doc: Buffer | string) => Promise<DocumentResult>;

    constructor() {
        super();
        this.processingQueue = new Map();
        this.cache = new Map();
    }

    /**
     * Configure external API handlers
     */
    configure(handlers: {
        vision?: (image: Buffer | string) => Promise<VisionResult>;
        audio?: (audio: Buffer | string) => Promise<AudioResult>;
        document?: (doc: Buffer | string) => Promise<DocumentResult>;
    }): void {
        if (handlers.vision) this.visionHandler = handlers.vision;
        if (handlers.audio) this.audioHandler = handlers.audio;
        if (handlers.document) this.documentHandler = handlers.document;
    }

    /**
     * Detect media type from MIME type or extension
     */
    detectMediaType(mimeType?: string, filename?: string): MediaType {
        if (mimeType) {
            if (mimeType.startsWith("image/")) return "image";
            if (mimeType.startsWith("audio/")) return "audio";
            if (mimeType.startsWith("video/")) return "video";
            if (mimeType === "application/pdf") return "document";
            if (mimeType.includes("document") || mimeType.includes("word") ||
                mimeType.includes("spreadsheet") || mimeType.includes("presentation")) {
                return "document";
            }
        }

        if (filename) {
            const ext = filename.split(".").pop()?.toLowerCase();
            const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff"];
            const audioExts = ["mp3", "wav", "ogg", "m4a", "flac", "aac"];
            const videoExts = ["mp4", "webm", "mov", "avi", "mkv"];
            const docExts = ["pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt"];

            if (ext && imageExts.includes(ext)) return "image";
            if (ext && audioExts.includes(ext)) return "audio";
            if (ext && videoExts.includes(ext)) return "video";
            if (ext && docExts.includes(ext)) return "document";
        }

        return "unknown";
    }

    /**
     * Process a media input
     */
    async process(
        input: MediaInput,
        options: ProcessingOptions = {}
    ): Promise<ProcessingResult> {
        const startTime = Date.now();
        const resultId = randomUUID();

        // Check cache
        const cacheKey = this.getCacheKey(input);
        const cached = this.cache.get(cacheKey);
        if (cached) {
            this.emit("cache_hit", { inputId: input.id });
            return cached;
        }

        // Add to queue
        this.processingQueue.set(input.id, { input, status: "processing" });
        this.emit("processing_start", { inputId: input.id, type: input.type });

        try {
            let result: VisionResult | AudioResult | VideoResult | DocumentResult | null = null;

            switch (input.type) {
                case "image":
                    result = await this.processImage(input, options);
                    break;
                case "audio":
                    result = await this.processAudio(input, options);
                    break;
                case "video":
                    result = await this.processVideo(input, options);
                    break;
                case "document":
                    result = await this.processDocument(input, options);
                    break;
                default:
                    throw new Error(`Unsupported media type: ${input.type}`);
            }

            const processingResult: ProcessingResult = {
                id: resultId,
                inputId: input.id,
                type: input.type,
                success: true,
                result,
                processingTime: Date.now() - startTime
            };

            // Cache result
            this.cache.set(cacheKey, processingResult);

            // Update queue
            this.processingQueue.set(input.id, { input, status: "completed" });
            this.emit("processing_complete", processingResult);

            return processingResult;

        } catch (error) {
            const processingResult: ProcessingResult = {
                id: resultId,
                inputId: input.id,
                type: input.type,
                success: false,
                result: null,
                error: (error as Error).message,
                processingTime: Date.now() - startTime
            };

            this.processingQueue.set(input.id, { input, status: "failed" });
            this.emit("processing_failed", processingResult);

            return processingResult;
        }
    }

    /**
     * Process multiple inputs in parallel
     */
    async processMultiple(
        inputs: MediaInput[],
        options: ProcessingOptions = {}
    ): Promise<ProcessingResult[]> {
        const results = await Promise.all(
            inputs.map(input => this.process(input, options))
        );
        return results;
    }

    // ============================================
    // Type-specific Processing
    // ============================================

    private async processImage(
        input: MediaInput,
        options: ProcessingOptions
    ): Promise<VisionResult> {
        const data = input.source === "buffer" ? input.data : input.data.toString();

        // Use external handler if available
        if (this.visionHandler) {
            return await this.visionHandler(data as Buffer | string);
        }

        // Fallback: basic image analysis
        return {
            description: "Image analysis not configured",
            labels: [],
            objects: [],
            colors: [],
            metadata: { source: input.source }
        };
    }

    private async processAudio(
        input: MediaInput,
        options: ProcessingOptions
    ): Promise<AudioResult> {
        const data = input.source === "buffer" ? input.data : input.data.toString();

        // Use external handler if available
        if (this.audioHandler) {
            return await this.audioHandler(data as Buffer | string);
        }

        // Fallback
        return {
            transcription: "Audio transcription not configured",
            segments: [],
            language: options.language || "unknown",
            duration: 0
        };
    }

    private async processVideo(
        input: MediaInput,
        options: ProcessingOptions
    ): Promise<VideoResult> {
        // Video processing would typically extract frames and audio
        // then analyze each separately

        const frames: VideoResult["frames"] = [];
        const scenes: VideoResult["scenes"] = [];

        // Placeholder for frame extraction
        const frameInterval = options.frameInterval || 5;

        return {
            duration: 0,
            frames,
            scenes,
            summary: "Video analysis not fully configured"
        };
    }

    private async processDocument(
        input: MediaInput,
        options: ProcessingOptions
    ): Promise<DocumentResult> {
        const data = input.source === "buffer" ? input.data : input.data.toString();

        // Use external handler if available
        if (this.documentHandler) {
            return await this.documentHandler(data as Buffer | string);
        }

        // Fallback
        return {
            text: "Document processing not configured",
            pages: 0,
            tables: [],
            images: [],
            structure: { headings: [], sections: [] },
            language: options.language || "unknown"
        };
    }

    // ============================================
    // Utilities
    // ============================================

    private getCacheKey(input: MediaInput): string {
        if (input.source === "buffer" && Buffer.isBuffer(input.data)) {
            const hash = require("crypto")
                .createHash("md5")
                .update(input.data)
                .digest("hex");
            return `${input.type}:${hash}`;
        }
        return `${input.type}:${input.data.toString().substring(0, 100)}`;
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        this.cache.clear();
        this.emit("cache_cleared");
    }

    /**
     * Get processing queue status
     */
    getQueueStatus(): Array<{ id: string; type: MediaType; status: string }> {
        return Array.from(this.processingQueue.entries()).map(([id, item]) => ({
            id,
            type: item.input.type,
            status: item.status
        }));
    }

    /**
     * Get statistics
     */
    getStats(): {
        cacheSize: number;
        queueSize: number;
        processingCount: number;
    } {
        const processing = Array.from(this.processingQueue.values())
            .filter(item => item.status === "processing").length;

        return {
            cacheSize: this.cache.size,
            queueSize: this.processingQueue.size,
            processingCount: processing
        };
    }
}

// ============================================
// Content Extraction Utilities
// ============================================

/**
 * Extract text from various content types
 */
export function extractTextContent(result: ProcessingResult): string {
    if (!result.success || !result.result) return "";

    switch (result.type) {
        case "image": {
            const vision = result.result as VisionResult;
            return [vision.description, vision.text || ""].filter(Boolean).join("\n");
        }
        case "audio": {
            const audio = result.result as AudioResult;
            return audio.transcription;
        }
        case "video": {
            const video = result.result as VideoResult;
            return [
                video.summary,
                video.transcription?.transcription || "",
                video.scenes.map(s => s.description).join("\n")
            ].filter(Boolean).join("\n\n");
        }
        case "document": {
            const doc = result.result as DocumentResult;
            return doc.text;
        }
        default:
            return "";
    }
}

/**
 * Get structured data from result
 */
export function extractStructuredData(result: ProcessingResult): Record<string, any> {
    if (!result.success || !result.result) return {};

    switch (result.type) {
        case "image": {
            const vision = result.result as VisionResult;
            return {
                objects: vision.objects.map(o => o.name),
                labels: vision.labels,
                colors: vision.colors,
                hasText: !!vision.text
            };
        }
        case "audio": {
            const audio = result.result as AudioResult;
            return {
                duration: audio.duration,
                language: audio.language,
                speakers: audio.speakers,
                segmentCount: audio.segments.length
            };
        }
        case "video": {
            const video = result.result as VideoResult;
            return {
                duration: video.duration,
                frameCount: video.frames.length,
                sceneCount: video.scenes.length,
                hasTranscription: !!video.transcription
            };
        }
        case "document": {
            const doc = result.result as DocumentResult;
            return {
                pages: doc.pages,
                title: doc.structure.title,
                tableCount: doc.tables.length,
                imageCount: doc.images.length,
                language: doc.language
            };
        }
        default:
            return {};
    }
}

// Singleton instance
let multiModalInstance: MultiModalProcessor | null = null;

export function getMultiModalProcessor(): MultiModalProcessor {
    if (!multiModalInstance) {
        multiModalInstance = new MultiModalProcessor();
    }
    return multiModalInstance;
}

export default MultiModalProcessor;
