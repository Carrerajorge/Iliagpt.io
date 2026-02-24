import { llmGateway } from "./llmGateway";
import { Logger } from "../lib/logger";

export interface ImrydSection {
    title: string;
    content: string;
    confidenceScore: number;
}

export interface ImrydExtraction {
    introduction: ImrydSection;
    methods: ImrydSection;
    results: ImrydSection;
    discussion: ImrydSection; // Or Conclusions
    metadata?: {
        modelUsed: string;
        extractionTimeMs: number;
    };
}

export class ImrydExtractor {
    private static logger = Logger;

    /**
     * Extracts the IMRyD structure (Introduction, Methods, Results, Discussion) from a given academic text.
     * This uses the llmGateway to intelligently parse structure even if headings are missing or non-standard.
     */
    static async extract(paperText: string, modelId: string = "gemini-2.5-flash"): Promise<ImrydExtraction> {
        const startTime = Date.now();

        // Quick validation
        if (!paperText || paperText.trim().length < 100) {
            throw new Error("Text is too short to extract IMRyD structure.");
        }

        // Limit text length to avoid token limits (approx 50k chars is safe for most modern models)
        const MAX_CHARS = 5000000;
        let textToProcess = paperText;
        if (paperText.length > MAX_CHARS) {
            this.logger.warn(`Paper text exceeds ${MAX_CHARS} chars. Truncating for IMRyD extraction.`);
            textToProcess = paperText.substring(0, MAX_CHARS);
        }

        const systemPrompt = `You are an expert academic research assistant. 
Your task is to analyze the provided academic text and extract its core structure following the IMRyD format.
You must return a valid JSON object matching the exact structure requested, with no markdown formatting around it.

Required JSON structure:
{
  "introduction": { "title": "Introduction", "content": "Summary of introduction, background, and objectives...", "confidenceScore": 0.9 },
  "methods": { "title": "Methods", "content": "Summary of methodology, data collection, and analysis...", "confidenceScore": 0.8 },
  "results": { "title": "Results", "content": "Summary of main findings and data...", "confidenceScore": 0.9 },
  "discussion": { "title": "Discussion/Conclusion", "content": "Summary of implications, limitations, and conclusions...", "confidenceScore": 0.8 }
}

Guidelines:
1. Extract the most salient points for each section. Do not just copy-paste; synthesize if necessary, but keep the core facts.
2. If a section is missing (e.g., it's a review paper without methods), infer the closest equivalent or provide a brief statement explaining its absence, but keep the confidenceScore low.
3. The confidenceScore should be between 0.0 and 1.0, representing how clearly that section was defined in the source text.
4. ONLY return valid JSON. Do not include \`\`\`json or any other text.`;

        try {
            this.logger.info(`Starting IMRyD extraction using model ${modelId}, text length: ${textToProcess.length}`);

            const responseText = await llmGateway.generateText({
                modelId,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Please extract the IMRyD structure from this text:\n\n${textToProcess}` }
                ],
                temperature: 0.1, // Low temperature for more deterministic extraction
                maxTokens: 4000
            });

            // Try to parse the response. Sometimes models wrap it in markdown even when told not to.
            let cleanedJson = responseText.trim();
            if (cleanedJson.startsWith("```json")) {
                cleanedJson = cleanedJson.replace(/```json\n?/, "").replace(/```$/, "").trim();
            } else if (cleanedJson.startsWith("```")) {
                cleanedJson = cleanedJson.replace(/```\n?/, "").replace(/```$/, "").trim();
            }

            const parsed: ImrydExtraction = JSON.parse(cleanedJson);

            // Add metadata
            parsed.metadata = {
                modelUsed: modelId,
                extractionTimeMs: Date.now() - startTime
            };

            this.logger.info(`Successfully extracted IMRyD structure in ${parsed.metadata.extractionTimeMs}ms`);
            return parsed;

        } catch (error: any) {
            this.logger.error("Failed to extract IMRyD structure", { error: error.message });
            throw new Error(`IMRyD extraction failed: ${error.message}`);
        }
    }
}
