import { generateExcelFromPrompt, generateWordFromPrompt } from "./documentOrchestrator";
import { perfectPptGenerator } from "../agent/perfectPptGenerator";
import { generateExcelDocument, generatePptDocument, generateWordDocument } from "./documentGeneration";

export type ProfessionalOfficeType = "word" | "excel" | "ppt";

export interface ProfessionalOfficeGenerationInput {
  type: ProfessionalOfficeType;
  prompt: string;
  title?: string;
  audience?: string;
  language?: string;
}

export interface ProfessionalOfficeGenerationResult {
  type: ProfessionalOfficeType;
  title: string;
  extension: ".docx" | ".xlsx" | ".pptx";
  mimeType: string;
  fileName: string;
  buffer: Buffer;
  attemptsUsed?: number;
  metadata?: Record<string, unknown>;
}

function inferTitle(prompt: string, fallback: string): string {
  const firstLine = String(prompt || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) return fallback;

  const normalized = firstLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();

  return normalized.slice(0, 120) || fallback;
}

function sanitizeBaseName(value: string, fallback: string): string {
  const normalized = String(value || fallback)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  const base = normalized.replace(/[ .]+$/g, "");
  return base || fallback;
}

function buildFileName(title: string, extension: ".docx" | ".xlsx" | ".pptx"): string {
  return `${sanitizeBaseName(title, "generated-document")}${extension}`;
}

function buildOfficePrompt(title: string, content?: string): string {
  return [title, content].filter(Boolean).join("\n\n").trim();
}

function promptToBulletLines(prompt: string): string[] {
  const normalized = String(prompt || "")
    .split(/\r?\n|[.;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);

  return normalized.length > 0 ? normalized : [String(prompt || "").trim() || "Contenido principal"];
}

function buildFallbackExcelRows(prompt: string): any[][] {
  const bullets = promptToBulletLines(prompt);
  return [
    ["#", "Contenido"],
    ...bullets.map((item, index) => [index + 1, item]),
  ];
}

function buildFallbackSlides(title: string, prompt: string): Array<{ title: string; content: string[] }> {
  const bullets = promptToBulletLines(prompt);
  return [
    {
      title,
      content: ["Presentación generada en modo de recuperación", ...bullets.slice(0, 3)],
    },
    {
      title: "Puntos clave",
      content: bullets,
    },
    {
      title: "Siguiente paso",
      content: ["Revisar el contenido", "Ajustar estilo y branding", "Exportar versión final"],
    },
  ];
}

export function toProfessionalOfficePrompt(input: {
  title?: string;
  content?: string;
  prompt?: string;
}): string {
  const directPrompt = String(input.prompt || "").trim();
  if (directPrompt) return directPrompt;
  return buildOfficePrompt(String(input.title || "Documento"), String(input.content || ""));
}

export async function generateProfessionalOfficeDocument(
  input: ProfessionalOfficeGenerationInput,
): Promise<ProfessionalOfficeGenerationResult> {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) {
    throw new Error("A prompt is required to generate a professional office document");
  }

  const resolvedTitle = sanitizeBaseName(input.title || inferTitle(prompt, "generated-document"), "generated-document");

  switch (input.type) {
    case "word": {
      try {
        const result = await generateWordFromPrompt(prompt);
        return {
          type: "word",
          title: result.spec.title || resolvedTitle,
          extension: ".docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          fileName: buildFileName(result.spec.title || resolvedTitle, ".docx"),
          buffer: result.buffer,
          attemptsUsed: result.attemptsUsed,
          metadata: {
            warnings: result.qualityReport.warnings,
            postRenderWarnings: result.postRenderValidation.warnings,
            validationMetadata: result.postRenderValidation.metadata,
          },
        };
      } catch {
        const fallbackBuffer = await generateWordDocument(resolvedTitle, prompt);
        return {
          type: "word",
          title: resolvedTitle,
          extension: ".docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          fileName: buildFileName(resolvedTitle, ".docx"),
          buffer: fallbackBuffer,
          metadata: { fallback: true, reason: "llm_unavailable" },
        };
      }
    }

    case "excel": {
      try {
        const result = await generateExcelFromPrompt(prompt);
        return {
          type: "excel",
          title: result.spec.workbookTitle || resolvedTitle,
          extension: ".xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          fileName: buildFileName(result.spec.workbookTitle || resolvedTitle, ".xlsx"),
          buffer: result.buffer,
          attemptsUsed: result.attemptsUsed,
          metadata: {
            warnings: result.qualityReport.warnings,
            postRenderWarnings: result.postRenderValidation.warnings,
            validationMetadata: result.postRenderValidation.metadata,
          },
        };
      } catch {
        const fallbackBuffer = await generateExcelDocument(resolvedTitle, buildFallbackExcelRows(prompt));
        return {
          type: "excel",
          title: resolvedTitle,
          extension: ".xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          fileName: buildFileName(resolvedTitle, ".xlsx"),
          buffer: fallbackBuffer,
          metadata: { fallback: true, reason: "llm_unavailable" },
        };
      }
    }

    case "ppt": {
      try {
        const generated = await perfectPptGenerator.generate({
          topic: resolvedTitle,
          audience: input.audience,
          language: input.language,
          template: "executive",
          style: "professional",
          purpose: "inform",
          includeCharts: true,
          includeSpeakerNotes: true,
          customInstructions: prompt,
        });

        return {
          type: "ppt",
          title: generated.metadata.topic || resolvedTitle,
          extension: ".pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          fileName: buildFileName(generated.metadata.topic || resolvedTitle, ".pptx"),
          buffer: generated.buffer,
          metadata: {
            slideCount: generated.slideCount,
            outline: generated.outline,
            template: generated.metadata.template,
            generatedAt: generated.metadata.generatedAt,
          },
        };
      } catch {
        const fallbackBuffer = await generatePptDocument(resolvedTitle, buildFallbackSlides(resolvedTitle, prompt), {
          trace: { source: "professionalOfficeGenerator:fallback" },
        });

        return {
          type: "ppt",
          title: resolvedTitle,
          extension: ".pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          fileName: buildFileName(resolvedTitle, ".pptx"),
          buffer: fallbackBuffer,
          metadata: { fallback: true, slideCount: 3, reason: "llm_or_renderer_unavailable" },
        };
      }
    }
  }
}
