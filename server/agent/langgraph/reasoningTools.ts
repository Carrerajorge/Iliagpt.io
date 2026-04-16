import { tool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

const COT_SYSTEM_PROMPT = `You are a logical reasoning expert. Your task is to break down complex problems using chain-of-thought reasoning.

For each problem:
1. Identify the core question or problem
2. Break it down into logical steps
3. Work through each step systematically
4. Provide confidence scores for each step (0-1)
5. Reach a well-reasoned conclusion

Output your response as a JSON object:
{
  "problem_analysis": "Brief analysis of the core problem",
  "reasoning_steps": [
    {
      "step": 1,
      "description": "Step description",
      "reasoning": "Detailed reasoning for this step",
      "confidence": 0.95
    }
  ],
  "conclusion": "Final conclusion based on the reasoning",
  "overall_confidence": 0.9,
  "assumptions": ["List of assumptions made"],
  "limitations": ["Any limitations in the reasoning"]
}`;

const TREE_REASONING_PROMPT = `You are a logical reasoning expert using tree-of-thought methodology.

For the given problem:
1. Generate multiple possible approaches/paths
2. Evaluate each path's viability
3. Explore the most promising paths further
4. Prune unpromising branches
5. Converge on the best solution

Output your response as a JSON object:
{
  "problem_analysis": "Brief analysis",
  "thought_branches": [
    {
      "branch_id": "A",
      "approach": "Description of this approach",
      "viability_score": 0.8,
      "sub_thoughts": ["Further reasoning in this branch"],
      "outcome": "Where this branch leads"
    }
  ],
  "selected_path": "A",
  "reasoning_chain": ["Step-by-step reasoning along selected path"],
  "conclusion": "Final conclusion",
  "confidence": 0.85
}`;

const GRAPH_REASONING_PROMPT = `You are a logical reasoning expert using graph-based reasoning.

For the given problem:
1. Identify all relevant concepts/entities
2. Map relationships between concepts
3. Traverse the knowledge graph to find connections
4. Synthesize insights from graph traversal

Output your response as a JSON object:
{
  "problem_analysis": "Brief analysis",
  "knowledge_nodes": [
    {"id": "node1", "concept": "Concept name", "type": "fact|rule|inference"}
  ],
  "relationships": [
    {"from": "node1", "to": "node2", "relation": "implies|supports|contradicts|relates_to"}
  ],
  "traversal_path": ["node1", "node2", "node3"],
  "key_insights": ["Insights discovered through traversal"],
  "conclusion": "Final conclusion",
  "confidence": 0.88
}`;

const REFLECTION_SYSTEM_PROMPT = `You are a critical analysis expert. Your task is to evaluate content for quality across multiple dimensions.

Evaluate the provided content using these criteria (or custom criteria if provided):
- Accuracy: Is the information correct and verifiable?
- Clarity: Is the content clear and well-organized?
- Completeness: Does it cover all relevant aspects?
- Coherence: Is the logic consistent throughout?
- Relevance: Is the content relevant to the purpose?

Output your response as a JSON object:
{
  "overall_assessment": "Brief overall assessment",
  "scores": {
    "accuracy": {"score": 0.9, "reasoning": "Why this score"},
    "clarity": {"score": 0.85, "reasoning": "Why this score"},
    "completeness": {"score": 0.8, "reasoning": "Why this score"},
    "coherence": {"score": 0.9, "reasoning": "Why this score"},
    "relevance": {"score": 0.95, "reasoning": "Why this score"}
  },
  "strengths": ["List of strengths"],
  "weaknesses": ["List of weaknesses"],
  "suggested_improvements": [
    {
      "area": "What to improve",
      "suggestion": "How to improve it",
      "priority": "high|medium|low"
    }
  ],
  "revised_content": "Optional: Suggested revised version if applicable",
  "overall_score": 0.88
}`;

const VERIFICATION_SYSTEM_PROMPT = `You are a fact-checking expert. Your task is to verify claims against available evidence.

For each claim:
1. Analyze the claim's core assertions
2. Check against provided sources (if any)
3. Apply your knowledge to assess validity
4. Identify supporting or contradicting evidence
5. Determine verification status

Output your response as a JSON object:
{
  "claim_analysis": "What the claim is asserting",
  "verification_status": "verified|unverified|contradicted|partially_verified",
  "confidence": 0.9,
  "evidence": [
    {
      "type": "supporting|contradicting|neutral",
      "source": "Where this evidence comes from",
      "content": "The relevant evidence",
      "reliability": 0.85
    }
  ],
  "key_facts_checked": [
    {"fact": "Specific fact checked", "status": "true|false|uncertain", "source": "evidence source"}
  ],
  "reasoning": "Explanation of the verification process",
  "caveats": ["Any limitations or caveats to the verification"],
  "recommendation": "Suggested action based on verification"
}`;

export const reasonTool = tool(
  async (input) => {
    const { query, context, mode = "cot" } = input;
    
    let systemPrompt: string;
    switch (mode) {
      case "tree":
        systemPrompt = TREE_REASONING_PROMPT;
        break;
      case "graph":
        systemPrompt = GRAPH_REASONING_PROMPT;
        break;
      case "cot":
      default:
        systemPrompt = COT_SYSTEM_PROMPT;
    }

    const userMessage = context
      ? `Problem/Query: ${query}\n\nAdditional Context: ${context}`
      : `Problem/Query: ${query}`;

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
      });

      const content = response.choices[0].message.content || "";
      
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return JSON.stringify({
            success: true,
            mode,
            result: parsed,
          });
        }
      } catch {
        // Return raw content if JSON parsing fails
      }

      return JSON.stringify({
        success: true,
        mode,
        result: { raw_reasoning: content },
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
  {
    name: "reason",
    description: "Performs structured logical reasoning using chain-of-thought (cot), tree-of-thought (tree), or graph-based (graph) methodology. Breaks down complex problems into steps with confidence scores.",
    schema: z.object({
      query: z.string().describe("The problem or question to reason about"),
      context: z.string().optional().describe("Additional context or background information"),
      mode: z.enum(["cot", "tree", "graph"]).optional().default("cot").describe("Reasoning mode: cot (chain-of-thought), tree (tree-of-thought), or graph (graph-based)"),
    }),
  }
);

export const reflectTool = tool(
  async (input) => {
    const { content, criteria } = input;
    
    let systemPrompt = REFLECTION_SYSTEM_PROMPT;
    
    if (criteria && criteria.length > 0) {
      systemPrompt = `You are a critical analysis expert. Evaluate the provided content using these specific criteria:
${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Output your response as a JSON object:
{
  "overall_assessment": "Brief overall assessment",
  "scores": {
    ${criteria.map((c) => `"${c.toLowerCase().replace(/\s+/g, "_")}": {"score": 0.0, "reasoning": "Why this score"}`).join(",\n    ")}
  },
  "strengths": ["List of strengths"],
  "weaknesses": ["List of weaknesses"],
  "suggested_improvements": [
    {
      "area": "What to improve",
      "suggestion": "How to improve it",
      "priority": "high|medium|low"
    }
  ],
  "revised_content": "Optional: Suggested revised version if applicable",
  "overall_score": 0.0
}`;
    }

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Please evaluate the following content:\n\n${content}` },
        ],
        temperature: 0.3,
      });

      const responseContent = response.choices[0].message.content || "";
      
      try {
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return JSON.stringify({
            success: true,
            criteria_used: criteria || ["accuracy", "clarity", "completeness", "coherence", "relevance"],
            result: parsed,
          });
        }
      } catch {
        // Return raw content if JSON parsing fails
      }

      return JSON.stringify({
        success: true,
        result: { raw_reflection: responseContent },
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
  {
    name: "reflect",
    description: "Performs self-reflection and critical analysis on content. Evaluates for accuracy, clarity, completeness, and provides improvement suggestions with scores.",
    schema: z.object({
      content: z.string().describe("The content to evaluate and reflect upon"),
      criteria: z.array(z.string()).optional().describe("Custom evaluation criteria. Defaults to: accuracy, clarity, completeness, coherence, relevance"),
    }),
  }
);

export const verifyTool = tool(
  async (input) => {
    const { claim, sources } = input;
    
    let userMessage = `Claim to verify: ${claim}`;
    
    if (sources && sources.length > 0) {
      userMessage += `\n\nProvided sources for verification:\n${sources.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
    } else {
      userMessage += "\n\nNo specific sources provided. Use your knowledge to verify this claim.";
    }

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: VERIFICATION_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0.2,
      });

      const content = response.choices[0].message.content || "";
      
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return JSON.stringify({
            success: true,
            claim,
            sources_provided: sources?.length || 0,
            result: parsed,
          });
        }
      } catch {
        // Return raw content if JSON parsing fails
      }

      return JSON.stringify({
        success: true,
        claim,
        result: { raw_verification: content },
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
  {
    name: "verify",
    description: "Verifies claims and facts against provided sources or general knowledge. Returns verification status (verified/unverified/contradicted/partially_verified) with supporting evidence.",
    schema: z.object({
      claim: z.string().describe("The claim or statement to verify"),
      sources: z.array(z.string()).optional().describe("Optional sources or references to check against"),
    }),
  }
);

export const REASONING_TOOLS = [reasonTool, reflectTool, verifyTool];

export { reasonTool as reason, reflectTool as reflect, verifyTool as verify };
