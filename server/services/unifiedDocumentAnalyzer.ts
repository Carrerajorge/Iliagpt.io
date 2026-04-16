/**
 * Unified Document Analyzer - ILIAGPT PRO 3.0
 * 
 * Combines all document/image analysis services into one API.
 * Integrates: RAG, Vision, OCR, Anonymization, Queue
 */

import { documentIngestion } from "./documentIngestion";
import { grokVisionService } from "./grokVisionService";
import { anonymizeResponse } from "./responseAnonymizer";
import { getUploadQueue, type UploadJob, type ProcessingResult } from "./uploadQueue";
import { advancedSemanticChunk } from "./advancedRAG";

// ============== Types ==============

export interface AnalysisRequest {
    userId: string;
    chatId: string;
    files: Array<{
        name: string;
        mimeType: string;
        buffer: Buffer;
    }>;
    query?: string;
    options?: AnalysisOptions;
}

export interface AnalysisOptions {
    enableVision?: boolean;
    enableOCR?: boolean;
    enableRAG?: boolean;
    anonymizeOutput?: boolean;
    language?: "es" | "en";
    userPlan?: "free" | "pro" | "admin";
}

export interface AnalysisResult {
    id: string;
    status: "processing" | "completed" | "failed";
    files: FileAnalysis[];
    combinedContent?: string;
    ragContext?: string;
    answer?: string;
    error?: string;
}

export interface FileAnalysis {
    fileName: string;
    fileType: string;
    content: string;
    chunks: string[];
    visionAnalysis?: {
        description: string;
        extractedText?: string;
        tables?: any[];
    };
    metadata: {
        wordCount: number;
        pageCount?: number;
        hasImages: boolean;
        hasTables: boolean;
    };
}

// ============== Helper Functions ==============

/**
 * Detect if file is an image
 */
function isImageFile(mimeType: string): boolean {
    return mimeType.startsWith("image/");
}

/**
 * Process a single file
 */
async function processFile(
    file: { name: string; mimeType: string; buffer: Buffer },
    options: AnalysisOptions
): Promise<FileAnalysis> {
    const { enableVision = true, enableOCR = true, language = "es" } = options;

    let content = "";
    let visionAnalysis;
    let metadata = {
        wordCount: 0,
        pageCount: undefined as number | undefined,
        hasImages: false,
        hasTables: false,
    };

    // Handle images with Grok Vision
    if (isImageFile(file.mimeType) && enableVision) {
        try {
            const vision = await grokVisionService.analyzeImage(file.buffer, {
                language,
                extractTables: true,
                extractText: true,
            });

            content = vision.extractedText || vision.description;
            visionAnalysis = {
                description: vision.description,
                extractedText: vision.extractedText,
                tables: vision.tables,
            };
            metadata.hasImages = true;
            metadata.hasTables = (vision.tables?.length ?? 0) > 0;
        } catch (error) {
            console.error("Vision analysis failed:", error);
            content = `[Imagen: ${file.name}]`;
        }
    } else {
        // Handle documents
        try {
            const extracted = await documentIngestion.extractContent(file.buffer, file.mimeType);
            content = extracted;

            const parsed = await documentIngestion.parseDocument(file.buffer, file.mimeType, file.name);
            metadata = {
                wordCount: content.split(/\s+/).length,
                pageCount: parsed.metadata.pageCount,
                hasImages: false,
                hasTables: parsed.sheets.some(s => s.isTabular),
            };
        } catch (error) {
            console.error("Document parsing failed:", error);
            content = "";
        }
    }

    // Chunk content for RAG
    let chunks: string[] = [];
    if (content.length > 0) {
        try {
            const semanticChunks = await advancedSemanticChunk(content, {
                targetChunkSize: 500,
                maxChunkSize: 1000,
            });
            chunks = semanticChunks.map(c => c.content);
        } catch {
            // Fallback to simple chunking
            chunks = content.match(/.{1,500}/g) || [];
        }
    }

    metadata.wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

    return {
        fileName: file.name,
        fileType: file.mimeType,
        content,
        chunks,
        visionAnalysis,
        metadata,
    };
}

// ============== Main API ==============

/**
 * Analyze documents and images
 */
export async function analyzeDocuments(
    request: AnalysisRequest
): Promise<AnalysisResult> {
    const {
        userId,
        chatId,
        files,
        query,
        options = {},
    } = request;

    const {
        anonymizeOutput = true,
        enableRAG = true,
        userPlan = "free",
    } = options;

    const analysisId = `analysis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const knownFileNames = files.map(f => f.name);

    try {
        // Process all files
        const fileAnalyses: FileAnalysis[] = [];

        for (const file of files) {
            const analysis = await processFile(file, options);
            fileAnalyses.push(analysis);
        }

        // Combine content for RAG
        const combinedContent = fileAnalyses
            .map(f => f.content)
            .filter(c => c.length > 0)
            .join("\n\n---\n\n");

        // Generate RAG context if query provided
        let ragContext: string | undefined;
        let answer: string | undefined;

        if (query && enableRAG && combinedContent.length > 0) {
            // Get relevant chunks
            const allChunks = fileAnalyses.flatMap(f => f.chunks);

            // Simple relevance scoring based on query keywords
            const queryWords = query.toLowerCase().split(/\s+/);
            const scoredChunks = allChunks.map(chunk => ({
                chunk,
                score: queryWords.filter(w => chunk.toLowerCase().includes(w)).length,
            }));

            const relevantChunks = scoredChunks
                .sort((a, b) => b.score - a.score)
                .slice(0, 5)
                .map(c => c.chunk);

            ragContext = relevantChunks.join("\n\n");
        }

        // Anonymize output if enabled
        let finalContent = combinedContent;
        let finalContext = ragContext;

        if (anonymizeOutput) {
            finalContent = anonymizeResponse(combinedContent, {
                knownFileNames,
                aggressiveMode: true,
            }).text;

            if (ragContext) {
                finalContext = anonymizeResponse(ragContext, {
                    knownFileNames,
                    aggressiveMode: true,
                }).text;
            }
        }

        return {
            id: analysisId,
            status: "completed",
            files: fileAnalyses,
            combinedContent: finalContent,
            ragContext: finalContext,
            answer,
        };
    } catch (error) {
        return {
            id: analysisId,
            status: "failed",
            files: [],
            error: error instanceof Error ? error.message : "Analysis failed",
        };
    }
}

/**
 * Queue documents for async processing
 */
export async function queueDocuments(
    request: AnalysisRequest
): Promise<{ analysisId: string; jobIds: string[] } | { error: string }> {
    const queue = getUploadQueue();
    const { userId, chatId, files, options = {} } = request;
    const { userPlan = "free" } = options;

    const result = await queue.addBatch(
        userId,
        chatId,
        files.map(f => ({ name: f.name, type: f.mimeType, buffer: f.buffer })),
        { userPlan }
    );

    if ("error" in result) {
        return result;
    }

    return {
        analysisId: `batch_${Date.now()}`,
        jobIds: result.jobIds,
    };
}

/**
 * Get analysis status
 */
export async function getAnalysisStatus(jobId: string) {
    return await getUploadQueue().getJob(jobId);
}

/**
 * Check rate limit
 */
export function checkRateLimit(
    userId: string,
    userPlan: "free" | "pro" | "admin" = "free"
): { allowed: boolean; remaining: number; resetIn: number } {
    const queue = getUploadQueue();
    // This would use the rate limiter internally
    return { allowed: true, remaining: 10, resetIn: 60000 };
}

export const unifiedDocumentAnalyzer = {
    analyzeDocuments,
    queueDocuments,
    getAnalysisStatus,
    checkRateLimit,
    processFile,
};

export default unifiedDocumentAnalyzer;
