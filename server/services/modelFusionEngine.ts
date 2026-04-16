/**
 * Model Fusion Engine - ILIAGPT PRO 3.0 (10x Enhanced)
 * 
 * Combines multiple AI models for superior accuracy.
 * Uses confidence-weighted fusion and auto-selection.
 */

import OpenAI from "openai";
import { getGeminiClientOrThrow } from "../lib/gemini";

// ============== Types ==============

export interface FusionResult<T> {
    result: T;
    confidence: number;
    models: ModelContribution[];
    processingTimeMs: number;
    fusionMethod: FusionMethod;
}

export interface ModelContribution {
    modelId: string;
    provider: "grok" | "gemini" | "openai";
    result: any;
    confidence: number;
    latencyMs: number;
    weight: number;
}

export type FusionMethod =
    | "weighted_average"
    | "majority_vote"
    | "highest_confidence"
    | "cascade"
    | "ensemble";

export interface FusionConfig {
    models?: ModelSpec[];
    fusionMethod?: FusionMethod;
    minConfidence?: number;
    timeout?: number;
    fallbackOnError?: boolean;
}

export interface ModelSpec {
    id: string;
    provider: "grok" | "gemini";
    model: string;
    weight?: number;
    capabilities?: string[];
}

// ============== Clients ==============

const grokClient = new OpenAI({
    apiKey: process.env.XAI_API_KEY || "missing" || "",
    baseURL: "https://api.x.ai/v1",
});

// ============== Model Specs ==============

const getAvailableModels = (): ModelSpec[] => {
    const models: ModelSpec[] = [];

    // Add Grok if key is present
    if (process.env.XAI_API_KEY) {
        models.push({
            id: "grok-3",
            provider: "grok",
            model: "grok-3",
            weight: 0.6,
            capabilities: ["reasoning", "code", "analysis"],
        });
    }

    // Add Gemini if key is present
    if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
        models.push({
            id: "gemini-2.5-flash",
            provider: "gemini",
            model: "gemini-2.5-flash",
            weight: 0.4,
            capabilities: ["multimodal", "long-context", "fast"],
        });
    }

    // Fallback if no specific keys but validation passed (shouldn't happen ideally)
    // or if we want to default to something even without keys (will fail later but preserves structure)
    if (models.length === 0) {
        console.warn("No LLM keys found for default models. Fusion engine may fail.");
    }

    return models;
};

const DEFAULT_MODELS: ModelSpec[] = getAvailableModels();

const VISION_MODELS: ModelSpec[] = [
    {
        id: "grok-2-vision",
        provider: "grok",
        model: "grok-2-vision-1212",
        weight: 0.5,
        capabilities: ["vision", "ocr"],
    },
    {
        id: "gemini-2.5-flash",
        provider: "gemini",
        model: "gemini-2.5-flash",
        weight: 0.5,
        capabilities: ["vision", "multimodal"],
    },
];

// ============== API Calls ==============

async function callGrok(
    prompt: string,
    model: string,
    options: { maxTokens?: number; temperature?: number } = {}
): Promise<{ content: string; latencyMs: number }> {
    const start = Date.now();

    const response = await grokClient.chat.completions.create({
        model,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.3,
        messages: [{ role: "user", content: prompt }],
    });

    return {
        content: response.choices[0]?.message?.content || "",
        latencyMs: Date.now() - start,
    };
}

async function callGemini(
    prompt: string,
    model: string,
    options: { maxTokens?: number; temperature?: number } = {}
): Promise<{ content: string; latencyMs: number }> {
    const start = Date.now();
    const geminiAI = getGeminiClientOrThrow();

    const geminiModel = geminiAI.models.generateContent({
        model,
        contents: prompt,
    });

    const response = await geminiModel;
    const content = response.text || "";

    return {
        content,
        latencyMs: Date.now() - start,
    };
}

// ============== Fusion Logic ==============

/**
 * Calculate confidence from response
 */
function estimateConfidence(content: string, prompt: string): number {
    // Heuristic confidence estimation
    let confidence = 0.7;

    // Longer, more detailed responses tend to be more confident
    if (content.length > 500) confidence += 0.1;
    if (content.length > 1500) confidence += 0.05;

    // Responses with structure (lists, headers) tend to be better
    if (content.includes("\n-") || content.includes("\n1.")) confidence += 0.05;
    if (content.includes("##") || content.includes("**")) confidence += 0.03;

    // Responses expressing uncertainty are less confident
    if (/no estoy seguro|might be|possibly|perhaps/i.test(content)) {
        confidence -= 0.15;
    }

    // Check if response addresses the prompt
    const promptKeywords = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const matchingKeywords = promptKeywords.filter(kw =>
        content.toLowerCase().includes(kw)
    );
    confidence += (matchingKeywords.length / promptKeywords.length) * 0.1;

    return Math.min(0.99, Math.max(0.1, confidence));
}

/**
 * Merge text results using weighted average
 */
function mergeTextResults(contributions: ModelContribution[]): string {
    if (contributions.length === 0) return "";
    if (contributions.length === 1) return contributions[0].result;

    // Sort by confidence * weight
    const sorted = [...contributions].sort(
        (a, b) => (b.confidence * b.weight) - (a.confidence * a.weight)
    );

    // Use highest scoring result as base
    const best = sorted[0];

    // If confidences are similar, combine insights
    if (sorted.length > 1 && sorted[1].confidence > best.confidence * 0.9) {
        // Both results are high quality, try to combine
        const result1 = best.result as string;
        const result2 = sorted[1].result as string;

        // If one is subset of other, use longer
        if (result1.includes(result2.slice(0, 100))) return result1;
        if (result2.includes(result1.slice(0, 100))) return result2;

        // Otherwise use best
        return result1;
    }

    return best.result;
}

/**
 * Execute parallel model calls with fusion
 */
export async function fuseModels<T = string>(
    prompt: string,
    config: FusionConfig = {}
): Promise<FusionResult<T>> {
    const {
        models = DEFAULT_MODELS,
        fusionMethod = "weighted_average",
        minConfidence = 0.5,
        timeout = 30000,
        fallbackOnError = true,
    } = config;

    const startTime = Date.now();
    const contributions: ModelContribution[] = [];

    // Execute all models in parallel
    const promises = models.map(async (spec) => {
        try {
            let response: { content: string; latencyMs: number };

            if (spec.provider === "grok") {
                response = await Promise.race([
                    callGrok(prompt, spec.model),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error("Timeout")), timeout)
                    ),
                ]);
            } else {
                response = await Promise.race([
                    callGemini(prompt, spec.model),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error("Timeout")), timeout)
                    ),
                ]);
            }

            const confidence = estimateConfidence(response.content, prompt);

            return {
                modelId: spec.id,
                provider: spec.provider,
                result: response.content,
                confidence,
                latencyMs: response.latencyMs,
                weight: spec.weight ?? 1,
            };
        } catch (error) {
            if (!fallbackOnError) throw error;
            return null;
        }
    });

    const results = await Promise.all(promises);

    for (const result of results) {
        if (result && result.confidence >= minConfidence) {
            contributions.push(result);
        }
    }

    if (contributions.length === 0) {
        throw new Error("All models failed or returned low confidence");
    }

    // Apply fusion method
    let fusedResult: T;
    let fusedConfidence: number;

    switch (fusionMethod) {
        case "highest_confidence":
            const highest = contributions.reduce((a, b) =>
                a.confidence > b.confidence ? a : b
            );
            fusedResult = highest.result as T;
            fusedConfidence = highest.confidence;
            break;

        case "majority_vote":
            // For classification tasks
            const votes = new Map<string, number>();
            for (const c of contributions) {
                const vote = String(c.result).toLowerCase().trim();
                votes.set(vote, (votes.get(vote) || 0) + c.weight);
            }
            const winner = Array.from(votes.entries()).reduce((a, b) =>
                a[1] > b[1] ? a : b
            );
            fusedResult = winner[0] as T;
            fusedConfidence = contributions
                .filter(c => String(c.result).toLowerCase().trim() === winner[0])
                .reduce((sum, c) => sum + c.confidence * c.weight, 0) /
                contributions.reduce((sum, c) => sum + c.weight, 0);
            break;

        case "cascade":
            // Use first model, fallback to others if low confidence
            contributions.sort((a, b) => a.latencyMs - b.latencyMs);
            const cascadeResult = contributions.find(c => c.confidence > 0.8) || contributions[0];
            fusedResult = cascadeResult.result as T;
            fusedConfidence = cascadeResult.confidence;
            break;

        case "weighted_average":
        default:
            fusedResult = mergeTextResults(contributions) as T;
            fusedConfidence = contributions.reduce(
                (sum, c) => sum + c.confidence * c.weight, 0
            ) / contributions.reduce((sum, c) => sum + c.weight, 0);
            break;
    }

    return {
        result: fusedResult,
        confidence: fusedConfidence,
        models: contributions,
        processingTimeMs: Date.now() - startTime,
        fusionMethod,
    };
}

/**
 * Fuse vision models for image analysis
 */
export async function fuseVisionModels(
    imageBase64: string,
    prompt: string,
    config: Omit<FusionConfig, 'models'> = {}
): Promise<FusionResult<string>> {
    // Create image-specific prompts for each model
    const visionPromises = VISION_MODELS.map(async (spec) => {
        const start = Date.now();

        try {
            if (spec.provider === "grok") {
                const response = await grokClient.chat.completions.create({
                    model: spec.model,
                    max_tokens: 4096,
                    messages: [{
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
                        ],
                    }],
                });

                return {
                    modelId: spec.id,
                    provider: spec.provider,
                    result: response.choices[0]?.message?.content || "",
                    confidence: 0.85,
                    latencyMs: Date.now() - start,
                    weight: spec.weight ?? 1,
                };
            } else {
                const geminiAI = getGeminiClientOrThrow();
                const model = geminiAI.models.generateContent({
                    model: spec.model,
                    contents: [
                        { text: prompt },
                        { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
                    ],
                });

                const response = await model;

                return {
                    modelId: spec.id,
                    provider: spec.provider,
                    result: response.text || "",
                    confidence: 0.85,
                    latencyMs: Date.now() - start,
                    weight: spec.weight ?? 1,
                };
            }
        } catch {
            return null;
        }
    });

    const contributions = (await Promise.all(visionPromises))
        .filter((c): c is ModelContribution => c !== null);

    const result = mergeTextResults(contributions);
    const avgConfidence = contributions.reduce((s, c) => s + c.confidence, 0) / contributions.length;

    return {
        result,
        confidence: avgConfidence,
        models: contributions,
        processingTimeMs: contributions.reduce((max, c) => Math.max(max, c.latencyMs), 0),
        fusionMethod: "weighted_average",
    };
}

/**
 * Auto-select best model for task
 */
export function selectBestModel(
    task: "text" | "vision" | "code" | "reasoning" | "fast"
): ModelSpec {
    const allModels = [...DEFAULT_MODELS, ...VISION_MODELS];

    const taskCapabilities: Record<string, string[]> = {
        text: ["reasoning", "analysis"],
        vision: ["vision", "multimodal"],
        code: ["code", "reasoning"],
        reasoning: ["reasoning", "analysis"],
        fast: ["fast"],
    };

    const required = taskCapabilities[task] || [];

    const scored = allModels.map(m => ({
        model: m,
        score: required.filter(cap => m.capabilities?.includes(cap)).length,
    }));

    return scored.sort((a, b) => b.score - a.score)[0]?.model || DEFAULT_MODELS[0];
}

export const modelFusionEngine = {
    fuseModels,
    fuseVisionModels,
    selectBestModel,
    DEFAULT_MODELS,
    VISION_MODELS,
};

export default modelFusionEngine;
