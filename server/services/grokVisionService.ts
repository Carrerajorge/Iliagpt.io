/**
 * Grok Vision Service - ILIAGPT PRO 3.0
 * 
 * Image analysis using Grok 2 Vision API.
 * Extracts text, tables, charts, and descriptions from images.
 */

import OpenAI from "openai";

// ============== Types ==============

export interface VisionAnalysisResult {
    description: string;
    extractedText?: string;
    tables?: ExtractedTable[];
    charts?: ExtractedChart[];
    objects?: DetectedObject[];
    confidence: number;
    processingTimeMs: number;
}

export interface ExtractedTable {
    headers: string[];
    rows: string[][];
    caption?: string;
    position?: { x: number; y: number; width: number; height: number };
}

export interface ExtractedChart {
    type: "bar" | "line" | "pie" | "scatter" | "other";
    title?: string;
    description: string;
    dataPoints?: { label: string; value: number }[];
}

export interface DetectedObject {
    name: string;
    confidence: number;
    position?: { x: number; y: number; width: number; height: number };
}

export interface VisionConfig {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    extractTables?: boolean;
    extractCharts?: boolean;
    extractText?: boolean;
    language?: "es" | "en" | "auto";
}

// ============== Grok Client ==============

const grokClient = new OpenAI({
    apiKey: process.env.XAI_API_KEY || "missing" || "",
    baseURL: "https://api.x.ai/v1",
});

const VISION_MODEL = "grok-2-vision-1212";

// ============== Prompts ==============

const ANALYSIS_PROMPT = {
    es: `Analiza esta imagen detalladamente. 
  
Proporciona:
1. **Descripción**: Qué muestra la imagen
2. **Texto visible**: Todo el texto que puedas leer (si hay)
3. **Tablas**: Si hay tablas, extrae headers y filas
4. **Gráficos**: Si hay gráficos, describe tipo y datos
5. **Objetos**: Elementos principales detectados

Responde en formato JSON estructurado:
{
  "description": "...",
  "extractedText": "...",
  "tables": [{"headers": [...], "rows": [[...]], "caption": "..."}],
  "charts": [{"type": "...", "title": "...", "description": "...", "dataPoints": [...]}],
  "objects": [{"name": "...", "confidence": 0.95}]
}`,

    en: `Analyze this image in detail.

Provide:
1. **Description**: What the image shows
2. **Visible text**: All readable text (if any)
3. **Tables**: If tables exist, extract headers and rows
4. **Charts**: If charts exist, describe type and data
5. **Objects**: Main detected elements

Respond in structured JSON format:
{
  "description": "...",
  "extractedText": "...",
  "tables": [{"headers": [...], "rows": [[...]], "caption": "..."}],
  "charts": [{"type": "...", "title": "...", "description": "...", "dataPoints": [...]}],
  "objects": [{"name": "...", "confidence": 0.95}]
}`,
};

const OCR_PROMPT = `Extract ALL text visible in this image. 
Maintain the original layout and formatting as much as possible.
Include headers, paragraphs, labels, captions, and any other text.
Return only the extracted text, no additional commentary.`;

const TABLE_PROMPT = `Analyze this image for tables.
Extract all tables with their headers and data rows.
Return as JSON: {"tables": [{"headers": [...], "rows": [[...]], "caption": "..."}]}
If no tables, return {"tables": []}`;

// ============== Main Functions ==============

/**
 * Analyze image with Grok Vision
 */
export async function analyzeImage(
    imageSource: string | Buffer,
    config: VisionConfig = {}
): Promise<VisionAnalysisResult> {
    const startTime = Date.now();
    const {
        model = VISION_MODEL,
        maxTokens = 4096,
        temperature = 0.3,
        language = "es",
    } = config;

    // Convert buffer to base64 if needed
    let imageUrl: string;
    if (Buffer.isBuffer(imageSource)) {
        const base64 = imageSource.toString("base64");
        imageUrl = `data:image/jpeg;base64,${base64}`;
    } else {
        imageUrl = imageSource;
    }

    const prompt = ANALYSIS_PROMPT[language === "auto" ? "es" : language];

    try {
        const response = await grokClient.chat.completions.create({
            model,
            max_tokens: maxTokens,
            temperature,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: { url: imageUrl } },
                    ],
                },
            ],
        });

        const content = response.choices[0]?.message?.content || "";
        const processingTimeMs = Date.now() - startTime;

        // Parse JSON response
        try {
            // Extract JSON from response (may have markdown code blocks)
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    description: parsed.description || "",
                    extractedText: parsed.extractedText || undefined,
                    tables: parsed.tables?.length > 0 ? parsed.tables : undefined,
                    charts: parsed.charts?.length > 0 ? parsed.charts : undefined,
                    objects: parsed.objects?.length > 0 ? parsed.objects : undefined,
                    confidence: 0.9,
                    processingTimeMs,
                };
            }
        } catch {
            // If JSON parsing fails, return raw description
        }

        return {
            description: content,
            confidence: 0.7,
            processingTimeMs,
        };
    } catch (error) {
        console.error("Grok Vision error:", error);
        throw new Error(
            `Vision analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`
        );
    }
}

/**
 * Extract text from image (OCR-like)
 */
export async function extractTextFromImage(
    imageSource: string | Buffer,
    config: Omit<VisionConfig, 'extractTables' | 'extractCharts'> = {}
): Promise<{ text: string; confidence: number; processingTimeMs: number }> {
    const startTime = Date.now();
    const { model = VISION_MODEL, maxTokens = 2048 } = config;

    let imageUrl: string;
    if (Buffer.isBuffer(imageSource)) {
        const base64 = imageSource.toString("base64");
        imageUrl = `data:image/jpeg;base64,${base64}`;
    } else {
        imageUrl = imageSource;
    }

    try {
        const response = await grokClient.chat.completions.create({
            model,
            max_tokens: maxTokens,
            temperature: 0.1,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: OCR_PROMPT },
                        { type: "image_url", image_url: { url: imageUrl } },
                    ],
                },
            ],
        });

        const text = response.choices[0]?.message?.content || "";

        return {
            text: text.trim(),
            confidence: text.length > 10 ? 0.85 : 0.5,
            processingTimeMs: Date.now() - startTime,
        };
    } catch (error) {
        console.error("Text extraction error:", error);
        throw error;
    }
}

/**
 * Extract tables from image
 */
export async function extractTablesFromImage(
    imageSource: string | Buffer,
    config: Omit<VisionConfig, 'extractCharts' | 'extractText'> = {}
): Promise<{ tables: ExtractedTable[]; processingTimeMs: number }> {
    const startTime = Date.now();
    const { model = VISION_MODEL, maxTokens = 4096 } = config;

    let imageUrl: string;
    if (Buffer.isBuffer(imageSource)) {
        const base64 = imageSource.toString("base64");
        imageUrl = `data:image/jpeg;base64,${base64}`;
    } else {
        imageUrl = imageSource;
    }

    try {
        const response = await grokClient.chat.completions.create({
            model,
            max_tokens: maxTokens,
            temperature: 0.2,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: TABLE_PROMPT },
                        { type: "image_url", image_url: { url: imageUrl } },
                    ],
                },
            ],
        });

        const content = response.choices[0]?.message?.content || "";

        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    tables: parsed.tables || [],
                    processingTimeMs: Date.now() - startTime,
                };
            }
        } catch {
            // Parsing failed
        }

        return {
            tables: [],
            processingTimeMs: Date.now() - startTime,
        };
    } catch (error) {
        console.error("Table extraction error:", error);
        throw error;
    }
}

/**
 * Describe image for accessibility/alt text
 */
export async function describeImage(
    imageSource: string | Buffer,
    config: { language?: "es" | "en"; maxLength?: number } = {}
): Promise<string> {
    const { language = "es", maxLength = 200 } = config;

    const prompt = language === "es"
        ? `Describe esta imagen brevemente en ${maxLength} caracteres máximo para uso como texto alternativo.`
        : `Describe this image briefly in ${maxLength} characters max for use as alt text.`;

    let imageUrl: string;
    if (Buffer.isBuffer(imageSource)) {
        const base64 = imageSource.toString("base64");
        imageUrl = `data:image/jpeg;base64,${base64}`;
    } else {
        imageUrl = imageSource;
    }

    try {
        const response = await grokClient.chat.completions.create({
            model: VISION_MODEL,
            max_tokens: 100,
            temperature: 0.3,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: { url: imageUrl } },
                    ],
                },
            ],
        });

        return response.choices[0]?.message?.content?.slice(0, maxLength) || "";
    } catch (error) {
        console.error("Image description error:", error);
        return "";
    }
}

export const grokVisionService = {
    analyzeImage,
    extractTextFromImage,
    extractTablesFromImage,
    describeImage,
    VISION_MODEL,
};

export default grokVisionService;
