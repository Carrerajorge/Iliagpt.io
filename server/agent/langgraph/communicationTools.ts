import { tool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export const decideTool = tool(
  async (input) => {
    const { question, options, criteria = [], context = "" } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a decision-making expert. Analyze options systematically using multi-criteria decision analysis.

For each option, evaluate against the criteria and provide:
1. Pros and cons
2. Score (1-10) for each criterion
3. Weighted recommendation
4. Risk assessment

Return JSON:
{
  "decision": {
    "recommended": "the best option",
    "confidence": 0.0-1.0,
    "reasoning": "why this is the best choice"
  },
  "analysis": [
    {
      "option": "option name",
      "pros": [],
      "cons": [],
      "scores": { "criterion": score },
      "totalScore": number,
      "risks": []
    }
  ],
  "tradeoffs": ["key tradeoffs identified"],
  "alternatives": ["backup options if recommended fails"]
}`,
          },
          {
            role: "user",
            content: `Question: ${question}

Options to evaluate:
${options.map((o, i) => `${i + 1}. ${o}`).join("\n")}

${criteria.length > 0 ? `Evaluation criteria: ${criteria.join(", ")}` : "Use appropriate criteria for this decision."}

${context ? `Additional context: ${context}` : ""}

Analyze and recommend the best option.`,
          },
        ],
        temperature: 0.3,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        decision: { recommended: options[0], confidence: 0.5, reasoning: content },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
  {
    name: "decide",
    description: "Multi-criteria decision framework. Evaluates options systematically with pros/cons, scoring, and risk assessment. Use when choosing between alternatives.",
    schema: z.object({
      question: z.string().describe("The decision question to answer"),
      options: z.array(z.string()).min(2).describe("List of options to evaluate"),
      criteria: z.array(z.string()).optional().default([]).describe("Criteria to evaluate options against"),
      context: z.string().optional().default("").describe("Additional context for the decision"),
    }),
  }
);

export const clarifyTool = tool(
  async (input) => {
    const { statement, ambiguities = [], conversationHistory = [] } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an expert at detecting ambiguity and generating clarifying questions.

Your role is to:
1. Identify vague or unclear elements in statements
2. Generate targeted, non-redundant clarifying questions
3. Prioritize questions by importance
4. Provide context for why each clarification is needed

Return JSON:
{
  "analysis": {
    "originalStatement": "the statement",
    "detectedAmbiguities": ["list of unclear elements"],
    "assumptions": ["what you're assuming without clarification"]
  },
  "clarifyingQuestions": [
    {
      "question": "the clarifying question",
      "priority": "high|medium|low",
      "reason": "why this needs clarification",
      "possibleAnswers": ["likely answers"],
      "impactIfUnclarified": "what could go wrong"
    }
  ],
  "canProceedWithoutClarification": boolean,
  "safestAssumption": "if we must proceed, what to assume"
}`,
          },
          {
            role: "user",
            content: `Statement to analyze: "${statement}"

${ambiguities.length > 0 ? `Known ambiguities: ${ambiguities.join(", ")}` : ""}

${conversationHistory.length > 0 ? `Previous conversation:\n${conversationHistory.join("\n")}` : ""}

Generate clarifying questions.`,
          },
        ],
        temperature: 0.3,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        clarifyingQuestions: [{ question: "Could you provide more details?", priority: "high" }],
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
  {
    name: "clarify",
    description: "Detects ambiguity in statements and generates contextual clarifying questions. Use when user requests are unclear or could be interpreted multiple ways.",
    schema: z.object({
      statement: z.string().describe("The statement to analyze for ambiguity"),
      ambiguities: z.array(z.string()).optional().default([]).describe("Known ambiguous elements"),
      conversationHistory: z.array(z.string()).optional().default([]).describe("Previous conversation context"),
    }),
  }
);

export const summarizeTool = tool(
  async (input) => {
    const { content, targetLength = "medium", format = "paragraph", audience = "general" } = input;
    const startTime = Date.now();

    const lengthGuide = {
      short: "2-3 sentences",
      medium: "1-2 paragraphs",
      long: "3-5 paragraphs with sections",
      bullet: "5-10 bullet points",
    };

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an expert summarizer. Create adaptive summaries based on:
- Target length: ${lengthGuide[targetLength as keyof typeof lengthGuide] || "1-2 paragraphs"}
- Format: ${format}
- Audience: ${audience}

Guidelines:
1. Preserve key information and main points
2. Maintain accuracy - don't add information
3. Use appropriate complexity for audience
4. Structure for easy scanning
5. Highlight critical insights

Return JSON:
{
  "summary": "the summary in requested format",
  "keyPoints": ["main takeaways"],
  "wordCount": number,
  "compressionRatio": "original words -> summary words",
  "omittedDetails": ["important details left out for brevity"],
  "readingTime": "estimated reading time"
}`,
          },
          {
            role: "user",
            content: `Content to summarize:
${content}

Create a ${targetLength} summary in ${format} format for a ${audience} audience.`,
          },
        ],
        temperature: 0.3,
      });

      const responseContent = response.choices[0].message.content || "";
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        summary: responseContent,
        keyPoints: [],
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
  {
    name: "summarize",
    description: "Adaptive summarization engine. Creates summaries of varying lengths and formats, adjusted for different audiences. Preserves key information while compressing content.",
    schema: z.object({
      content: z.string().describe("The content to summarize"),
      targetLength: z.enum(["short", "medium", "long", "bullet"]).optional().default("medium").describe("Desired summary length"),
      format: z.enum(["paragraph", "bullets", "outline", "executive"]).optional().default("paragraph").describe("Output format"),
      audience: z.enum(["general", "technical", "executive", "beginner"]).optional().default("general").describe("Target audience"),
    }),
  }
);

export const explainTool = tool(
  async (input) => {
    const { topic, level = "intermediate", includeExamples = true, includeAnalogies = true } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an expert educator. Create multi-level explanations adapted to the learner.

Complexity levels:
- beginner: ELI5, no jargon, heavy use of analogies
- intermediate: Some technical terms with definitions
- advanced: Technical depth, assumes background knowledge
- expert: Full technical detail, academic tone

Return JSON:
{
  "explanation": {
    "main": "the core explanation at the requested level",
    "simplified": "a simpler version if helpful",
    "detailed": "a more detailed version if helpful"
  },
  "keyTerms": [
    { "term": "word", "definition": "simple explanation" }
  ],
  "examples": [
    { "scenario": "example case", "application": "how it applies" }
  ],
  "analogies": [
    { "comparison": "like X", "explanation": "because..." }
  ],
  "commonMisconceptions": ["things people often get wrong"],
  "furtherReading": ["topics to explore next"]
}`,
          },
          {
            role: "user",
            content: `Topic: ${topic}

Explain at ${level} level.
${includeExamples ? "Include practical examples." : "Skip examples."}
${includeAnalogies ? "Use analogies to aid understanding." : "Avoid analogies."}`,
          },
        ],
        temperature: 0.4,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        explanation: { main: content },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
  {
    name: "explain",
    description: "Multi-level explanation generator. Adapts explanations to different knowledge levels with examples, analogies, and key term definitions.",
    schema: z.object({
      topic: z.string().describe("The topic or concept to explain"),
      level: z.enum(["beginner", "intermediate", "advanced", "expert"]).optional().default("intermediate").describe("Complexity level"),
      includeExamples: z.boolean().optional().default(true).describe("Whether to include examples"),
      includeAnalogies: z.boolean().optional().default(true).describe("Whether to use analogies"),
    }),
  }
);

export const COMMUNICATION_TOOLS = [decideTool, clarifyTool, summarizeTool, explainTool];
