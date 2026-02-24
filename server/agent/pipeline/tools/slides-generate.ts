import { ToolDefinition, ExecutionContext, ToolResult, Artifact } from "../types";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";
import { generatePptDocument } from "../../../services/documentGeneration";

const openai = new OpenAI({ 
  baseURL: "https://api.x.ai/v1", 
  apiKey: process.env.XAI_API_KEY || "missing" 
});

function getSandboxPath(runId: string): string {
  return `/tmp/agent-${runId}`;
}

function ensureSandbox(runId: string): string {
  const sandboxPath = getSandboxPath(runId);
  if (!fs.existsSync(sandboxPath)) {
    fs.mkdirSync(sandboxPath, { recursive: true });
  }
  return sandboxPath;
}

interface SlideContent {
  title: string;
  bullets?: string[];
  notes?: string;
  layout?: "title" | "content" | "two_column" | "image";
}

interface PresentationData {
  title: string;
  author?: string;
  slides: SlideContent[];
}

async function generateSlideContent(description: string, slideCount: number = 5): Promise<PresentationData> {
  const response = await openai.chat.completions.create({
    model: "grok-3-fast",
    messages: [
      {
        role: "system",
        content: `You are a presentation expert. Generate slide content for a PowerPoint presentation.
Output valid JSON with this structure:
{
  "title": "Presentation Title",
  "slides": [
    { "title": "Slide Title", "bullets": ["Point 1", "Point 2", "Point 3"], "notes": "Speaker notes" }
  ]
}

Guidelines:
- First slide should be a title slide (no bullets)
- Each slide should have 3-5 bullet points maximum
- Keep bullet points concise (under 10 words each)
- Include speaker notes for context
- Last slide can be a summary or call-to-action

Only output valid JSON, no explanations.`
      },
      {
        role: "user",
        content: `Create a ${slideCount}-slide presentation about: ${description}`
      }
    ],
    temperature: 0.7
  });

  const content = response.choices[0]?.message?.content || "";
  
  try {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || 
                     content.match(/```\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;
    return JSON.parse(jsonStr.trim());
  } catch {
    return {
      title: "Generated Presentation",
      slides: [
        { title: "Title Slide", bullets: [] },
        { title: "Content", bullets: [description] }
      ]
    };
  }
}

function sanitizePptText(input: string, maxLength: number): string {
  return String(input || "")
    .replace(/\0/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim()
    .substring(0, maxLength);
}

function toCorporateSlides(data: PresentationData): { title: string; content: string[] }[] {
  const safeSlides = (Array.isArray(data?.slides) ? data.slides : [])
    .map((slide, index) => {
      const lines: string[] = [];

      if (slide?.title) {
        lines.push(sanitizePptText(slide.title, 180));
      }

      if (Array.isArray(slide?.bullets)) {
        for (const bullet of slide.bullets) {
          const safeBullet = sanitizePptText(String(bullet || ""), 260);
          if (safeBullet) {
            lines.push(`• ${safeBullet}`);
          }
        }
      }

      if (slide?.notes) {
        const safeNotes = sanitizePptText(String(slide.notes), 200);
        if (safeNotes) lines.push(`Notas: ${safeNotes}`);
      }

      if (lines.length === 0) {
        lines.push("Sin contenido disponible.");
      }

      return {
        title: sanitizePptText(slide?.title || `Diapositiva ${index + 1}`, 160),
        content: lines.slice(0, 20),
      };
    });

  if (safeSlides.length === 0) {
    safeSlides.push({
      title: "Resumen",
      content: [sanitizePptText(data?.title || "Contenido de la presentación", 200)],
    });
  }

  return safeSlides;
}

async function buildPresentationBuffer(data: PresentationData): Promise<Buffer> {
  const safeTitle = sanitizePptText(data?.title, 500) || "Presentación";
  const slides = toCorporateSlides(data);

  try {
    return await generatePptDocument(safeTitle, slides, {
      trace: { source: "slides_generate", requestId: data?.topic || data?.title },
    });
  } catch (error) {
    console.warn("[slides_generate] Falling back to emergency corporate template", error);
    return await generatePptDocument("Presentación", [{
      title: "Fallback",
      content: ["No fue posible renderizar la presentación principal. Se muestra una versión de recuperación."],
    }], {
      trace: { source: "slides_generate" },
    });
  }
}

const presentationCache = new Map<string, PresentationData>();

export const slidesGenerateTool: ToolDefinition = {
  id: "slides_generate",
  name: "Generate Slides",
  description: "Generate PowerPoint presentations from descriptions or outlines using AI",
  category: "file",
  capabilities: ["slides", "presentation", "powerpoint", "pptx", "create", "export"],
  inputSchema: {
    action: {
      type: "string",
      description: "The action to perform",
      enum: ["create", "add_slide", "export"],
      required: true
    },
    description: {
      type: "string",
      description: "Description of the presentation to create (for 'create' action)"
    },
    slideCount: {
      type: "number",
      description: "Number of slides to generate",
      default: 5
    },
    slideData: {
      type: "object",
      description: "Slide data for 'add_slide' action",
      properties: {
        title: { type: "string", description: "Slide title" },
        bullets: { type: "array", description: "Bullet points", items: { type: "string" } },
        notes: { type: "string", description: "Speaker notes" }
      }
    },
    presentationId: {
      type: "string",
      description: "ID of existing presentation (for add_slide/export)"
    },
    filename: {
      type: "string",
      description: "Output filename (for export)",
      default: "presentation.pptx"
    }
  },
  outputSchema: {
    presentationId: { type: "string", description: "ID of the presentation" },
    slideCount: { type: "number", description: "Number of slides" },
    filePath: { type: "string", description: "Path to exported file" }
  },

  async execute(context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> {
    const { action, description, slideCount = 5, slideData, presentationId, filename = "presentation.pptx" } = params;

    try {
      const sandboxPath = ensureSandbox(context.runId);

      switch (action) {
        case "create": {
          if (!description) {
            return { success: false, error: "Description is required for 'create' action" };
          }

          const data = await generateSlideContent(description, slideCount);
          const id = crypto.randomUUID();
          presentationCache.set(id, data);

          return {
            success: true,
            data: {
              presentationId: id,
              title: data.title,
              slideCount: data.slides.length,
              slides: data.slides.map((s, i) => ({ index: i, title: s.title }))
            },
            metadata: {
              action: "create",
              slideCount: data.slides.length
            }
          };
        }

        case "add_slide": {
          if (!presentationId) {
            return { success: false, error: "presentationId is required for 'add_slide' action" };
          }
          
          const cached = presentationCache.get(presentationId);
          if (!cached) {
            return { success: false, error: "Presentation not found. Create one first." };
          }

          const data = cached;
          const newSlide: SlideContent = {
            title: slideData?.title || "New Slide",
            bullets: slideData?.bullets || [],
            notes: slideData?.notes
          };

          data.slides.push(newSlide);

          return {
            success: true,
            data: {
              presentationId,
              slideIndex: data.slides.length - 1,
              slideCount: data.slides.length
            }
          };
        }

        case "export": {
          if (!presentationId) {
            return { success: false, error: "presentationId is required for 'export' action" };
          }
          
          const cached = presentationCache.get(presentationId);
          if (!cached) {
            return { success: false, error: "Presentation not found. Create one first." };
          }

          const data = cached;
          const outputPath = path.join(sandboxPath, filename);
          const buffer = await buildPresentationBuffer(data);
          fs.writeFileSync(outputPath, buffer);

          const stats = fs.statSync(outputPath);

          const artifact: Artifact = {
            id: crypto.randomUUID(),
            type: "document",
            name: filename,
            storagePath: outputPath,
            mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            size: stats.size,
            metadata: {
              slideCount: data.slides.length,
              title: data.title
            }
          };

          presentationCache.delete(presentationId);

          return {
            success: true,
            data: {
              filePath: filename,
              fullPath: outputPath,
              size: stats.size,
              slideCount: data.slides.length
            },
            artifacts: [artifact],
            metadata: {
              action: "export",
              filename
            }
          };
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }
};
