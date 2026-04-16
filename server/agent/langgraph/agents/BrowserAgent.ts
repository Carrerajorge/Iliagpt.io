import { z } from "zod";
import OpenAI from "openai";
import { BaseAgent, BaseAgentConfig, AgentTask, AgentResult, AgentCapability } from "./types";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export class BrowserAgent extends BaseAgent {
  constructor() {
    const config: BaseAgentConfig = {
      name: "BrowserAgent",
      description: "Specialized agent for autonomous web browsing, navigation, data extraction, and web automation. Expert at interacting with websites programmatically.",
      model: DEFAULT_MODEL,
      temperature: 0.2,
      maxTokens: 8192,
      systemPrompt: `You are the BrowserAgent - an expert web automation specialist.

Your capabilities:
1. Web Navigation: Navigate to URLs, handle redirects, manage sessions
2. Data Extraction: Scrape content, extract structured data, parse HTML
3. Form Interaction: Fill forms, submit data, handle validation
4. Screenshot Capture: Take page screenshots for documentation
5. Multi-page Workflows: Navigate sequences, handle pagination
6. Authentication: Handle login flows, cookies, sessions

Automation principles:
- Respect robots.txt and rate limits
- Handle errors gracefully
- Implement retries with backoff
- Validate extracted data
- Document automation steps

Security considerations:
- Never expose credentials in logs
- Use secure connections
- Validate URLs before navigation
- Sanitize extracted content`,
      tools: ["browser_navigate", "browser_interact", "browser_extract", "browser_session", "fetch_url"],
      timeout: 180000,
      maxIterations: 30,
    };
    super(config);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    this.updateState({ status: "running", currentTask: task.description, startedAt: new Date().toISOString() });

    try {
      const browserTaskType = this.determineBrowserTaskType(task);
      let result: any;

      switch (browserTaskType) {
        case "navigate":
          result = await this.navigateAndExtract(task);
          break;
        case "scrape":
          result = await this.scrapeData(task);
          break;
        case "interact":
          result = await this.interactWithPage(task);
          break;
        case "workflow":
          result = await this.executeWorkflow(task);
          break;
        default:
          result = await this.handleGeneralBrowser(task);
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

  private determineBrowserTaskType(task: AgentTask): string {
    const description = task.description.toLowerCase();
    if (description.includes("navigate") || description.includes("visit") || description.includes("go to")) return "navigate";
    if (description.includes("scrape") || description.includes("extract") || description.includes("get data")) return "scrape";
    if (description.includes("click") || description.includes("fill") || description.includes("submit")) return "interact";
    if (description.includes("workflow") || description.includes("automate") || description.includes("sequence")) return "workflow";
    return "general";
  }

  private async navigateAndExtract(task: AgentTask): Promise<any> {
    const url = task.input.url || "";
    const extractSelectors = task.input.selectors || [];

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Plan navigation and extraction for: ${url}
Task: ${task.description}
Selectors to extract: ${JSON.stringify(extractSelectors)}

Return JSON:
{
  "navigationPlan": {
    "url": "target url",
    "waitFor": "selector to wait for",
    "timeout": 30000
  },
  "extractionPlan": {
    "selectors": [{"name": "", "selector": "", "type": "text|html|attribute"}],
    "pagination": {"hasMore": "selector", "nextButton": "selector"}
  },
  "validationRules": ["rules to validate extracted data"],
  "errorHandling": "fallback strategy"
}`,
        },
      ],
      temperature: 0.2,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "navigation",
      url,
      plan: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async scrapeData(task: AgentTask): Promise<any> {
    const url = task.input.url || "";
    const dataType = task.input.dataType || "general";

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Create scraping plan for: ${url}
Data type: ${dataType}
Task: ${task.description}

Return JSON:
{
  "scrapingPlan": {
    "url": "target url",
    "method": "static|dynamic",
    "selectors": {
      "container": "main container selector",
      "items": "item selector",
      "fields": [{"name": "", "selector": "", "transform": ""}]
    },
    "pagination": {"type": "none|scroll|button|url", "config": {}},
    "rateLimit": {"requests": 1, "perSeconds": 1}
  },
  "outputSchema": {},
  "code": {
    "playwright": "Playwright code for scraping",
    "cheerio": "Cheerio code for static scraping"
  }
}`,
        },
      ],
      temperature: 0.2,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "scraping",
      url,
      plan: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async interactWithPage(task: AgentTask): Promise<any> {
    const actions = task.input.actions || [];
    const url = task.input.url || "";

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Plan page interactions:
URL: ${url}
Actions: ${JSON.stringify(actions)}
Task: ${task.description}

Return JSON:
{
  "interactionPlan": {
    "steps": [
      {
        "action": "click|type|select|scroll|wait",
        "selector": "element selector",
        "value": "value if applicable",
        "waitAfter": 1000
      }
    ]
  },
  "validations": ["checks after interactions"],
  "errorRecovery": ["fallback actions"],
  "code": "Playwright code for interactions"
}`,
        },
      ],
      temperature: 0.2,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "interaction",
      url,
      plan: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async executeWorkflow(task: AgentTask): Promise<any> {
    const workflow = task.input.workflow || task.description;

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Create browser automation workflow:
${workflow}

Details: ${JSON.stringify(task.input)}

Return JSON:
{
  "workflow": {
    "name": "workflow name",
    "description": "what it does",
    "steps": [
      {
        "name": "step name",
        "url": "url if navigation",
        "actions": [],
        "extractions": [],
        "conditions": []
      }
    ],
    "errorHandling": "global error strategy",
    "retryPolicy": {"maxRetries": 3, "backoff": "exponential"}
  },
  "code": "Complete Playwright script"
}`,
        },
      ],
      temperature: 0.2,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "workflow",
      workflow: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async handleGeneralBrowser(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        { role: "user", content: `Browser task: ${task.description}\nInput: ${JSON.stringify(task.input)}` },
      ],
      temperature: 0.2,
    });

    return {
      type: "general_browser",
      result: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: "navigate",
        description: "Navigate to a URL and extract content",
        inputSchema: z.object({ url: z.string(), selectors: z.array(z.string()).optional() }),
        outputSchema: z.object({ content: z.any(), screenshot: z.string().optional() }),
      },
      {
        name: "scrape",
        description: "Scrape structured data from web pages",
        inputSchema: z.object({ url: z.string(), dataType: z.string() }),
        outputSchema: z.object({ data: z.array(z.any()), plan: z.any() }),
      },
      {
        name: "automate",
        description: "Execute browser automation workflows",
        inputSchema: z.object({ workflow: z.any() }),
        outputSchema: z.object({ results: z.array(z.any()) }),
      },
    ];
  }
}

export const browserAgent = new BrowserAgent();
