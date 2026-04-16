import { GoogleGenAI } from "@google/genai";

export interface SummaryConfig {
  triggerThreshold: number;
  maxSummaryTokens: number;
  summaryLanguage: 'es' | 'en';
  modelId: string;
}

export interface SummaryResult {
  summary: string;
  tokenCount: number;
  mainTopics: string[];
  keyEntities: string[];
  lastSummarizedTurn: number;
}

interface ParsedSummaryResponse {
  summary: string;
  mainTopics: string[];
  keyEntities: string[];
}

const DEFAULT_CONFIG: SummaryConfig = {
  triggerThreshold: 10,
  maxSummaryTokens: 500,
  summaryLanguage: 'en',
  modelId: 'gemini-2.0-flash',
};

const PROMPTS = {
  es: {
    summarize: `Genera un resumen conciso de esta conversación. Responde SOLO con JSON válido (sin markdown):
{
  "summary": "Resumen principal (máximo 3 párrafos)",
  "mainTopics": ["tema1", "tema2", "tema3"],
  "keyEntities": ["entidad1", "entidad2"]
}

Incluye:
- Resumen principal (máximo 3 párrafos)
- Temas principales (lista de 3-5)
- Entidades clave mencionadas (nombres, fechas, etc.)`,
    updateSummary: `Actualiza el resumen existente con la nueva información de la conversación. Responde SOLO con JSON válido (sin markdown):
{
  "summary": "Resumen actualizado (máximo 3 párrafos)",
  "mainTopics": ["tema1", "tema2", "tema3"],
  "keyEntities": ["entidad1", "entidad2"]
}

Resumen existente:
{existingSummary}

Nueva conversación a integrar:`,
    extractTopics: `Extrae los temas principales de esta conversación. Responde SOLO con un array JSON de strings:
["tema1", "tema2", "tema3"]

Máximo {maxTopics} temas.`,
  },
  en: {
    summarize: `Generate a concise summary of this conversation. Respond ONLY with valid JSON (no markdown):
{
  "summary": "Main summary (max 3 paragraphs)",
  "mainTopics": ["topic1", "topic2", "topic3"],
  "keyEntities": ["entity1", "entity2"]
}

Include:
- Main summary (max 3 paragraphs)
- Main topics (list of 3-5)
- Key entities mentioned (names, dates, etc.)`,
    updateSummary: `Update the existing summary with new conversation information. Respond ONLY with valid JSON (no markdown):
{
  "summary": "Updated summary (max 3 paragraphs)",
  "mainTopics": ["topic1", "topic2", "topic3"],
  "keyEntities": ["entity1", "entity2"]
}

Existing summary:
{existingSummary}

New conversation to integrate:`,
    extractTopics: `Extract the main topics from this conversation. Respond ONLY with a JSON array of strings:
["topic1", "topic2", "topic3"]

Maximum {maxTopics} topics.`,
  },
};

export class AutoSummarizer {
  private genai: GoogleGenAI;
  private config: SummaryConfig;

  constructor(config?: Partial<SummaryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
    if (!apiKey) {
      console.warn("[AutoSummarizer] No Gemini API key found. Set GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.");
    }
    
    this.genai = new GoogleGenAI({ apiKey });
  }

  shouldSummarize(currentTurn: number, lastSummarizedTurn: number): boolean {
    const turnsSinceLastSummary = currentTurn - lastSummarizedTurn;
    return turnsSinceLastSummary >= this.config.triggerThreshold;
  }

  async summarize(
    messages: Array<{ role: string; content: string }>,
    existingSummary?: string,
    language?: 'es' | 'en'
  ): Promise<SummaryResult> {
    const lang = language || this.config.summaryLanguage;
    const prompts = PROMPTS[lang];
    
    const transcript = this.formatTranscript(messages);
    const currentTurn = messages.length;

    let systemPrompt: string;
    if (existingSummary) {
      systemPrompt = prompts.updateSummary.replace('{existingSummary}', existingSummary);
    } else {
      systemPrompt = prompts.summarize;
    }

    try {
      const result = await this.genai.models.generateContent({
        model: this.config.modelId,
        contents: [
          {
            role: "user",
            parts: [{ text: `${systemPrompt}\n\n${transcript}` }],
          },
        ],
        config: {
          maxOutputTokens: this.config.maxSummaryTokens,
          temperature: 0.3,
        },
      });

      const responseText = result.text ?? "";
      const parsed = this.parseSummaryResponse(responseText);
      const tokenCount = this.estimateTokens(parsed.summary);

      return {
        summary: parsed.summary,
        tokenCount,
        mainTopics: parsed.mainTopics,
        keyEntities: parsed.keyEntities,
        lastSummarizedTurn: currentTurn,
      };
    } catch (error: any) {
      console.error("[AutoSummarizer] Error generating summary:", error.message);
      throw new Error(`AutoSummarizer error: ${error.message}`);
    }
  }

  async extractTopics(
    messages: Array<{ role: string; content: string }>,
    maxTopics: number = 5
  ): Promise<string[]> {
    const lang = this.config.summaryLanguage;
    const prompt = PROMPTS[lang].extractTopics.replace('{maxTopics}', String(maxTopics));
    
    const transcript = this.formatTranscript(messages);

    try {
      const result = await this.genai.models.generateContent({
        model: this.config.modelId,
        contents: [
          {
            role: "user",
            parts: [{ text: `${prompt}\n\n${transcript}` }],
          },
        ],
        config: {
          maxOutputTokens: 200,
          temperature: 0.2,
        },
      });

      const responseText = result.text ?? "";
      return this.parseTopicsResponse(responseText, maxTopics);
    } catch (error: any) {
      console.error("[AutoSummarizer] Error extracting topics:", error.message);
      throw new Error(`AutoSummarizer topic extraction error: ${error.message}`);
    }
  }

  private formatTranscript(messages: Array<{ role: string; content: string }>): string {
    return messages
      .map((msg) => {
        const roleLabel = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "System";
        return `${roleLabel}: ${msg.content}`;
      })
      .join("\n\n");
  }

  private parseSummaryResponse(responseText: string): ParsedSummaryResponse {
    const cleaned = responseText
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
      return {
        summary: typeof parsed.summary === "string" ? parsed.summary : "",
        mainTopics: Array.isArray(parsed.mainTopics) 
          ? parsed.mainTopics.filter((t: unknown) => typeof t === "string").slice(0, 5)
          : [],
        keyEntities: Array.isArray(parsed.keyEntities)
          ? parsed.keyEntities.filter((e: unknown) => typeof e === "string").slice(0, 10)
          : [],
      };
    } catch {
      console.warn("[AutoSummarizer] Failed to parse JSON response, using fallback extraction");
      return this.fallbackParseSummary(responseText);
    }
  }

  private fallbackParseSummary(text: string): ParsedSummaryResponse {
    const lines = text.split("\n").filter((l) => l.trim());
    
    let summary = "";
    const topics: string[] = [];
    const entities: string[] = [];

    let section = "summary";
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.includes("topic") || lower.includes("tema")) {
        section = "topics";
        continue;
      }
      if (lower.includes("entit") || lower.includes("entidad")) {
        section = "entities";
        continue;
      }

      const cleanLine = line.replace(/^[-*•]\s*/, "").trim();
      if (!cleanLine) continue;

      if (section === "summary") {
        summary += (summary ? " " : "") + cleanLine;
      } else if (section === "topics" && topics.length < 5) {
        topics.push(cleanLine);
      } else if (section === "entities" && entities.length < 10) {
        entities.push(cleanLine);
      }
    }

    return {
      summary: summary || text.slice(0, 500),
      mainTopics: topics,
      keyEntities: entities,
    };
  }

  private parseTopicsResponse(responseText: string, maxTopics: number): string[] {
    const cleaned = responseText
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return parsed.filter((t: unknown) => typeof t === "string").slice(0, maxTopics);
      }
    } catch {
      const matches = cleaned.match(/["']([^"']+)["']/g);
      if (matches) {
        return matches
          .map((m) => m.replace(/["']/g, ""))
          .slice(0, maxTopics);
      }
    }

    return [];
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
