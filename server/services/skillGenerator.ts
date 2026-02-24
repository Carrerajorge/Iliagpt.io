import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { llmGateway } from "../lib/llmGateway";

export const generatedSkillSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(500),
  instructions: z.string().min(1).max(8000),
  category: z.enum(["documents", "data", "integrations", "custom"]),
  features: z.array(z.string().min(1).max(80)).max(12).default([]),
  triggers: z.array(z.string().min(1).max(50)).max(12).default([]),
});

export type GeneratedSkill = z.infer<typeof generatedSkillSchema>;

function extractFirstJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Fast path: whole response is JSON.
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  // Otherwise, try to find the first top-level JSON object.
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;

  return trimmed.slice(firstBrace, lastBrace + 1);
}

function normalizeCategory(prompt: string): GeneratedSkill["category"] {
  const p = prompt.toLowerCase();

  if (/(gmail|correo|email|calendar|slack|teams|github|figma|notion|drive)/i.test(p)) return "integrations";
  if (/(excel|spreadsheet|hoja de c[aá]lculo|xlsx|word|docx|ppt|pptx|powerpoint|slides|presentaci[oó]n|pdf|documento)/i.test(p)) return "documents";
  if (/(an[aá]lisis|datos|estad[ií]stic|sql|base de datos|consulta|query|f[oó]rmula|calcular|dashboard)/i.test(p)) return "data";

  return "custom";
}

function fallbackSkill(prompt: string): GeneratedSkill {
  const cleanPrompt = prompt.trim().slice(0, 2000);
  const category = normalizeCategory(cleanPrompt);

  const short = cleanPrompt
    .replace(/\s+/g, " ")
    .replace(/[.?!].*$/, "")
    .slice(0, 42)
    .trim();

  const name = short ? `Skill: ${short}` : "Skill Personalizado";

  return {
    name: name.slice(0, 64),
    description: `Skill generado a partir del prompt: ${cleanPrompt}`.slice(0, 500),
    category,
    features: [],
    triggers: [],
    instructions: [
      `# Objetivo`,
      `Ayudar al usuario con: ${cleanPrompt}`,
      ``,
      `# Reglas`,
      `- Haz preguntas de aclaración si falta información.`,
      `- Responde en español salvo que el usuario pida otro idioma.`,
      `- Da pasos accionables y ejemplos cuando ayuden.`,
      ``,
      `# Proceso`,
      `1. Resume el objetivo del usuario en 1 frase.`,
      `2. Extrae requisitos, supuestos y restricciones.`,
      `3. Propón una solución y valida con el usuario si hay ambigüedades.`,
      `4. Entrega el resultado final en el formato más útil (tabla, checklist, plan, etc.).`,
    ].join("\n"),
  };
}

async function generateWithLlm(prompt: string, userId: string): Promise<GeneratedSkill> {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        [
          "Eres un diseñador de Skills para IliaGPT.",
          "Devuelve SOLO JSON (sin markdown, sin backticks) con esta forma exacta:",
          JSON.stringify(
            {
              name: "string (<=64, nombre corto y accionable)",
              description: "string (<=500, 1-2 frases)",
              category: "documents | data | integrations | custom",
              features: ["string", "string"],
              triggers: ["string", "string"],
              instructions: "string (instrucciones claras en Markdown, con secciones y pasos)",
            },
            null,
            2
          ),
          "Reglas:",
          "- Escribe en español.",
          "- No inventes capacidades técnicas que no estén en el prompt; sé honesto.",
          "- `triggers` deben ser keywords cortas (sin espacios largos) útiles para activar el skill.",
          "- `instructions` deben incluir: objetivo, cuándo usarlo, pasos, formato de salida.",
        ].join("\n"),
    },
    {
      role: "user",
      content: `Prompt del usuario para crear el skill:\n\n${prompt}`,
    },
  ];

  const resp = await llmGateway.chat(messages, {
    userId,
    maxTokens: 900,
    temperature: 0.3,
    enableFallback: true,
  });

  const jsonText = extractFirstJsonObject(resp.content);
  if (!jsonText) {
    throw new Error("Model did not return JSON");
  }

  const parsed = JSON.parse(jsonText);
  return generatedSkillSchema.parse(parsed);
}

export async function generateSkillFromPrompt(prompt: string, options: { userId: string }): Promise<GeneratedSkill> {
  const cleanPrompt = prompt.trim();

  // LLM path with 2 attempts, then deterministic fallback.
  try {
    return await generateWithLlm(cleanPrompt, options.userId);
  } catch (err1) {
    try {
      // Retry once with a stronger instruction if parsing/formatting failed.
      return await generateWithLlm(
        `${cleanPrompt}\n\nIMPORTANTE: Responde SOLO con JSON válido. No incluyas texto fuera del JSON.`,
        options.userId
      );
    } catch (_err2) {
      return fallbackSkill(cleanPrompt);
    }
  }
}

