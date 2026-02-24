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
    const slideCount = task.input.slideCount || 10;

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Create a presentation outline for: ${topic}

Requirements:
- Number of slides: ${slideCount}
- Include speaker notes
- Suggest visuals for each slide

Return JSON:
{
  "title": "presentation title",
  "slides": [
    {
      "slideNumber": 1,
      "title": "slide title",
      "content": ["bullet points"],
      "speakerNotes": "notes for presenter",
      "visualSuggestion": "what visual to include"
    }
  ],
  "designRecommendations": ["style suggestions"]
}`,
        },
      ],
      temperature: 0.6,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "presentation",
      presentation: jsonMatch ? JSON.parse(jsonMatch[0]) : { outline: content },
      timestamp: new Date().toISOString(),
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
