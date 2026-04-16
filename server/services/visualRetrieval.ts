import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

export interface VisualElement {
  type: 'chart' | 'diagram' | 'table' | 'figure' | 'graph' | 'image' | 'infographic';
  description: string;
  extractedData?: Record<string, any>;
  pageNumber?: number;
  confidence: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface VisualAnalysisResult {
  elements: VisualElement[];
  summary: string;
  dataPoints: DataPoint[];
  relationships: string[];
  processingTimeMs: number;
}

export interface DataPoint {
  label: string;
  value: string | number;
  unit?: string;
  context?: string;
}

export interface ChartData {
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'area' | 'histogram' | 'other';
  title?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  series: Array<{
    name: string;
    data: Array<{ x: string | number; y: number }>;
  }>;
  annotations?: string[];
}

export async function analyzeImageWithVision(
  imageBuffer: Buffer,
  mimeType: string,
  context?: string
): Promise<VisualAnalysisResult> {
  const startTime = Date.now();
  
  if (!GEMINI_API_KEY) {
    return createFallbackAnalysis(startTime);
  }
  
  try {
    const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    
    const base64Image = imageBuffer.toString('base64');
    
    const prompt = `Analiza esta imagen en detalle. Identifica:
1. Tipo de visual (gráfico, diagrama, tabla, figura, infografía, etc.)
2. Descripción detallada del contenido
3. Datos extraídos (valores, etiquetas, tendencias)
4. Relaciones o patrones observados

${context ? `Contexto adicional: ${context}` : ''}

Responde en JSON con este formato:
{
  "type": "chart|diagram|table|figure|graph|image|infographic",
  "description": "descripción detallada",
  "extractedData": { "key": "value" },
  "dataPoints": [{"label": "...", "value": "...", "unit": "..."}],
  "relationships": ["relación 1", "relación 2"],
  "summary": "resumen ejecutivo"
}`;

    const result = await genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { 
              inlineData: {
                mimeType: mimeType,
                data: base64Image
              }
            }
          ]
        }
      ]
    });

    const responseText = result.text || '';
    
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        
        return {
          elements: [{
            type: parsed.type || 'image',
            description: parsed.description || 'Sin descripción disponible',
            extractedData: parsed.extractedData,
            confidence: 0.85
          }],
          summary: parsed.summary || parsed.description || '',
          dataPoints: parsed.dataPoints || [],
          relationships: parsed.relationships || [],
          processingTimeMs: Date.now() - startTime
        };
      } catch {
        return {
          elements: [{
            type: 'image',
            description: responseText.slice(0, 500),
            confidence: 0.6
          }],
          summary: responseText.slice(0, 200),
          dataPoints: [],
          relationships: [],
          processingTimeMs: Date.now() - startTime
        };
      }
    }
    
    return {
      elements: [{
        type: 'image',
        description: responseText.slice(0, 500) || 'No se pudo analizar la imagen',
        confidence: 0.5
      }],
      summary: responseText.slice(0, 200) || 'Análisis no disponible',
      dataPoints: [],
      relationships: [],
      processingTimeMs: Date.now() - startTime
    };
  } catch (error) {
    console.error('[VisualRetrieval] Vision analysis error:', error);
    return createFallbackAnalysis(startTime);
  }
}

function createFallbackAnalysis(startTime: number): VisualAnalysisResult {
  return {
    elements: [{
      type: 'image',
      description: 'Análisis visual no disponible - API key no configurada',
      confidence: 0
    }],
    summary: 'No se pudo realizar el análisis visual',
    dataPoints: [],
    relationships: [],
    processingTimeMs: Date.now() - startTime
  };
}

export async function extractChartData(
  imageBuffer: Buffer,
  mimeType: string
): Promise<ChartData | null> {
  if (!GEMINI_API_KEY) {
    return null;
  }
  
  try {
    const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    
    const base64Image = imageBuffer.toString('base64');
    
    const prompt = `Analiza este gráfico/chart y extrae los datos. Responde SOLO en JSON válido:
{
  "type": "bar|line|pie|scatter|area|histogram|other",
  "title": "título del gráfico",
  "xAxisLabel": "etiqueta eje X",
  "yAxisLabel": "etiqueta eje Y",
  "series": [
    {
      "name": "nombre de la serie",
      "data": [{"x": "categoría o valor", "y": valor_numérico}]
    }
  ],
  "annotations": ["notas o anotaciones visibles"]
}

Si no es un gráfico con datos numéricos, responde: {"type": "other", "series": []}`;

    const result = await genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { 
              inlineData: {
                mimeType: mimeType,
                data: base64Image
              }
            }
          ]
        }
      ]
    });

    const responseText = result.text || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      try {
        const chartData = JSON.parse(jsonMatch[0]) as ChartData;
        return chartData;
      } catch {
        return null;
      }
    }
    
    return null;
  } catch (error) {
    console.error('[VisualRetrieval] Chart extraction error:', error);
    return null;
  }
}

export async function describeVisualForRAG(
  imageBuffer: Buffer,
  mimeType: string,
  query?: string
): Promise<string> {
  if (!GEMINI_API_KEY) {
    return 'Imagen no procesada - análisis visual no disponible';
  }
  
  try {
    const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    
    const base64Image = imageBuffer.toString('base64');
    
    const prompt = query 
      ? `Analiza esta imagen en el contexto de la siguiente pregunta: "${query}". 
         Proporciona información relevante que responda a la pregunta basándote en el contenido visual.`
      : `Describe detalladamente el contenido de esta imagen. 
         Si es un gráfico, menciona los datos y tendencias.
         Si es un diagrama, explica los componentes y relaciones.
         Si es una tabla, extrae la información estructurada.`;

    const result = await genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { 
              inlineData: {
                mimeType: mimeType,
                data: base64Image
              }
            }
          ]
        }
      ]
    });

    return result.text || 'No se pudo extraer descripción de la imagen';
  } catch (error) {
    console.error('[VisualRetrieval] Description error:', error);
    return 'Error al procesar la imagen';
  }
}

export async function detectVisualElements(
  imageBuffer: Buffer,
  mimeType: string
): Promise<VisualElement[]> {
  const analysis = await analyzeImageWithVision(imageBuffer, mimeType);
  return analysis.elements;
}

export function isChartOrDiagram(description: string): boolean {
  const visualPatterns = [
    /gr[aá]fico/i,
    /chart/i,
    /diagram/i,
    /plot/i,
    /figure/i,
    /visualization/i,
    /bar\s*(graph|chart)/i,
    /pie\s*(chart|graph)/i,
    /line\s*(chart|graph)/i,
    /scatter/i,
    /histogram/i,
    /flowchart/i,
    /infograph/i,
    /timeline/i
  ];
  
  return visualPatterns.some(pattern => pattern.test(description));
}

export interface MultimodalChunk {
  type: 'text' | 'image' | 'table';
  content: string;
  imageBuffer?: Buffer;
  imageMimeType?: string;
  pageNumber?: number;
  embedding?: number[];
}

export async function createMultimodalChunks(
  textChunks: Array<{ content: string; pageNumber?: number }>,
  images: Array<{ buffer: Buffer; mimeType: string; pageNumber?: number }>
): Promise<MultimodalChunk[]> {
  const chunks: MultimodalChunk[] = [];
  
  for (const textChunk of textChunks) {
    chunks.push({
      type: 'text',
      content: textChunk.content,
      pageNumber: textChunk.pageNumber
    });
  }
  
  for (const image of images) {
    const description = await describeVisualForRAG(image.buffer, image.mimeType);
    chunks.push({
      type: 'image',
      content: description,
      imageBuffer: image.buffer,
      imageMimeType: image.mimeType,
      pageNumber: image.pageNumber
    });
  }
  
  return chunks;
}

export const visualRetrieval = {
  analyzeImageWithVision,
  extractChartData,
  describeVisualForRAG,
  detectVisualElements,
  isChartOrDiagram,
  createMultimodalChunks
};
