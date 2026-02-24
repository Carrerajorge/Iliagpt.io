/**
 * Long Context Chunker
 * 
 * Handles prompts that exceed token limits by splitting into semantic chunks
 * and merging partial UserSpecs.
 */

import { UserSpec, TaskSpec, ConstraintSpec, RiskSpec } from "./types";

export interface ChunkConfig {
    maxTokensPerChunk: number;
    overlapTokens: number;
    preserveSentences: boolean;
}

const DEFAULT_CONFIG: ChunkConfig = {
    maxTokensPerChunk: 4000,
    overlapTokens: 200,
    preserveSentences: true
};

export interface TextChunk {
    index: number;
    text: string;
    startOffset: number;
    endOffset: number;
    estimatedTokens: number;
}

export class LongContextChunker {
    private config: ChunkConfig;

    constructor(config: Partial<ChunkConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Estimate token count (rough approximation: 1 token ≈ 4 chars)
     */
    estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    /**
     * Check if text needs chunking
     */
    needsChunking(text: string): boolean {
        return this.estimateTokens(text) > this.config.maxTokensPerChunk;
    }

    /**
     * Split text into semantic chunks
     */
    chunk(text: string): TextChunk[] {
        if (!this.needsChunking(text)) {
            return [{
                index: 0,
                text,
                startOffset: 0,
                endOffset: text.length,
                estimatedTokens: this.estimateTokens(text)
            }];
        }

        const chunks: TextChunk[] = [];
        const maxChars = this.config.maxTokensPerChunk * 4;
        const overlapChars = this.config.overlapTokens * 4;

        if (this.config.preserveSentences) {
            // Split by sentences first
            const sentences = text.split(/(?<=[.!?])\s+/);
            let currentChunk = "";
            let startOffset = 0;
            let chunkIndex = 0;

            for (let i = 0; i < sentences.length; i++) {
                const sentence = sentences[i];

                if ((currentChunk + " " + sentence).length > maxChars && currentChunk.length > 0) {
                    // Save current chunk
                    chunks.push({
                        index: chunkIndex++,
                        text: currentChunk.trim(),
                        startOffset,
                        endOffset: startOffset + currentChunk.length,
                        estimatedTokens: this.estimateTokens(currentChunk)
                    });

                    // Start new chunk with overlap
                    const overlapStart = Math.max(0, currentChunk.length - overlapChars);
                    const overlap = currentChunk.substring(overlapStart);
                    startOffset = startOffset + currentChunk.length - overlap.length;
                    currentChunk = overlap + " " + sentence;
                } else {
                    currentChunk = currentChunk ? currentChunk + " " + sentence : sentence;
                }
            }

            // Add remaining text
            if (currentChunk.trim()) {
                chunks.push({
                    index: chunkIndex,
                    text: currentChunk.trim(),
                    startOffset,
                    endOffset: text.length,
                    estimatedTokens: this.estimateTokens(currentChunk)
                });
            }
        } else {
            // Simple character-based splitting
            let offset = 0;
            let chunkIndex = 0;

            while (offset < text.length) {
                const end = Math.min(offset + maxChars, text.length);
                const chunkText = text.substring(offset, end);

                chunks.push({
                    index: chunkIndex++,
                    text: chunkText,
                    startOffset: offset,
                    endOffset: end,
                    estimatedTokens: this.estimateTokens(chunkText)
                });

                offset = end - overlapChars;
                if (offset >= text.length) break;
            }
        }

        return chunks;
    }

    /**
     * Merge multiple partial UserSpecs into one
     */
    mergeSpecs(specs: UserSpec[]): UserSpec {
        if (specs.length === 0) {
            throw new Error("Cannot merge empty specs array");
        }

        if (specs.length === 1) {
            return specs[0];
        }

        const merged: UserSpec = {
            // Use first non-empty goal
            goal: specs.find(s => s.goal && s.goal.length > 10)?.goal || specs[0].goal,

            // Merge tasks (deduplicate by verb+object)
            tasks: this.mergeTasks(specs.flatMap(s => s.tasks)),

            // Merge inputs (later specs override)
            inputs_provided: specs.reduce((acc, s) => ({ ...acc, ...s.inputs_provided }), {}),

            // Merge missing inputs (deduplicate)
            missing_inputs: [...new Set(specs.flatMap(s => s.missing_inputs))],

            // Merge constraints (deduplicate by type+value)
            constraints: this.mergeConstraints(specs.flatMap(s => s.constraints)),

            // Merge success criteria (deduplicate)
            success_criteria: [...new Set(specs.flatMap(s => s.success_criteria))],

            // Merge assumptions (deduplicate)
            assumptions: [...new Set(specs.flatMap(s => s.assumptions))],

            // Merge risks (deduplicate by type+description)
            risks: this.mergeRisks(specs.flatMap(s => s.risks)),

            // Merge questions (deduplicate)
            questions: [...new Set(specs.flatMap(s => s.questions))],

            // Average confidence
            confidence: specs.reduce((sum, s) => sum + s.confidence, 0) / specs.length
        };

        return merged;
    }

    private mergeTasks(tasks: TaskSpec[]): TaskSpec[] {
        const seen = new Set<string>();
        return tasks.filter(t => {
            const key = `${t.verb}:${t.object?.substring(0, 50)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    private mergeConstraints(constraints: ConstraintSpec[]): ConstraintSpec[] {
        const seen = new Set<string>();
        return constraints.filter(c => {
            const key = `${c.type}:${c.value}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    private mergeRisks(risks: RiskSpec[]): RiskSpec[] {
        const seen = new Set<string>();
        return risks.filter(r => {
            const key = `${r.type}:${r.description}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
}
