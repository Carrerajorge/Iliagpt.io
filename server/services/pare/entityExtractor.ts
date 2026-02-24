import { Entity, EntityType, EntityPattern } from "./types";
import * as fs from 'fs';
import * as path from 'path';
import { resolveSafePath } from '../../utils/pathSecurity';

const ENTITY_PATTERNS: EntityPattern[] = [
  { type: "url", pattern: "https?://[^\\s<>\"{}|\\\\^`\\[\\]]+" },
  { type: "file_path", pattern: "(?:[a-zA-Z]:)?[\\\\/]?(?:[\\w.-]+[\\\\/])*[\\w.-]+\\.[a-zA-Z0-9]+", normalizer: "path" },
  { type: "date_time", pattern: "\\b\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}\\b", normalizer: "datetime" },
  { type: "date_time", pattern: "\\b(hoy|mañana|ayer|today|tomorrow|yesterday)\\b", normalizer: "datetime" },
  { type: "date_time", pattern: "\\b\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*(?:am|pm))?\\b", normalizer: "datetime" },
  { type: "number", pattern: "\\b\\d+(?:[,.]\\d+)*\\b", normalizer: "number" },
  { type: "programming_language", pattern: "\\b(python|javascript|typescript|java|c\\+\\+|rust|go|ruby|php|swift|kotlin|scala|r|matlab|sql)\\b", normalizer: "language" },
  { type: "data_format", pattern: "\\b(json|xml|csv|excel|xlsx|pdf|word|docx|markdown|md|html|yaml|yml)\\b", normalizer: "format" },
  { type: "action_verb", pattern: "\\b(crear|generar|analizar|buscar|ejecutar|enviar|descargar|subir|eliminar|actualizar|revisar|comparar)\\b" },
  { type: "action_verb", pattern: "\\b(create|generate|analyze|search|execute|send|download|upload|delete|update|review|compare)\\b" },
];

const NORMALIZERS: Record<string, (value: string) => string> = {
  path: (value: string) => value.replace(/\\/g, "/").replace(/^["']|["']$/g, ""),
  datetime: (value: string) => {
    const lower = value.toLowerCase();
    const now = new Date();
    if (lower === "hoy" || lower === "today") {
      return now.toISOString().split("T")[0];
    }
    if (lower === "mañana" || lower === "tomorrow") {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().split("T")[0];
    }
    if (lower === "ayer" || lower === "yesterday") {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return yesterday.toISOString().split("T")[0];
    }
    return value;
  },
  number: (value: string) => value.replace(/,/g, "").replace(/^\$/, ""),
  language: (value: string) => {
    const mapping: Record<string, string> = {
      cpp: "c++",
      csharp: "c#",
      golang: "go",
      js: "javascript",
      ts: "typescript",
      py: "python",
    };
    return mapping[value.toLowerCase()] || value.toLowerCase();
  },
  format: (value: string) => {
    const mapping: Record<string, string> = {
      yml: "yaml",
      md: "markdown",
      xls: "excel",
    };
    return mapping[value.toLowerCase()] || value.toLowerCase();
  },
};

export class EntityExtractor {
  private patterns: EntityPattern[];

  constructor() {
    this.patterns = ENTITY_PATTERNS;
  }

  async extract(prompt: string, targetTypes?: EntityType[]): Promise<Entity[]> {
    const entities: Entity[] = [];

    const regexEntities = this.extractByRegex(prompt, targetTypes);
    entities.push(...regexEntities);

    if (entities.length < 3) {
      const llmEntities = await this.extractByLLM(prompt, targetTypes);
      entities.push(...llmEntities);
    }

    return this.deduplicateEntities(entities);
  }

  private extractByRegex(prompt: string, targetTypes?: EntityType[]): Entity[] {
    const entities: Entity[] = [];

    // Patterns loop
    for (const pattern of this.patterns) {
      if (targetTypes && !targetTypes.includes(pattern.type)) {
        continue;
      }

      try {
        const regex = new RegExp(pattern.pattern, "gi");
        let match: RegExpExecArray | null;

        while ((match = regex.exec(prompt)) !== null) {
          const value = match[0];
          const normalizer = pattern.normalizer ? NORMALIZERS[pattern.normalizer] : undefined;
          const normalizedValue = normalizer ? normalizer(value) : undefined;
          let metadata: Record<string, any> = {};

          // Feature: Feasibility Validation (#31)
          if (pattern.type === "file_path") {
            try {
              const absolutePath = resolveSafePath(value);
              const exists = fs.existsSync(absolutePath);
              metadata.exists = exists;
              metadata.absolutePath = absolutePath;

              if (exists) {
                try {
                  const stats = fs.statSync(absolutePath);
                  metadata.isDirectory = stats.isDirectory();
                  metadata.size = stats.size;
                } catch (e) {
                  // ignore stat error
                }
              }
            } catch (securityError) {
              // Path traversal attempt or invalid path
              metadata.exists = false;
              metadata.securityViolation = true;
            }
          }

          entities.push({
            type: pattern.type,
            value,
            startPos: match.index,
            endPos: match.index + value.length,
            confidence: 0.85,
            normalizedValue,
            metadata,
          });
        }
      } catch (error) {
        console.warn(`[EntityExtractor] Regex error for pattern ${pattern.type}:`, error);
      }
    }

    return entities;
  }

  private async extractByLLM(prompt: string, targetTypes?: EntityType[]): Promise<Entity[]> {
    try {
      const { geminiChat } = await import("../../lib/gemini");

      const typesStr = targetTypes?.join(", ") || "url, file_path, date_time, person, organization, programming_language, data_format";

      const systemPrompt = `Extrae entidades del texto. Tipos a buscar: ${typesStr}

Responde SOLO con JSON:
{"entities":[{"type":"tipo","value":"valor","normalized":"valor_normalizado"}]}

Si no hay entidades: {"entities":[]}`;

      const result = await geminiChat(
        [{ role: "user", parts: [{ text: `${systemPrompt}\n\nTexto: "${prompt}"` }] }],
        { model: "gemini-2.5-flash", maxOutputTokens: 300, temperature: 0.1 }
      );

      const responseText = result.content?.trim() || "";
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);

      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      const entities: Entity[] = [];

      for (const e of parsed.entities || []) {
        const startPos = prompt.toLowerCase().indexOf(e.value.toLowerCase());
        entities.push({
          type: e.type as EntityType,
          value: e.value,
          startPos: startPos >= 0 ? startPos : 0,
          endPos: startPos >= 0 ? startPos + e.value.length : e.value.length,
          confidence: 0.7,
          normalizedValue: e.normalized,
          metadata: {},
        });
      }

      return entities;
    } catch (error) {
      console.warn("[EntityExtractor] LLM extraction failed:", error);
      return [];
    }
  }

  private deduplicateEntities(entities: Entity[]): Entity[] {
    const seen = new Map<string, Entity>();

    for (const entity of entities) {
      const key = `${entity.type}:${entity.value.toLowerCase()}`;
      const existing = seen.get(key);

      if (!existing || entity.confidence > existing.confidence) {
        seen.set(key, entity);
      }
    }

    return Array.from(seen.values());
  }
}
