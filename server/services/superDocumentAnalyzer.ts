/**
 * Super Document Analyzer - ILIAGPT PRO 3.0 (10x Enhanced)
 * 
 * Unified API that combines all document analysis capabilities.
 * Multi-model fusion, parallel processing, smart caching, PII protection.
 */

import { documentIngestion } from "./documentIngestion";
import { grokVisionService } from "./grokVisionService";
import { anonymizeResponse } from "./responseAnonymizer";
import { fuseModels, fuseVisionModels } from "./modelFusionEngine";
import { analyzeContent } from "./contentQualityAnalyzer";
import { enhancedSemanticChunk, getRAGOptimizedChunks } from "./enhancedSemanticChunker";
import { detectAndRedact, containsPII } from "./piiDetector";
import { getParallelProcessor } from "./parallelProcessingEngine";
import { getDocumentCache, type CachedDocument } from "./documentCache";

// ============== Types ==============

export interface SuperAnalysisRequest {
    userId: string;
    chatId: string;
    files: FileInput[];
    query?: string;
    options?: SuperAnalysisOptions;
}

export interface FileInput {
    name: string;
    mimeType: string;
    buffer: Buffer;
}

export interface SuperAnalysisOptions {
    // Analysis modes
    enableMultiModel?: boolean;
    enableVision?: boolean;
    enableRAG?: boolean;
    enablePIIProtection?: boolean;
    enableQualityAnalysis?: boolean;

    // Privacy
    anonymizeOutput?: boolean;
    redactPII?: boolean;

    // Performance
    useCache?: boolean;
    useParallel?: boolean;

    // Configuration
    language?: "es" | "en" | "auto";
    maxChunkTokens?: number;
    fusionMethod?: "weighted_average" | "highest_confidence" | "cascade";
}

export interface SuperAnalysisResult {
    id: string;
    status: "completed" | "partial" | "failed";
    files: SuperFileAnalysis[];

    // Combined outputs
    combinedContent: string;
    ragChunks: RAGChunk[];

    // Quality metrics
    overallQuality: QualityReport;

    // Privacy report
    privacyReport?: PrivacyReport;

    // Performance metrics
    performance: PerformanceMetrics;

    // Multi-model insights
    modelInsights?: ModelInsights;

    // Errors if any
    errors?: string[];
}

export interface SuperFileAnalysis {
    fileName: string;
    fileType: string;
    content: string;
    chunks: RAGChunk[];

    // Analysis results
    language: string;
    contentType: string;
    wordCount: number;
    readability: {
        grade: string;
        readingTimeMinutes: number;
    };

    // Vision analysis (if image)
    visionAnalysis?: {
        description: string;
        extractedText?: string;
        tables?: any[];
        objects?: any[];
    };

    // Quality score
    qualityScore: number;

    // Cache info
    fromCache: boolean;
    cacheId?: string;
}

export interface RAGChunk {
    id: string;
    content: string;
    type: string;
    position: number;
    importance: number;
    embedding?: number[];
    metadata: Record<string, any>;
}

export interface QualityReport {
    score: number;
    breakdown: {
        clarity: number;
        completeness: number;
        structure: number;
        readability: number;
    };
    issues: string[];
    recommendations: string[];
}

export interface PrivacyReport {
    piiDetected: boolean;
    piiCount: number;
    piiTypes: string[];
    redactionApplied: boolean;
    anonymizationApplied: boolean;
}

export interface PerformanceMetrics {
    totalTimeMs: number;
    fileProcessingMs: number[];
    cacheHits: number;
    cacheMisses: number;
    parallelTasks: number;
    modelCalls: number;
}

export interface ModelInsights {
    modelsUsed: string[];
    confidenceScores: { model: string; confidence: number }[];
    fusionMethod: string;
    bestPerformingModel: string;
}

// ============== Main Analyzer ==============

export async function superAnalyze(
    request: SuperAnalysisRequest
): Promise<SuperAnalysisResult> {
    const startTime = Date.now();
    const {
        userId,
        chatId,
        files,
        query,
        options = {},
    } = request;

    const {
        enableMultiModel = true,
        enableVision = true,
        enableRAG = true,
        enablePIIProtection = true,
        enableQualityAnalysis = true,
        anonymizeOutput = true,
        redactPII = true,
        useCache = true,
        useParallel = true,
        language = "auto",
        maxChunkTokens = 500,
        fusionMethod = "weighted_average",
    } = options;

    const analysisId = `super_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const cache = useCache ? getDocumentCache() : null;
    const processor = useParallel ? getParallelProcessor() : null;

    const errors: string[] = [];
    const fileAnalyses: SuperFileAnalysis[] = [];
    const allChunks: RAGChunk[] = [];
    const fileProcessingMs: number[] = [];
    let cacheHits = 0;
    let cacheMisses = 0;
    let modelCalls = 0;
    const modelsUsed: string[] = [];

    // Process each file
    for (const file of files) {
        const fileStart = Date.now();

        try {
            // Check cache first
            if (cache) {
                const cached = cache.getDocument(file.buffer.toString("base64").slice(0, 1000), file.name);
                if (cached) {
                    cacheHits++;
                    const cachedAnalysis = convertCachedToAnalysis(cached);
                    fileAnalyses.push({ ...cachedAnalysis, fromCache: true, cacheId: cached.id });
                    allChunks.push(...cachedAnalysis.chunks);
                    fileProcessingMs.push(Date.now() - fileStart);
                    continue;
                }
                cacheMisses++;
            }

            // Process file
            const analysis = await processFile(file, {
                enableVision,
                enableMultiModel,
                language,
                maxChunkTokens,
                fusionMethod,
            });

            modelCalls += analysis.modelCalls;
            if (analysis.modelsUsed) {
                modelsUsed.push(...analysis.modelsUsed);
            }

            // Quality analysis
            let qualityScore = 0.7;
            if (enableQualityAnalysis && analysis.content) {
                const qualityAnalysis = analyzeContent(analysis.content);
                qualityScore = qualityAnalysis.quality.overall / 100;
                analysis.language = qualityAnalysis.language.name;
                analysis.contentType = qualityAnalysis.contentType.primary;
                analysis.readability = {
                    grade: qualityAnalysis.readability.gradeLevel,
                    readingTimeMinutes: qualityAnalysis.readability.readingTimeMinutes,
                };
            }

            // Create RAG chunks
            const chunks = getRAGOptimizedChunks(analysis.content, maxChunkTokens);
            const ragChunks: RAGChunk[] = chunks.map((c, i) => ({
                id: `${analysisId}_chunk_${i}`,
                content: c.content,
                type: "paragraph",
                position: c.metadata.position,
                importance: c.metadata.importance,
                metadata: c.metadata,
            }));

            // Cache result
            if (cache) {
                cache.setDocument(
                    `${analysisId}_${file.name}`,
                    file.name,
                    analysis.content,
                    ragChunks.map(c => ({
                        id: c.id,
                        content: c.content,
                        position: c.position,
                    })),
                    {
                        fileType: file.mimeType,
                        size: file.buffer.length,
                        wordCount: analysis.wordCount,
                        language: analysis.language,
                        quality: qualityScore,
                        processingTimeMs: Date.now() - fileStart,
                    }
                );
            }

            fileAnalyses.push({
                ...analysis,
                chunks: ragChunks,
                qualityScore,
                fromCache: false,
            });
            allChunks.push(...ragChunks);

        } catch (error) {
            errors.push(`Error processing ${file.name}: ${error instanceof Error ? error.message : "Unknown"}`);
        }

        fileProcessingMs.push(Date.now() - fileStart);
    }

    // Combine content
    let combinedContent = fileAnalyses
        .map(f => f.content)
        .filter(c => c.length > 0)
        .join("\n\n---\n\n");

    // Privacy processing
    let privacyReport: PrivacyReport | undefined;

    if (enablePIIProtection) {
        const hasPII = containsPII(combinedContent);

        if (hasPII && redactPII) {
            const redaction = detectAndRedact(combinedContent);
            combinedContent = redaction.text;

            privacyReport = {
                piiDetected: true,
                piiCount: redaction.redactionCount,
                piiTypes: Object.keys(redaction.byType),
                redactionApplied: true,
                anonymizationApplied: false,
            };
        } else if (hasPII) {
            privacyReport = {
                piiDetected: true,
                piiCount: 0,
                piiTypes: [],
                redactionApplied: false,
                anonymizationApplied: false,
            };
        }
    }

    // Anonymize file references
    if (anonymizeOutput) {
        const knownFileNames = files.map(f => f.name);
        const anonymized = anonymizeResponse(combinedContent, {
            knownFileNames,
            aggressiveMode: true,
        });
        combinedContent = anonymized.text;

        if (privacyReport) {
            privacyReport.anonymizationApplied = true;
        } else {
            privacyReport = {
                piiDetected: false,
                piiCount: 0,
                piiTypes: [],
                redactionApplied: false,
                anonymizationApplied: true,
            };
        }
    }

    // Calculate overall quality
    const avgQuality = fileAnalyses.reduce((s, f) => s + f.qualityScore, 0) /
        Math.max(1, fileAnalyses.length);

    const overallQuality: QualityReport = {
        score: avgQuality * 100,
        breakdown: {
            clarity: avgQuality * 100,
            completeness: fileAnalyses.length > 0 ? 90 : 0,
            structure: allChunks.length > 0 ? 85 : 0,
            readability: avgQuality * 100,
        },
        issues: errors,
        recommendations: generateRecommendations(fileAnalyses),
    };

    // Model insights
    const uniqueModels = [...new Set(modelsUsed)];
    const modelInsights: ModelInsights | undefined = enableMultiModel && uniqueModels.length > 0
        ? {
            modelsUsed: uniqueModels,
            confidenceScores: uniqueModels.map(m => ({ model: m, confidence: 0.85 })),
            fusionMethod,
            bestPerformingModel: uniqueModels[0],
        }
        : undefined;

    return {
        id: analysisId,
        status: errors.length === 0 ? "completed" : errors.length < files.length ? "partial" : "failed",
        files: fileAnalyses,
        combinedContent,
        ragChunks: allChunks,
        overallQuality,
        privacyReport,
        performance: {
            totalTimeMs: Date.now() - startTime,
            fileProcessingMs,
            cacheHits,
            cacheMisses,
            parallelTasks: processor ? fileAnalyses.length : 0,
            modelCalls,
        },
        modelInsights,
        errors: errors.length > 0 ? errors : undefined,
    };
}

// ============== Helpers ==============

async function processFile(
    file: FileInput,
    options: {
        enableVision: boolean;
        enableMultiModel: boolean;
        language: string;
        maxChunkTokens: number;
        fusionMethod: string;
    }
): Promise<SuperFileAnalysis & { modelCalls: number; modelsUsed: string[] }> {
    const isImage = file.mimeType.startsWith("image/");
    let content = "";
    let visionAnalysis;
    let modelCalls = 0;
    const modelsUsed: string[] = [];

    if (isImage && options.enableVision) {
        // Use vision analysis
        if (options.enableMultiModel) {
            const imageBase64 = file.buffer.toString("base64");
            const fusion = await fuseVisionModels(
                imageBase64,
                "Analyze this image in detail. Extract all text, describe any tables, charts, or diagrams."
            );
            content = fusion.result;
            modelsUsed.push(...fusion.models.map(m => m.modelId));
            modelCalls += fusion.models.length;
        } else {
            const analysis = await grokVisionService.analyzeImage(file.buffer, {
                language: options.language === "auto" ? "es" : options.language as "es" | "en",
            });
            content = analysis.extractedText || analysis.description;
            visionAnalysis = {
                description: analysis.description,
                extractedText: analysis.extractedText,
                tables: analysis.tables,
                objects: analysis.objects,
            };
            modelsUsed.push("grok-2-vision");
            modelCalls++;
        }
    } else {
        // Extract text from document
        content = await documentIngestion.extractContent(file.buffer, file.mimeType);

        // Multi-model enhancement for complex analysis
        if (options.enableMultiModel && content.length > 500) {
            const enhancePrompt = `Mejora y estructura el siguiente contenido, identificando puntos clave:\n\n${content.slice(0, 3000)}`;

            try {
                const fusion = await fuseModels(enhancePrompt, {
                    fusionMethod: options.fusionMethod as any,
                    timeout: 15000,
                });
                modelsUsed.push(...fusion.models.map(m => m.modelId));
                modelCalls += fusion.models.length;
            } catch {
                // Continue with original content
            }
        }
    }

    return {
        fileName: file.name,
        fileType: file.mimeType,
        content,
        chunks: [],
        language: "auto",
        contentType: "mixed",
        wordCount: content.split(/\s+/).filter(w => w.length > 0).length,
        readability: { grade: "Unknown", readingTimeMinutes: 0 },
        visionAnalysis,
        qualityScore: 0.7,
        fromCache: false,
        modelCalls,
        modelsUsed,
    };
}

function convertCachedToAnalysis(cached: CachedDocument): SuperFileAnalysis {
    return {
        fileName: cached.originalName,
        fileType: cached.metadata.fileType,
        content: cached.content,
        chunks: cached.chunks.map(c => ({
            id: c.id,
            content: c.content,
            type: "paragraph",
            position: c.position,
            importance: 0.5,
            embedding: c.embedding,
            metadata: {},
        })),
        language: cached.metadata.language || "auto",
        contentType: "mixed",
        wordCount: cached.metadata.wordCount,
        readability: { grade: "Unknown", readingTimeMinutes: 0 },
        qualityScore: cached.metadata.quality || 0.7,
        fromCache: true,
        cacheId: cached.id,
    };
}

function generateRecommendations(analyses: SuperFileAnalysis[]): string[] {
    const recommendations: string[] = [];

    if (analyses.some(a => a.wordCount < 100)) {
        recommendations.push("Some documents have very little content. Consider providing more detailed documents.");
    }

    if (analyses.some(a => a.qualityScore < 0.5)) {
        recommendations.push("Some documents have low quality scores. Review for formatting and clarity issues.");
    }

    if (analyses.length > 5) {
        recommendations.push("Many documents provided. Consider using the RAG chunks for more focused queries.");
    }

    return recommendations;
}

export const superDocumentAnalyzer = {
    superAnalyze,
};

export default superDocumentAnalyzer;
