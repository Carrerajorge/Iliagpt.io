import { tool, DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";
import { DEFAULT_XAI_TEXT_MODEL, DEFAULT_XAI_REASONING_MODEL } from "../../lib/modelRegistry";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = DEFAULT_XAI_TEXT_MODEL;
const REASONING_MODEL = DEFAULT_XAI_REASONING_MODEL;

interface AgentConfig {
  description: string;
  capabilities: string[];
  systemPrompt: string;
  outputFormat: string;
}

const AVAILABLE_AGENTS: Record<string, AgentConfig> = {
  search: {
    description: "Web search specialist",
    capabilities: ["search queries", "find information online", "discover facts", "research topics"],
    systemPrompt: `You are an expert web search agent. Your role is to:
1. Formulate effective search queries
2. Find relevant and accurate information
3. Synthesize results from multiple sources
4. Cite sources when possible
5. Distinguish between facts and opinions`,
    outputFormat: "Provide results as JSON: { success: boolean, data: { findings: [], sources: [], confidence: number } }",
  },
  browser: {
    description: "Web content extraction specialist",
    capabilities: ["extract web page content", "navigate websites", "parse HTML", "extract structured data"],
    systemPrompt: `You are an expert web content extraction agent. Your role is to:
1. Navigate to and understand web pages
2. Extract relevant content and data
3. Parse complex layouts and structures
4. Handle dynamic content
5. Clean and format extracted data`,
    outputFormat: "Provide results as JSON: { success: boolean, data: { content: string, structured: {}, metadata: {} } }",
  },
  document: {
    description: "Document creation specialist",
    capabilities: ["create PPTX/DOCX/XLSX files", "format documents", "generate reports", "create presentations"],
    systemPrompt: `You are an expert document creation agent. Your role is to:
1. Create professional documents in various formats
2. Structure content logically and clearly
3. Apply appropriate formatting and styling
4. Generate charts and visualizations when needed
5. Ensure documents are well-organized`,
    outputFormat: "Provide results as JSON: { success: boolean, data: { documentType: string, structure: {}, filename: string } }",
  },
  research: {
    description: "Deep research specialist",
    capabilities: ["comprehensive research", "data analysis", "literature review", "comparative analysis"],
    systemPrompt: `You are an expert research agent. Your role is to:
1. Conduct thorough multi-source research
2. Analyze data and identify patterns
3. Compare and contrast information
4. Synthesize findings into coherent insights
5. Identify gaps and limitations in available data`,
    outputFormat: "Provide results as JSON: { success: boolean, data: { findings: [], analysis: string, sources: [], confidence: number } }",
  },
  file: {
    description: "File operations specialist",
    capabilities: ["read/write files", "file management", "format conversion", "data extraction"],
    systemPrompt: `You are an expert file operations agent. Your role is to:
1. Read and parse various file formats
2. Write and create new files
3. Convert between formats
4. Organize and manage files
5. Extract data from documents`,
    outputFormat: "Provide results as JSON: { success: boolean, data: { operation: string, files: [], result: {} } }",
  },
  generate: {
    description: "Content generation specialist",
    capabilities: ["create images", "generate content", "write text", "produce creative outputs"],
    systemPrompt: `You are an expert content generation agent. Your role is to:
1. Generate creative and engaging content
2. Create images and visual elements
3. Write compelling text
4. Adapt tone and style as needed
5. Ensure quality and originality`,
    outputFormat: "Provide results as JSON: { success: boolean, data: { contentType: string, content: any, metadata: {} } }",
  },
  analyzer: {
    description: "Data analysis specialist",
    capabilities: ["analyze data", "statistical analysis", "pattern recognition", "insights extraction"],
    systemPrompt: `You are an expert data analysis agent. Your role is to:
1. Analyze datasets and extract insights
2. Perform statistical calculations
3. Identify patterns and trends
4. Create visualizations descriptions
5. Provide actionable recommendations`,
    outputFormat: "Provide results as JSON: { success: boolean, data: { analysis: {}, insights: [], recommendations: [] } }",
  },
  planner: {
    description: "Strategic planning specialist",
    capabilities: ["task decomposition", "project planning", "dependency analysis", "timeline creation"],
    systemPrompt: `You are an expert planning agent. Your role is to:
1. Break down complex tasks into subtasks
2. Identify dependencies between tasks
3. Create execution timelines
4. Allocate resources effectively
5. Anticipate and plan for risks`,
    outputFormat: "Provide results as JSON: { success: boolean, data: { plan: [], dependencies: {}, timeline: string } }",
  },
};

interface SubAgentResult {
  agent: string;
  task: string;
  success: boolean;
  result: any;
  latencyMs: number;
  retries: number;
  error?: string;
}

interface ExecutionPlan {
  phases: ExecutionPhase[];
  estimatedDuration: string;
  complexity: "simple" | "moderate" | "complex";
}

interface ExecutionPhase {
  id: string;
  name: string;
  agents: Array<{ agent: string; subtask: string }>;
  parallel: boolean;
  dependsOn: string[];
}

interface WorkflowStepResult {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "retrying";
  result?: any;
  error?: string;
  latencyMs?: number;
  retries?: number;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function executeWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<{ result: T; retries: number } | { error: string; retries: number }> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, retries: attempt };
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        await delay(delayMs);
      }
    }
  }
  
  return { error: lastError?.message || "Unknown error after retries", retries: maxRetries };
}

async function executeSubAgent(
  agentName: string,
  task: string,
  context?: Record<string, any>
): Promise<SubAgentResult> {
  const startTime = Date.now();
  const agentConfig = AVAILABLE_AGENTS[agentName];

  if (!agentConfig) {
    return {
      agent: agentName,
      task,
      success: false,
      result: null,
      latencyMs: Date.now() - startTime,
      retries: 0,
      error: `Unknown agent: ${agentName}. Available: ${Object.keys(AVAILABLE_AGENTS).join(", ")}`,
    };
  }

  const executionResult = await executeWithRetry(async () => {
    const contextInfo = context ? `\nContext from previous steps: ${JSON.stringify(context)}` : "";
    
    const response = await xaiClient.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: "system",
          content: `${agentConfig.systemPrompt}

Capabilities: ${agentConfig.capabilities.join(", ")}

${agentConfig.outputFormat}

Be thorough, accurate, and provide actionable results.`,
        },
        {
          role: "user",
          content: `Task: ${task}${contextInfo}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    });

    const content = response.choices[0].message.content || "";
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return { success: true, data: content, message: "Task completed" };
  });

  if ("error" in executionResult) {
    return {
      agent: agentName,
      task,
      success: false,
      result: null,
      latencyMs: Date.now() - startTime,
      retries: executionResult.retries,
      error: executionResult.error,
    };
  }

  return {
    agent: agentName,
    task,
    success: executionResult.result.success !== false,
    result: executionResult.result,
    latencyMs: Date.now() - startTime,
    retries: executionResult.retries,
  };
}

async function createExecutionPlan(
  task: string,
  availableAgents: string[]
): Promise<ExecutionPlan> {
  try {
    const response = await xaiClient.chat.completions.create({
      model: REASONING_MODEL,
      messages: [
        {
          role: "system",
          content: `You are a strategic planner for a multi-agent system. Your role is to:
1. Analyze the task and break it into logical phases
2. Assign the most appropriate agents to each phase
3. Determine which tasks can run in parallel vs sequentially
4. Identify dependencies between phases

Available agents and their specialties:
${availableAgents.map(a => `- ${a}: ${AVAILABLE_AGENTS[a]?.description || "Unknown"}`).join("\n")}

Return a JSON execution plan:
{
  "phases": [
    {
      "id": "phase_1",
      "name": "Research Phase",
      "agents": [{ "agent": "search", "subtask": "specific task for this agent" }],
      "parallel": true,
      "dependsOn": []
    }
  ],
  "estimatedDuration": "5-10 seconds",
  "complexity": "simple|moderate|complex"
}`,
        },
        {
          role: "user",
          content: `Create an execution plan for: ${task}`,
        },
      ],
      temperature: 0.2,
    });

    const content = response.choices[0].message.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const plan = JSON.parse(jsonMatch[0]);
      if (plan.phases && Array.isArray(plan.phases)) {
        return plan as ExecutionPlan;
      }
    }
    
    return {
      phases: [{
        id: "default",
        name: "Default Execution",
        agents: availableAgents.slice(0, 2).map(a => ({ agent: a, subtask: task })),
        parallel: true,
        dependsOn: [],
      }],
      estimatedDuration: "unknown",
      complexity: "simple",
    };
  } catch (error) {
    return {
      phases: [{
        id: "fallback",
        name: "Fallback Execution",
        agents: availableAgents.slice(0, 2).map(a => ({ agent: a, subtask: task })),
        parallel: true,
        dependsOn: [],
      }],
      estimatedDuration: "unknown",
      complexity: "simple",
    };
  }
}

async function aggregateResults(
  results: SubAgentResult[],
  task: string
): Promise<{ combined: any; conflicts: string[]; confidence: number }> {
  const successfulResults = results.filter(r => r.success);
  const failedResults = results.filter(r => !r.success);
  
  if (successfulResults.length === 0) {
    return {
      combined: null,
      conflicts: failedResults.map(r => `${r.agent}: ${r.error}`),
      confidence: 0,
    };
  }

  if (successfulResults.length === 1) {
    return {
      combined: successfulResults[0].result,
      conflicts: [],
      confidence: 0.8,
    };
  }

  try {
    const response = await xaiClient.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: "system",
          content: `You are an expert at synthesizing information from multiple sources.
Your role is to:
1. Combine insights from multiple agents
2. Identify and resolve conflicts
3. Prioritize more reliable information
4. Create a coherent, unified response

Return JSON:
{
  "combined": { synthesized result },
  "conflicts": ["list of any conflicting information"],
  "confidence": 0.0-1.0
}`,
        },
        {
          role: "user",
          content: `Task: "${task}"

Results from different agents:
${successfulResults.map(r => `
### ${r.agent} (${r.latencyMs}ms):
${JSON.stringify(r.result, null, 2)}
`).join("\n")}

Synthesize these results into a unified response.`,
        },
      ],
      temperature: 0.2,
    });

    const content = response.choices[0].message.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        combined: parsed.combined || parsed,
        conflicts: parsed.conflicts || [],
        confidence: parsed.confidence || 0.7,
      };
    }

    return {
      combined: successfulResults.map(r => ({ agent: r.agent, data: r.result })),
      conflicts: [],
      confidence: 0.6,
    };
  } catch (error) {
    return {
      combined: successfulResults.map(r => ({ agent: r.agent, data: r.result })),
      conflicts: [],
      confidence: 0.5,
    };
  }
}

async function validateResults(
  results: any,
  task: string
): Promise<{ valid: boolean; issues: string[]; suggestions: string[] }> {
  try {
    const response = await xaiClient.chat.completions.create({
      model: REASONING_MODEL,
      messages: [
        {
          role: "system",
          content: `You are a quality assurance agent. Evaluate if the results adequately address the task.

Return JSON:
{
  "valid": boolean,
  "issues": ["list of any problems found"],
  "suggestions": ["suggestions for improvement"]
}`,
        },
        {
          role: "user",
          content: `Task: "${task}"

Results to validate:
${JSON.stringify(results, null, 2)}

Evaluate these results.`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return { valid: true, issues: [], suggestions: [] };
  } catch {
    return { valid: true, issues: [], suggestions: [] };
  }
}

export const orchestrateTool = tool(
  async (input) => {
    const { task, agents, strategy = "auto", maxRetries = 2, validate = true } = input;
    const startTime = Date.now();
    const logs: string[] = [];

    const log = (msg: string) => {
      logs.push(`[${Date.now() - startTime}ms] ${msg}`);
    };

    log(`Starting orchestration for task: "${task.substring(0, 50)}..."`);

    const selectedAgents: string[] = agents && agents.length > 0
      ? agents.filter(a => a in AVAILABLE_AGENTS)
      : Object.keys(AVAILABLE_AGENTS).slice(0, 3);

    if (selectedAgents.length === 0) {
      return JSON.stringify({
        success: false,
        error: "No valid agents specified",
        availableAgents: Object.keys(AVAILABLE_AGENTS),
        logs,
      });
    }

    log(`Selected agents: ${selectedAgents.join(", ")}`);

    let results: SubAgentResult[] = [];
    let executionPlan: ExecutionPlan | null = null;

    const effectiveStrategy = strategy === "auto" 
      ? (selectedAgents.length > 2 ? "supervisor" : "parallel")
      : strategy;

    log(`Using strategy: ${effectiveStrategy}`);

    switch (effectiveStrategy) {
      case "parallel":
        log("Executing all agents in parallel...");
        results = await Promise.all(
          selectedAgents.map(agent => executeSubAgent(agent, task))
        );
        break;

      case "sequential":
        log("Executing agents sequentially with context passing...");
        let accumulatedContext: Record<string, any> = {};
        for (const agent of selectedAgents) {
          log(`Executing ${agent}...`);
          const result = await executeSubAgent(agent, task, accumulatedContext);
          results.push(result);
          if (result.success && result.result) {
            accumulatedContext[agent] = result.result;
          }
        }
        break;

      case "supervisor":
        log("Creating AI-driven execution plan...");
        executionPlan = await createExecutionPlan(task, selectedAgents);
        log(`Plan created: ${executionPlan.phases.length} phases, complexity: ${executionPlan.complexity}`);

        const phaseResults: Record<string, any> = {};
        
        for (const phase of executionPlan.phases) {
          const dependenciesMet = phase.dependsOn.every(dep => dep in phaseResults);
          
          if (!dependenciesMet) {
            log(`Skipping phase ${phase.id}: dependencies not met`);
            continue;
          }

          log(`Executing phase: ${phase.name}`);
          const context = phase.dependsOn.reduce((acc, dep) => ({
            ...acc,
            [dep]: phaseResults[dep],
          }), {});

          const phaseAgentResults = phase.parallel
            ? await Promise.all(
                phase.agents.map(({ agent, subtask }) => 
                  executeSubAgent(agent, subtask, context)
                )
              )
            : await (async () => {
                const sequential: SubAgentResult[] = [];
                for (const { agent, subtask } of phase.agents) {
                  sequential.push(await executeSubAgent(agent, subtask, { ...context, previousInPhase: sequential }));
                }
                return sequential;
              })();

          results.push(...phaseAgentResults);
          phaseResults[phase.id] = phaseAgentResults.filter(r => r.success).map(r => r.result);
        }
        break;

      case "consensus":
        log("Executing with consensus requirement...");
        results = await Promise.all(
          selectedAgents.map(agent => executeSubAgent(agent, task))
        );
        break;

      default:
        results = await Promise.all(
          selectedAgents.map(agent => executeSubAgent(agent, task))
        );
    }

    log("Aggregating results...");
    const { combined, conflicts, confidence } = await aggregateResults(results, task);

    let validation: { valid: boolean; issues: string[]; suggestions: string[] } | null = null;
    if (validate && combined) {
      log("Validating results...");
      validation = await validateResults(combined, task);
      log(`Validation: ${validation.valid ? "passed" : "issues found"}`);
    }

    const successCount = results.filter(r => r.success).length;
    const totalRetries = results.reduce((sum, r) => sum + r.retries, 0);

    log(`Completed: ${successCount}/${results.length} successful, ${totalRetries} total retries`);

    return JSON.stringify({
      success: successCount > 0,
      strategy: effectiveStrategy,
      plan: executionPlan,
      agentsUsed: selectedAgents,
      results: results.map(r => ({
        agent: r.agent,
        task: r.task,
        success: r.success,
        latencyMs: r.latencyMs,
        retries: r.retries,
        error: r.error,
        resultSummary: r.success ? (typeof r.result === 'object' ? Object.keys(r.result) : 'completed') : null,
      })),
      combined,
      conflicts,
      confidence,
      validation,
      metrics: {
        totalLatencyMs: Date.now() - startTime,
        avgAgentLatencyMs: Math.round(results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length),
        successRate: Math.round((successCount / results.length) * 100),
        totalRetries,
      },
      logs,
    });
  },
  {
    name: "orchestrate",
    description: `Advanced multi-agent orchestration system. Coordinates specialized agents to accomplish complex tasks.

Strategies:
- auto: Automatically selects best strategy based on task complexity
- parallel: Execute all agents simultaneously (fastest)
- sequential: Execute one after another, passing context between agents
- supervisor: AI creates an execution plan with phases and dependencies
- consensus: Multiple agents work on same task to cross-validate results

Available agents: ${Object.keys(AVAILABLE_AGENTS).join(", ")}`,
    schema: z.object({
      task: z.string().describe("The task to delegate to sub-agents"),
      agents: z.array(z.enum(["search", "browser", "document", "research", "file", "generate", "analyzer", "planner"] as const))
        .optional()
        .describe("Specific agents to use. If not specified, auto-selects appropriate agents."),
      strategy: z.enum(["auto", "parallel", "sequential", "supervisor", "consensus"])
        .optional()
        .default("auto")
        .describe("Execution strategy"),
      maxRetries: z.number().optional().default(2).describe("Max retries per agent on failure"),
      validate: z.boolean().optional().default(true).describe("Whether to validate results"),
    }),
  }
);

interface WorkflowStep {
  id: string;
  action: string;
  agent?: string;
  dependsOn?: string[];
  retryOnFail?: boolean;
  timeout?: number;
}

function buildDependencyGraph(steps: WorkflowStep[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  
  for (const step of steps) {
    if (!graph.has(step.id)) {
      graph.set(step.id, new Set());
    }
    if (step.dependsOn) {
      for (const dep of step.dependsOn) {
        graph.get(step.id)!.add(dep);
      }
    }
  }
  
  return graph;
}

function detectCycles(steps: WorkflowStep[], graph: Map<string, Set<string>>): string[] {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycles: string[] = [];

  function dfs(nodeId: string, path: string[]): boolean {
    visited.add(nodeId);
    recursionStack.add(nodeId);

    const deps = graph.get(nodeId) || new Set();
    for (const dep of deps) {
      if (!visited.has(dep)) {
        if (dfs(dep, [...path, nodeId])) {
          return true;
        }
      } else if (recursionStack.has(dep)) {
        cycles.push(`Cycle detected: ${[...path, nodeId, dep].join(" -> ")}`);
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  }

  for (const step of steps) {
    if (!visited.has(step.id)) {
      dfs(step.id, []);
    }
  }

  return cycles;
}

function getExecutableSteps(
  steps: WorkflowStep[],
  completed: Set<string>,
  running: Set<string>,
  failed: Set<string>,
  dependencyGraph: Map<string, Set<string>>
): WorkflowStep[] {
  return steps.filter(step => {
    if (completed.has(step.id) || running.has(step.id) || failed.has(step.id)) {
      return false;
    }
    
    const deps = dependencyGraph.get(step.id) || new Set();
    for (const dep of deps) {
      if (failed.has(dep)) return false;
      if (!completed.has(dep)) return false;
    }
    
    return true;
  });
}

async function executeWorkflowStep(
  step: WorkflowStep,
  context: Record<string, any>,
  stepResults: Map<string, any>
): Promise<WorkflowStepResult> {
  const startTime = Date.now();
  const maxRetries = step.retryOnFail ? 2 : 0;

  const enrichedContext = {
    ...context,
    previousResults: Object.fromEntries(stepResults),
  };

  const executionResult = await executeWithRetry(async () => {
    if (step.agent && step.agent in AVAILABLE_AGENTS) {
      const agentResult = await executeSubAgent(step.agent, step.action, enrichedContext);
      if (!agentResult.success) {
        throw new Error(agentResult.error || "Agent execution failed");
      }
      return agentResult.result;
    }

    const response = await xaiClient.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: "system",
          content: `You are executing a workflow step. Analyze the action and context, then provide the result.
Return a JSON object with the step result. Be concise and focused on the action.`,
        },
        {
          role: "user",
          content: `Step ID: ${step.id}
Action: ${step.action}
Context: ${JSON.stringify(enrichedContext)}

Execute this step and return the result as JSON.`,
        },
      ],
      temperature: 0.3,
    });

    const content = response.choices[0].message.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { output: content };
  }, maxRetries);

  if ("error" in executionResult) {
    return {
      id: step.id,
      status: "failed",
      error: executionResult.error,
      latencyMs: Date.now() - startTime,
      retries: executionResult.retries,
    };
  }

  return {
    id: step.id,
    status: "completed",
    result: executionResult.result,
    latencyMs: Date.now() - startTime,
    retries: executionResult.retries,
  };
}

export const workflowTool = tool(
  async (input) => {
    const { steps, context = {}, maxConcurrency = 5, failFast = false } = input;
    const startTime = Date.now();
    const logs: string[] = [];

    const log = (msg: string) => {
      logs.push(`[${Date.now() - startTime}ms] ${msg}`);
    };

    if (!steps || steps.length === 0) {
      return JSON.stringify({
        success: false,
        error: "No workflow steps provided",
        logs,
      });
    }

    log(`Starting workflow with ${steps.length} steps`);

    const stepIds = new Set(steps.map(s => s.id));
    for (const step of steps) {
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          if (!stepIds.has(dep)) {
            return JSON.stringify({
              success: false,
              error: `Step "${step.id}" depends on non-existent step "${dep}"`,
              logs,
            });
          }
        }
      }
    }

    const dependencyGraph = buildDependencyGraph(steps);
    
    const cycles = detectCycles(steps, dependencyGraph);
    if (cycles.length > 0) {
      return JSON.stringify({
        success: false,
        error: "Circular dependencies detected",
        cycles,
        logs,
      });
    }

    const completed = new Set<string>();
    const running = new Set<string>();
    const failed = new Set<string>();
    const stepResults = new Map<string, any>();
    const results: WorkflowStepResult[] = [];

    const maxIterations = steps.length * 3;
    let iterations = 0;

    while (completed.size + failed.size < steps.length && iterations < maxIterations) {
      iterations++;

      const executableSteps = getExecutableSteps(steps, completed, running, failed, dependencyGraph);

      if (executableSteps.length === 0 && running.size === 0) {
        const remainingSteps = steps.filter(
          s => !completed.has(s.id) && !failed.has(s.id)
        );
        for (const step of remainingSteps) {
          results.push({
            id: step.id,
            status: "skipped",
            error: "Dependencies failed",
          });
          failed.add(step.id);
        }
        break;
      }

      const batchSize = Math.min(executableSteps.length, maxConcurrency);
      const batch = executableSteps.slice(0, batchSize);

      for (const step of batch) {
        running.add(step.id);
        log(`Starting step: ${step.id}`);
      }

      const batchResults = await Promise.all(
        batch.map(step => executeWorkflowStep(step, context, stepResults))
      );

      for (const result of batchResults) {
        running.delete(result.id);
        results.push(result);

        if (result.status === "completed") {
          completed.add(result.id);
          stepResults.set(result.id, result.result);
          log(`Completed step: ${result.id} (${result.latencyMs}ms)`);
        } else {
          failed.add(result.id);
          log(`Failed step: ${result.id} - ${result.error}`);
          
          if (failFast) {
            log("Fail-fast enabled, stopping workflow");
            break;
          }
        }
      }

      if (failFast && failed.size > 0) {
        break;
      }
    }

    const successCount = results.filter(r => r.status === "completed").length;
    const failedCount = results.filter(r => r.status === "failed").length;
    const skippedCount = results.filter(r => r.status === "skipped").length;

    log(`Workflow completed: ${successCount} succeeded, ${failedCount} failed, ${skippedCount} skipped`);

    return JSON.stringify({
      success: failedCount === 0 && skippedCount === 0,
      summary: {
        total: steps.length,
        completed: successCount,
        failed: failedCount,
        skipped: skippedCount,
      },
      results,
      finalContext: Object.fromEntries(stepResults),
      metrics: {
        totalLatencyMs: Date.now() - startTime,
        avgStepLatencyMs: Math.round(
          results
            .filter(r => r.latencyMs)
            .reduce((sum, r) => sum + (r.latencyMs || 0), 0) / successCount || 0
        ),
        iterations,
      },
      logs,
    });
  },
  {
    name: "workflow",
    description: `Execute a DAG-based workflow with dependency resolution, parallel execution, and error handling.

Features:
- Automatic dependency resolution
- Parallel execution of independent steps
- Cycle detection
- Retry on failure
- Fail-fast option
- Optional agent assignment per step

Use for complex multi-step processes with interdependencies.`,
    schema: z.object({
      steps: z.array(z.object({
        id: z.string().describe("Unique identifier for this step"),
        action: z.string().describe("Description of the action to perform"),
        agent: z.enum(["search", "browser", "document", "research", "file", "generate", "analyzer", "planner"] as const)
          .optional()
          .describe("Optional: assign a specific agent to execute this step"),
        dependsOn: z.array(z.string()).optional().describe("IDs of steps that must complete before this one"),
        retryOnFail: z.boolean().optional().default(false).describe("Whether to retry this step on failure"),
        timeout: z.number().optional().describe("Timeout in milliseconds for this step"),
      })).describe("Array of workflow steps to execute"),
      context: z.record(z.any()).optional().describe("Initial context/data to pass to all steps"),
      maxConcurrency: z.number().optional().default(5).describe("Maximum number of steps to run in parallel"),
      failFast: z.boolean().optional().default(false).describe("Stop entire workflow on first failure"),
    }),
  }
);

export const strategicPlanTool = tool(
  async (input) => {
    const { goal, constraints = [], maxSteps = 10 } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: REASONING_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a strategic planning agent. Create detailed execution plans for complex goals.

Available agents for delegation:
${Object.entries(AVAILABLE_AGENTS).map(([name, config]) => 
  `- ${name}: ${config.description} (${config.capabilities.join(", ")})`
).join("\n")}

Create plans with:
1. Clear, actionable steps
2. Proper dependencies
3. Estimated durations
4. Risk considerations
5. Success criteria

Return JSON:
{
  "plan": {
    "goal": "the main goal",
    "steps": [
      {
        "id": "step_1",
        "action": "what to do",
        "agent": "best agent for this",
        "dependsOn": [],
        "estimatedDuration": "30s",
        "successCriteria": "how to know it's done"
      }
    ],
    "estimatedTotalDuration": "2 minutes",
    "risks": ["potential issues"],
    "alternatives": ["backup approaches"]
  }
}`,
          },
          {
            role: "user",
            content: `Goal: ${goal}
Constraints: ${constraints.length > 0 ? constraints.join(", ") : "None"}
Maximum steps: ${maxSteps}

Create an execution plan.`,
          },
        ],
        temperature: 0.3,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const plan = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          ...plan,
          generationLatencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: false,
        error: "Could not generate valid plan",
        rawContent: content,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
  {
    name: "strategic_plan",
    description: "Creates strategic execution plans for complex goals. Breaks down objectives into actionable steps with agent assignments, dependencies, and success criteria. Use this for high-level planning before orchestrating agents.",
    schema: z.object({
      goal: z.string().describe("The main goal or objective to plan for"),
      constraints: z.array(z.string()).optional().default([]).describe("Any constraints or requirements to consider"),
      maxSteps: z.number().optional().default(10).describe("Maximum number of steps in the plan"),
    }),
  }
);

export const ORCHESTRATION_TOOLS = [orchestrateTool, workflowTool, strategicPlanTool];
