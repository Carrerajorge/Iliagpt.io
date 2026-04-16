import { z } from "zod";
import OpenAI from "openai";
import { BaseAgent, BaseAgentConfig, AgentTask, AgentResult, AgentCapability } from "./types";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY,
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export class ResearchAgent extends BaseAgent {
  constructor() {
    const config: BaseAgentConfig = {
      name: "ResearchAgent",
      description: "Specialized agent for web research, information gathering, fact-checking, and knowledge synthesis. Expert at finding and analyzing information from multiple sources.",
      model: DEFAULT_MODEL,
      temperature: 0.2,
      maxTokens: 8192,
      systemPrompt: `You are the ResearchAgent - an expert researcher and information analyst.

Your capabilities:
1. Web Search: Find relevant information from the internet
2. Deep Research: Conduct thorough multi-source research
3. Fact Checking: Verify claims and validate information
4. Source Analysis: Evaluate credibility and relevance of sources
5. Knowledge Synthesis: Combine information into coherent insights
6. Citation Management: Track and format references properly

Research methodology:
- Start with broad searches, then narrow down
- Cross-reference multiple sources
- Identify primary vs secondary sources
- Note publication dates and author credentials
- Flag any conflicting information
- Provide confidence levels for findings

Output format:
- Executive summary
- Key findings with sources
- Detailed analysis
- Confidence assessment
- Recommendations for further research`,
      tools: ["search_web", "research_deep", "fetch_url", "browser_extract"],
      timeout: 180000,
      maxIterations: 20,
    };
    super(config);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    this.updateState({ status: "running", currentTask: task.description, startedAt: new Date().toISOString() });

    try {
      const researchType = this.determineResearchType(task);
      let result: any;

      switch (researchType) {
        case "quick_search":
          result = await this.quickSearch(task);
          break;
        case "deep_research":
          result = await this.deepResearch(task);
          break;
        case "fact_check":
          result = await this.factCheck(task);
          break;
        case "competitive_analysis":
          result = await this.competitiveAnalysis(task);
          break;
        default:
          result = await this.generalResearch(task);
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

  private determineResearchType(task: AgentTask): string {
    const description = task.description.toLowerCase();
    if (description.includes("fact check") || description.includes("verify")) return "fact_check";
    if (description.includes("competitor") || description.includes("market")) return "competitive_analysis";
    if (description.includes("deep") || description.includes("comprehensive")) return "deep_research";
    if (description.includes("quick") || description.includes("simple")) return "quick_search";
    return "general";
  }

  private async quickSearch(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Quick search for: ${task.description}
Input: ${JSON.stringify(task.input)}

Provide a concise answer with key facts and sources.`,
        },
      ],
      temperature: 0.2,
    });

    return {
      type: "quick_search",
      query: task.description,
      result: response.choices[0].message.content,
      confidence: 0.85,
      timestamp: new Date().toISOString(),
    };
  }

  private async deepResearch(task: AgentTask): Promise<any> {
    this.updateState({ progress: 10 });

    const planResponse = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Create a research plan for: ${task.description}

Return JSON:
{
  "researchQuestions": ["key questions to answer"],
  "searchQueries": ["specific search queries"],
  "sourceTypes": ["types of sources to consult"],
  "methodology": "research approach"
}`,
        },
      ],
      temperature: 0.2,
    });

    this.updateState({ progress: 30 });

    const planContent = planResponse.choices[0].message.content || "{}";
    const planMatch = planContent.match(/\{[\s\S]*\}/);
    const plan = planMatch ? JSON.parse(planMatch[0]) : { searchQueries: [task.description] };

    const findings: any[] = [];
    for (let i = 0; i < (plan.searchQueries?.length || 1); i++) {
      const query = plan.searchQueries?.[i] || task.description;
      
      const searchResponse = await xaiClient.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: "system", content: "You are researching a specific query. Provide detailed findings with sources." },
          { role: "user", content: `Research: ${query}` },
        ],
        temperature: 0.2,
      });

      findings.push({
        query,
        findings: searchResponse.choices[0].message.content,
      });

      this.updateState({ progress: 30 + Math.round((i + 1) / plan.searchQueries.length * 40) });
    }

    this.updateState({ progress: 80 });

    const synthesisResponse = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Synthesize these research findings into a comprehensive report:

Research Topic: ${task.description}
Findings: ${JSON.stringify(findings, null, 2)}

Provide:
1. Executive Summary
2. Key Findings
3. Detailed Analysis
4. Confidence Assessment
5. Recommendations`,
        },
      ],
      temperature: 0.2,
    });

    return {
      type: "deep_research",
      topic: task.description,
      plan,
      findings,
      synthesis: synthesisResponse.choices[0].message.content,
      confidence: 0.9,
      timestamp: new Date().toISOString(),
    };
  }

  private async factCheck(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: `${this.config.systemPrompt}

For fact-checking, evaluate:
1. Source credibility
2. Evidence quality
3. Consistency with other sources
4. Potential biases
5. Date and context relevance` },
        {
          role: "user",
          content: `Fact check this claim: ${task.description}
Additional context: ${JSON.stringify(task.input)}

Return JSON:
{
  "claim": "the claim being checked",
  "verdict": "true|false|partially_true|unverifiable",
  "confidence": 0.0-1.0,
  "evidence": [{"source": "", "finding": "", "supports": boolean}],
  "analysis": "detailed analysis",
  "caveats": ["any important caveats"]
}`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    return {
      type: "fact_check",
      result: jsonMatch ? JSON.parse(jsonMatch[0]) : { analysis: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async competitiveAnalysis(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Conduct competitive analysis for: ${task.description}
Context: ${JSON.stringify(task.input)}

Analyze:
1. Key competitors
2. Market positioning
3. Strengths and weaknesses
4. Opportunities and threats
5. Strategic recommendations`,
        },
      ],
      temperature: 0.2,
    });

    return {
      type: "competitive_analysis",
      subject: task.description,
      analysis: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  private async generalResearch(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Research request: ${task.description}
Input: ${JSON.stringify(task.input)}

Provide comprehensive research findings.`,
        },
      ],
      temperature: 0.2,
    });

    return {
      type: "general_research",
      query: task.description,
      result: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: "web_search",
        description: "Search the web for information",
        inputSchema: z.object({ query: z.string(), maxResults: z.number().optional() }),
        outputSchema: z.object({ results: z.array(z.any()), summary: z.string() }),
      },
      {
        name: "deep_research",
        description: "Conduct comprehensive multi-source research",
        inputSchema: z.object({ topic: z.string(), depth: z.enum(["shallow", "medium", "deep"]).optional() }),
        outputSchema: z.object({ findings: z.array(z.any()), synthesis: z.string() }),
      },
      {
        name: "fact_check",
        description: "Verify claims and validate information",
        inputSchema: z.object({ claim: z.string(), context: z.string().optional() }),
        outputSchema: z.object({ verdict: z.string(), confidence: z.number(), evidence: z.array(z.any()) }),
      },
    ];
  }
}

export const researchAgent = new ResearchAgent();
