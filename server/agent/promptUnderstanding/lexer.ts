/**
 * Lexer/Segmenter Module
 * 
 * Responsible for breaking down input text into semantic units (blocks).
 * Supports incremental processing by buffering incomplete chunks.
 */

export interface TextBlock {
    id: string;
    type: "sentence" | "list_item" | "delimiter" | "code_block" | "key_value";
    content: string;
    index: number;
    metadata?: Record<string, any>;
}

export class Lexer {
    private buffer: string = "";
    private blockIndex: number = 0;

    constructor() { }

    /**
     * Process a chunk of text and return identified blocks.
     * Keeps remaining incomplete text in buffer.
     */
    processChunk(chunk: string): TextBlock[] {
        this.buffer += chunk;
        const blocks: TextBlock[] = [];

        // 1. Extract Code Blocks first (they are distinct boundaries)
        // Regex for ```code``` blocks
        const codeBlockRegex = /```[\s\S]*?```/g;
        let lastIndex = 0;
        let match;

        // We process the buffer but need to be careful not to process incomplete blocks at the end
        // unless we are finishing. For this simplified version, we'll process what we can.

        // NOTE: A robust streaming lexer is complex. We will implement a simplified version
        // that splits by newlines and punctuation, identifying list items.

        // Split by newlines to handle list items and paragraphs
        const lines = this.buffer.split(/\r?\n/);

        // We keep the last line in the buffer as it might be incomplete
        // UNLESS the chunk ends with a newline, but even then, more text might come.
        // Safe heuristic: keep the last line in buffer.
        const completedLines = lines.slice(0, -1);
        this.buffer = lines[lines.length - 1];

        for (const line of completedLines) {
            if (!line.trim()) continue; // Skip empty lines

            // Check for List Items
            if (/^(\d+\.|-|\*)\s+/.test(line.trim())) {
                blocks.push(this.createBlock("list_item", line.trim()));
                continue;
            }

            // Check for Key-Value pairs (e.g., "Language: English")
            if (/^[\w\s]+:\s+.+/.test(line.trim())) {
                blocks.push(this.createBlock("key_value", line.trim()));
                continue;
            }

            // Default: Sentences
            // Split line into sentences
            // Regex explanation: Split by .!? followed by space or end of line.
            const sentences = line.trim().split(/([.!?]+(?:\s+|$))/).filter(s => s.trim().length > 0);

            let currentSentence = "";
            for (let i = 0; i < sentences.length; i++) {
                const part = sentences[i];
                if (/^[.!?]+\s*$/.test(part)) {
                    // It's punctuation, append to previous
                    currentSentence += part;
                    if (currentSentence.trim()) {
                        blocks.push(this.createBlock("sentence", currentSentence.trim()));
                        currentSentence = "";
                    }
                } else {
                    // If we have a pending sentence (missing punctuation), push it?
                    // Or accumulate? The split keeps delimiters.
                    // Re-assembling logic:
                    if (currentSentence) {
                        // If we are here, it means we had a sentence part, and now another part without punctuation in between?
                        // The regex split should separate sentence text and punctuation.
                        // Actually, the split puts the delimiter in the array.
                        // "Hello. World." -> ["Hello", ".", "World", ".", ""]
                        currentSentence += part;
                    } else {
                        currentSentence = part;
                    }
                }
            }
            if (currentSentence.trim()) {
                blocks.push(this.createBlock("sentence", currentSentence.trim()));
            }
        }

        return blocks;
    }

    /**
   * Flush any remaining buffer as a block.
   */
    flush(): TextBlock[] {
        // Treat the buffer as a final "line" to process
        if (!this.buffer.trim()) return [];

        // We can reuse the processing logic by mocking it or extracting it.
        // For simplicity, let's just duplicate the sentence splitting logic here 
        // or better, make a private method `processLine`.

        const blocks: TextBlock[] = [];
        const line = this.buffer;

        // Check for List Items
        if (/^(\d+\.|-|\*)\s+/.test(line.trim())) {
            blocks.push(this.createBlock("list_item", line.trim()));
            return blocks;
        }

        // Check for Key-Value pairs
        if (/^[\w\s]+:\s+.+/.test(line.trim()) && !line.includes(".")) {
            const blk = this.createBlock("key_value", line.trim());
            blocks.push(blk);
            return blocks;
        }

        // Split sentences
        const sentences = line.trim().split(/([.!?]+(?:\s+|$))/).filter(s => s.trim().length > 0);
        let currentSentence = "";
        for (let i = 0; i < sentences.length; i++) {
            const part = sentences[i];
            if (/^[.!?]+\s*$/.test(part)) {
                // It's punctuation
                currentSentence += part;
                if (currentSentence.trim()) {
                    const blk = this.createBlock("sentence", currentSentence.trim());
                    blocks.push(blk);
                    currentSentence = "";
                }
            } else {
                if (currentSentence) {
                    currentSentence += part;
                } else {
                    currentSentence = part;
                }
            }
        }
        if (currentSentence.trim()) {
            const blk = this.createBlock("sentence", currentSentence.trim());
            blocks.push(blk);
        }

        this.buffer = "";
        return blocks;
    }

    private createBlock(type: TextBlock["type"], content: string): TextBlock {
        return {
            id: `blk_${this.blockIndex++}`,
            type,
            content,
            index: this.blockIndex
        };
    }

    reset() {
        this.buffer = "";
        this.blockIndex = 0;
    }
}
