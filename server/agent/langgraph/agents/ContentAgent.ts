import { z } from "zod";
import OpenAI from "openai";
import { BaseAgent, BaseAgentConfig, AgentTask, AgentResult, AgentCapability } from "./types";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export class ContentAgent extends BaseAgent {
  constructor() {
    const config: BaseAgentConfig = {
      name: "ContentAgent",
      description: "Specialized agent for content creation, document generation, writing, and creative tasks. Expert at producing high-quality written content.",
      model: DEFAULT_MODEL,
      temperature: 0.7,
      maxTokens: 8192,
      systemPrompt: `You are the ContentAgent - an expert content creator and writer.

Your capabilities:
1. Document Creation: Reports, articles, whitepapers, presentations
2. Creative Writing: Stories, copy, marketing content
3. Technical Writing: Documentation, manuals, guides
4. SEO Content: Optimized web content, blog posts
5. Editing: Proofreading, style improvement, tone adjustment
6. Translation: Content adaptation for different audiences

Writing principles:
- Clarity and conciseness
- Audience-appropriate tone
- Logical structure
- Engaging openings
- Strong calls to action
- SEO best practices when applicable

Output quality:
- Grammar and spelling perfection
- Consistent style
- Proper formatting
- Citation support
- Multiple format exports (MD, HTML, DOCX)`,
      tools: ["doc_create", "slides_create", "generate_text"],
      timeout: 120000,
      maxIterations: 15,
    };
    super(config);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    this.updateState({ status: "running", currentTask: task.description, startedAt: new Date().toISOString() });

    try {
      const contentType = this.determineContentType(task);
      let result: any;

      switch (contentType) {
        case "article":
          result = await this.writeArticle(task);
          break;
        case "document":
          result = await this.createDocument(task);
          break;
        case "presentation":
          result = await this.createPresentation(task);
          break;
        case "marketing":
          result = await this.createMarketingContent(task);
          break;
        case "edit":
          result = await this.editContent(task);
          break;
        default:
          result = await this.createGeneralContent(task);
      }

      this.updateState({ status: "completed", progress: 100, completedAt: new Date().toISOString() });

      return {
        taskId: task.id,
        agentId: this.state.id,
        success: true,
        output: result,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      this.updateState({ status: "failed", error: error.message });
      return {
        taskId: task.id,
        agentId: this.state.id,
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  private determineContentType(task: AgentTask): string {
    const description = task.description.toLowerCase();
    if (description.includes("article") || description.includes("blog")) return "article";
    if (description.includes("document") || description.includes("report")) return "document";
    if (description.includes("presentation") || description.includes("slides")) return "presentation";
    if (description.includes("marketing") || description.includes("ad") || description.includes("copy")) return "marketing";
    if (description.includes("edit") || description.includes("improve") || description.includes("proofread")) return "edit";
    return "general";
  }

  private async writeArticle(task: AgentTask): Promise<any> {
    const topic = task.input.topic || task.description;
    const style = task.input.style || "professional";
    const wordCount = task.input.wordCount || 1000;

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Write an article about: ${topic}

Requirements:
- Style: ${style}
- Target word count: ${wordCount}
- Include: engaging headline, introduction, main sections, conclusion
- SEO optimized if applicable

Additional instructions: ${JSON.stringify(task.input)}`,
        },
      ],
      temperature: 0.7,
    });

    const content = response.choices[0].message.content || "";

    return {
      type: "article",
      topic,
      content,
      wordCount: content.split(/\s+/).length,
      metadata: {
        style,
        readingTime: Math.ceil(content.split(/\s+/).length / 200) + " min",
      },
      timestamp: new Date().toISOString(),
    };
  }

  private async createDocument(task: AgentTask): Promise<any> {
    const type = task.input.type || "report";
    const topic = task.input.topic || task.description;

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Create a ${type} document about: ${topic}

Requirements: ${JSON.stringify(task.input)}

Include proper structure with:
- Title page elements
- Executive summary
- Table of contents outline
- Main sections
- Conclusion/recommendations
- References if applicable`,
        },
      ],
      temperature: 0.5,
    });

    return {
      type: "document",
      documentType: type,
      content: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  private async createPresentation(task: AgentTask): Promise<any> {
    const topic = task.input.topic || task.description;
    const audience = task.input.audience || "general";
    const slideCount = Math.min(Math.max(Number(task.input.maxSlides || task.input.slideCount || 6), 4), 10);
    const localFallback = this.buildPresentationFallback(topic, slideCount, audience, task.input.content);

    if (!process.env.XAI_API_KEY || process.env.XAI_API_KEY === "missing") {
      return localFallback;
    }

    try {
      const response = await xaiClient.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: "system", content: this.config.systemPrompt },
          {
            role: "user",
            content: `Create a minimalist and executive presentation outline about: ${topic}

Requirements:
- Audience: ${audience}
- Number of slides: ${slideCount}
- Tone: professional, concise, and presentation-ready
- Prioritize operational clarity over filler text
- Each slide must have 3 to 5 short bullets
- Include speaker notes and one visual suggestion per slide
- Avoid generic placeholders and avoid repeating the title

Return valid JSON only:
{
  "title": "presentation title",
  "subtitle": "short subtitle",
  "slides": [
    {
      "slideNumber": 1,
      "title": "slide title",
      "bullets": ["short bullet", "short bullet"],
      "speakerNotes": "notes for presenter",
      "visualSuggestion": "recommended visual"
    }
  ],
  "designRecommendations": ["minimalist design direction"]
}`,
          },
        ],
        temperature: 0.4,
      });

      const content = response.choices[0].message.content || "{}";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      const slides = Array.isArray(parsed?.slides) ? parsed.slides : [];

      if (slides.length === 0) {
        return localFallback;
      }

      const normalizedSlides = slides.slice(0, slideCount).map((slide: any, index: number) => ({
        slideNumber: index + 1,
        title: String(slide?.title || `Diapositiva ${index + 1}`).trim(),
        bullets: this.normalizeSlideBullets(slide?.bullets || slide?.content),
        speakerNotes: String(slide?.speakerNotes || "").trim(),
        visualSuggestion: String(slide?.visualSuggestion || "").trim(),
      }));

      return {
        type: "presentation",
        title: parsed?.title || localFallback.title,
        subtitle: parsed?.subtitle || localFallback.subtitle,
        slides: normalizedSlides,
        presentation: {
          title: parsed?.title || localFallback.title,
          subtitle: parsed?.subtitle || localFallback.subtitle,
          slides: normalizedSlides,
          designRecommendations: Array.isArray(parsed?.designRecommendations)
            ? parsed.designRecommendations
            : localFallback.presentation.designRecommendations,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.warn("[ContentAgent] Falling back to local presentation outline:", error);
      return localFallback;
    }
  }

  private buildPresentationFallback(topic: string, slideCount: number, audience: string, contentSpec: any): any {
    const title = String(topic || "Presentación").trim();
    const extractedBullets = this.extractBulletsFromContentSpec(contentSpec);
    const deck = [
      {
        slideNumber: 1,
        title,
        bullets: [
          `Enfoque ejecutivo sobre ${title.toLowerCase()}`,
          `Audiencia objetivo: ${audience}`,
          "Mensaje claro, sobrio y accionable",
        ],
        speakerNotes: "Abrir con el alcance y el objetivo del deck.",
        visualSuggestion: "Portada tipográfica con una línea de acento y mucho espacio en blanco",
      },
      {
        slideNumber: 2,
        title: "Panorama actual",
        bullets: extractedBullets.context,
        speakerNotes: "Explicar el contexto actual y el punto de partida.",
        visualSuggestion: "Bloque de tres ideas clave con iconografía mínima",
      },
      {
        slideNumber: 3,
        title: "Pilares de gestión",
        bullets: extractedBullets.pillars,
        speakerNotes: "Mostrar los frentes que ordenan la operación.",
        visualSuggestion: "Tres o cuatro pilares en rejilla limpia",
      },
      {
        slideNumber: 4,
        title: "Indicadores y control",
        bullets: extractedBullets.metrics,
        speakerNotes: "Aterrizar cómo se medirá avance, calidad y cumplimiento.",
        visualSuggestion: "KPIs en tarjetas sobrias con cifras o etiquetas",
      },
      {
        slideNumber: 5,
        title: "Próximos pasos",
        bullets: extractedBullets.nextSteps,
        speakerNotes: "Cerrar con acciones de implementación y seguimiento.",
        visualSuggestion: "Cronograma simple o lista priorizada",
      },
    ].slice(0, slideCount);

    return {
      type: "presentation",
      title,
      subtitle: `Resumen ejecutivo de ${title}`,
      slides: deck,
      presentation: {
        title,
        subtitle: `Resumen ejecutivo de ${title}`,
        slides: deck,
        designRecommendations: [
          "Use a minimalist layout with generous margins and restrained accent color.",
          "Prefer one key message per slide and avoid dense paragraphs.",
        ],
      },
      timestamp: new Date().toISOString(),
    };
  }

  private normalizeSlideBullets(value: unknown): string[] {
    const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n+/) : [];
    const normalized = list
      .map((entry) => String(entry || "").replace(/^[\s\-*•\d.]+/, "").trim())
      .filter(Boolean)
      .slice(0, 5);

    return normalized.length > 0
      ? normalized
      : ["Definir el objetivo central", "Ordenar prioridades operativas", "Cerrar con una decisión clara"];
  }

  private extractBulletsFromContentSpec(contentSpec: any): {
    context: string[];
    pillars: string[];
    metrics: string[];
    nextSteps: string[];
  } {
    const sections = Array.isArray(contentSpec?.sections) ? contentSpec.sections : [];
    const rawText = [
      typeof contentSpec?.abstract === "string" ? contentSpec.abstract : "",
      ...sections.map((section: any) => `${section?.title || ""}. ${section?.content || ""}`),
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const sentences = rawText
      ? rawText
          .split(/(?<=[.!?])\s+/)
          .map((sentence) => sentence.replace(/^[\s\-*•\d.]+/, "").trim())
          .filter((sentence) => sentence.length > 20)
      : [];

    const generic = this.topicDrivenBullets(String(contentSpec?.title || contentSpec?.topic || ""));
    const pick = (start: number, fallback: string[]) => {
      const selected = sentences.slice(start, start + 3).map((sentence) => sentence.substring(0, 120));
      return selected.length > 0 ? selected : fallback;
    };

    const context = sentences.length > 0 ? pick(0, generic.context) : generic.context;
    const pillars = sentences.length > 3 ? pick(3, generic.pillars) : generic.pillars;
    const metrics = sentences.length > 6 ? pick(6, generic.metrics) : generic.metrics;

    return {
      context: context.length > 0 ? context : generic.context,
      pillars: pillars.length > 0 ? pillars : generic.pillars,
      metrics: metrics.length > 0 ? metrics : generic.metrics,
      nextSteps: generic.nextSteps,
    };
  }

  private topicDrivenBullets(topic: string): {
    context: string[];
    pillars: string[];
    metrics: string[];
    nextSteps: string[];
  } {
    const normalizedTopic = String(topic || "").toLowerCase();
    if (normalizedTopic.includes("gestion administrativa") || (normalizedTopic.includes("gestion") && normalizedTopic.includes("administr"))) {
      return {
        context: [
          "La gestión administrativa sostiene la continuidad operativa y la trazabilidad documental.",
          "Los cuellos de botella suelen concentrarse en aprobaciones, seguimiento y coordinación interna.",
          "La estandarización reduce tiempos de respuesta y errores manuales.",
        ],
        pillars: [
          "Definir responsables, flujos y niveles de servicio por proceso.",
          "Centralizar documentos y criterios de aprobación en un solo circuito.",
          "Automatizar tareas repetitivas y alertas de seguimiento.",
        ],
        metrics: [
          "Tiempo promedio de respuesta por trámite o solicitud.",
          "Nivel de cumplimiento de plazos y aprobaciones.",
          "Porcentaje de retrabajo, incidencias y documentos observados.",
        ],
        nextSteps: [
          "Mapear el proceso actual y detectar cuellos de botella críticos.",
          "Priorizar mejoras de alto impacto con responsables y fechas.",
          "Implementar un tablero simple de control para seguimiento semanal.",
        ],
      };
    }

    return {
      context: [
        `Definir el alcance y el contexto de ${topic || "la iniciativa"}.`,
        "Identificar el punto de partida, restricciones y prioridades.",
        "Alinear la conversación en torno a resultados esperados.",
      ],
      pillars: [
        "Ordenar la operación alrededor de pocos frentes clave.",
        "Asignar responsables y criterios de seguimiento claros.",
        "Reducir dispersión con un modelo simple y repetible.",
      ],
      metrics: [
        "Establecer indicadores de avance, calidad y cumplimiento.",
        "Medir tiempos de ciclo y niveles de servicio relevantes.",
        "Detectar desviaciones para corregir con rapidez.",
      ],
      nextSteps: [
        "Aprobar el enfoque y priorizar el primer bloque de acciones.",
        "Asignar responsables y un horizonte corto de implementación.",
        "Revisar avances con una cadencia ejecutiva simple.",
      ],
    };
  }

  private async createMarketingContent(task: AgentTask): Promise<any> {
    const product = task.input.product || task.description;
    const audience = task.input.audience || "general";
    const channels = task.input.channels || ["web", "email", "social"];

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Create marketing content for: ${product}

Target audience: ${audience}
Channels: ${channels.join(", ")}

Create:
1. Headlines (3 variations)
2. Taglines (3 variations)
3. Short description (50 words)
4. Long description (150 words)
5. Call to action options
6. Social media posts (for each platform)
7. Email subject lines

Return JSON with all content pieces.`,
        },
      ],
      temperature: 0.8,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "marketing",
      content: jsonMatch ? JSON.parse(jsonMatch[0]) : { content },
      timestamp: new Date().toISOString(),
    };
  }

  private async editContent(task: AgentTask): Promise<any> {
    const originalContent = task.input.content || task.description;
    const editType = task.input.editType || "general";

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Edit this content:
${originalContent}

Edit type: ${editType}
Instructions: ${task.description}

Provide:
1. Edited version
2. Summary of changes
3. Suggestions for further improvement`,
        },
      ],
      temperature: 0.4,
    });

    return {
      type: "edit",
      original: originalContent,
      edited: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  private async createGeneralContent(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        { role: "user", content: `Content task: ${task.description}\nInput: ${JSON.stringify(task.input)}` },
      ],
      temperature: 0.7,
    });

    return {
      type: "general_content",
      content: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: "write_article",
        description: "Write articles and blog posts",
        inputSchema: z.object({ topic: z.string(), style: z.string().optional(), wordCount: z.number().optional() }),
        outputSchema: z.object({ content: z.string(), metadata: z.any() }),
      },
      {
        name: "create_document",
        description: "Create business documents and reports",
        inputSchema: z.object({ type: z.string(), topic: z.string() }),
        outputSchema: z.object({ content: z.string() }),
      },
      {
        name: "create_marketing",
        description: "Create marketing and advertising content",
        inputSchema: z.object({ product: z.string(), audience: z.string().optional() }),
        outputSchema: z.object({ content: z.any() }),
      },
    ];
  }
}

export const contentAgent = new ContentAgent();
