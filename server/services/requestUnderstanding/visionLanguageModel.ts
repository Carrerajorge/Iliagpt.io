/**
 * Vision Language Model (VLM) Service
 *
 * Extracts structured content from images using a multimodal LLM.
 * This runs BEFORE the Request-Understanding Agent to provide
 * image analyses that feed into the canonical brief.
 *
 * Capabilities:
 *   - OCR extraction (text in images)
 *   - Chart/diagram data extraction
 *   - Layout understanding (UI mockups, documents)
 *   - Structured data output (tables, key-value pairs)
 *   - Content type classification
 */

import { GoogleGenAI } from '@google/genai';
import { withSpan } from '../../lib/tracing';
import crypto from 'crypto';
import { LRUCache } from 'lru-cache';

// ============================================================================
// Configuration
// ============================================================================

const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.VITEST_WORKER_ID;
const genAI = !isTestEnv && process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const VLM_MODEL = process.env.VLM_MODEL || 'gemini-2.5-flash';
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
const CONCURRENT_LIMIT = 3;

// Cache for repeated image analyses
const vlmCache = new LRUCache<string, VLMAnalysisResult>({
  max: 200,
  ttl: 1000 * 60 * 60, // 1 hour
});

// Semaphore for concurrency control
let activeRequests = 0;
const requestQueue: Array<{ resolve: () => void }> = [];

async function acquireSemaphore(): Promise<void> {
  if (activeRequests < CONCURRENT_LIMIT) {
    activeRequests++;
    return;
  }
  return new Promise(resolve => {
    requestQueue.push({ resolve });
  });
}

function releaseSemaphore(): void {
  activeRequests--;
  if (requestQueue.length > 0) {
    const next = requestQueue.shift()!;
    activeRequests++;
    next.resolve();
  }
}

// ============================================================================
// Types
// ============================================================================

export interface VLMInput {
  /** Image as Buffer */
  imageBuffer: Buffer;
  /** MIME type of the image */
  mimeType: string;
  /** Optional filename for reference */
  fileName?: string;
  /** Optional context from user's message to guide analysis */
  userContext?: string;
}

export interface VLMAnalysisResult {
  /** Unique ID for this analysis */
  analysisId: string;
  /** What the image shows */
  description: string;
  /** All text extracted from the image */
  extractedText: string;
  /** Classification of image content */
  contentType: 'chart' | 'diagram' | 'screenshot' | 'photo' | 'table' |
    'handwriting' | 'document_scan' | 'infographic' | 'ui_mockup' |
    'map' | 'logo' | 'other';
  /** Structured data points extracted */
  dataPoints: Array<{
    label: string;
    value: string;
    confidence: number;
  }>;
  /** If the image contains a table, the parsed table */
  tableData?: {
    headers: string[];
    rows: string[][];
  };
  /** If the image is a chart, extracted chart data */
  chartData?: {
    chartType: string;
    title?: string;
    xAxis?: string;
    yAxis?: string;
    series: Array<{
      name: string;
      values: Array<{ x: string; y: string }>;
    }>;
  };
  /** Spatial layout information */
  layoutRegions?: Array<{
    type: 'header' | 'body' | 'footer' | 'sidebar' | 'title' | 'caption' | 'navigation';
    content: string;
    boundingBox?: { x: number; y: number; width: number; height: number };
  }>;
  /** How this image relates to the user request */
  relevanceToRequest: string;
  /** Overall confidence in the analysis */
  confidence: number;
  /** Processing time */
  processingTimeMs: number;
}

// ============================================================================
// Prompt Construction
// ============================================================================

function buildVLMPrompt(userContext?: string): string {
  return `Analiza esta imagen en detalle y extrae TODA la información posible. Responde en JSON con esta estructura exacta:

{
  "description": "Descripción completa de lo que muestra la imagen",
  "extractedText": "Todo el texto visible en la imagen, preservando formato",
  "contentType": "uno de: chart, diagram, screenshot, photo, table, handwriting, document_scan, infographic, ui_mockup, map, logo, other",
  "dataPoints": [
    {"label": "nombre del dato", "value": "valor", "confidence": 0.95}
  ],
  "tableData": {
    "headers": ["Col1", "Col2"],
    "rows": [["val1", "val2"]]
  },
  "chartData": {
    "chartType": "bar/line/pie/scatter/etc",
    "title": "título del gráfico",
    "xAxis": "etiqueta eje X",
    "yAxis": "etiqueta eje Y",
    "series": [{"name": "serie", "values": [{"x": "etiqueta", "y": "valor"}]}]
  },
  "layoutRegions": [
    {"type": "header/body/footer/sidebar/title/caption/navigation", "content": "texto de la región"}
  ],
  "relevanceToRequest": "Cómo se relaciona esta imagen con el contexto del usuario",
  "confidence": 0.85
}

REGLAS:
1. extractedText: Incluye TODO el texto visible, incluyendo números, etiquetas, leyendas.
2. dataPoints: Extrae cada dato cuantificable (números, porcentajes, fechas, cantidades).
3. tableData: Solo incluye si realmente hay una tabla visible. Null si no hay.
4. chartData: Solo incluye si hay un gráfico. Extrae los valores reales si son legibles.
5. layoutRegions: Describe las regiones principales del layout visual.
6. confidence: Tu confianza global en la precisión del análisis (0.0-1.0).

${userContext ? `CONTEXTO DEL USUARIO: ${userContext}` : ''}

Responde SOLO con el JSON. Sin texto adicional.`;
}

// ============================================================================
// Core Analysis
// ============================================================================

async function analyzeImageInternal(input: VLMInput): Promise<VLMAnalysisResult> {
  if (!genAI) {
    return createFallbackResult(input);
  }

  if (input.imageBuffer.length > MAX_IMAGE_SIZE) {
    throw new Error(`Image too large: ${(input.imageBuffer.length / (1024 * 1024)).toFixed(1)}MB exceeds ${MAX_IMAGE_SIZE / (1024 * 1024)}MB limit`);
  }

  const prompt = buildVLMPrompt(input.userContext);
  const base64Image = input.imageBuffer.toString('base64');

  const result = await (genAI as any).models.generateContent({
    model: VLM_MODEL,
    contents: [{
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType: input.mimeType,
            data: base64Image,
          },
        },
        { text: prompt },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
    },
  });

  const rawText = result.text || '{}';
  let parsed: any;
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
  } catch {
    console.warn('[VLM] Failed to parse response, using fallback');
    return createFallbackResult(input);
  }

  return {
    analysisId: crypto.randomUUID(),
    description: parsed.description || 'Image content',
    extractedText: parsed.extractedText || '',
    contentType: parsed.contentType || 'other',
    dataPoints: (parsed.dataPoints || []).map((dp: any) => ({
      label: String(dp.label || ''),
      value: String(dp.value || ''),
      confidence: Number(dp.confidence) || 0.5,
    })),
    tableData: parsed.tableData && parsed.tableData.headers
      ? {
        headers: parsed.tableData.headers.map(String),
        rows: (parsed.tableData.rows || []).map((r: any[]) => r.map(String)),
      }
      : undefined,
    chartData: parsed.chartData && parsed.chartData.chartType
      ? parsed.chartData
      : undefined,
    layoutRegions: parsed.layoutRegions || undefined,
    relevanceToRequest: parsed.relevanceToRequest || 'Imagen adjunta por el usuario',
    confidence: Number(parsed.confidence) || 0.5,
    processingTimeMs: 0, // Will be set by caller
  };
}

function createFallbackResult(input: VLMInput): VLMAnalysisResult {
  return {
    analysisId: crypto.randomUUID(),
    description: `Imagen ${input.fileName || 'sin nombre'} (${input.mimeType})`,
    extractedText: '',
    contentType: 'other',
    dataPoints: [],
    relevanceToRequest: 'No se pudo analizar la imagen (servicio no disponible)',
    confidence: 0,
    processingTimeMs: 0,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Analyze a single image using the VLM.
 */
export async function analyzeImage(input: VLMInput): Promise<VLMAnalysisResult> {
  const cacheKey = crypto.createHash('md5').update(input.imageBuffer).digest('hex');
  const cached = vlmCache.get(cacheKey);
  if (cached) return { ...cached };

  return withSpan('vlm.analyze_image', async (span) => {
    span.setAttribute('vlm.mime_type', input.mimeType);
    span.setAttribute('vlm.image_size', input.imageBuffer.length);
    span.setAttribute('vlm.file_name', input.fileName || 'unknown');

    const startTime = Date.now();

    await acquireSemaphore();
    try {
      const result = await analyzeImageInternal(input);
      result.processingTimeMs = Date.now() - startTime;

      span.setAttribute('vlm.content_type', result.contentType);
      span.setAttribute('vlm.confidence', result.confidence);
      span.setAttribute('vlm.data_points_count', result.dataPoints.length);
      span.setAttribute('vlm.extracted_text_length', result.extractedText.length);
      span.setAttribute('vlm.processing_time_ms', result.processingTimeMs);

      vlmCache.set(cacheKey, result);
      return result;
    } finally {
      releaseSemaphore();
    }
  });
}

/**
 * Analyze multiple images in parallel (respecting concurrency limits).
 */
export async function analyzeImages(inputs: VLMInput[]): Promise<VLMAnalysisResult[]> {
  if (inputs.length === 0) return [];

  return withSpan('vlm.analyze_batch', async (span) => {
    span.setAttribute('vlm.batch_size', inputs.length);
    const results = await Promise.all(inputs.map(input => analyzeImage(input)));
    return results;
  });
}

export const visionLanguageModel = {
  analyzeImage,
  analyzeImages,
};
