import OpenAI from "openai";
import crypto from "crypto";
import { browserSessionManager } from "../browser";
import { guardrails } from "../guardrails";
import { ExecutionPlan, PlanStep } from "./types";

interface BrowserObservation {
  url: string;
  title: string;
  screenshot?: string;
  visibleText: string;
  links: { text: string; href: string }[];
  forms: { action: string; inputs: string[] }[];
  error?: string;
}

interface PlannerState {
  sessionId: string;
  objective: string;
  currentStep: number;
  observations: BrowserObservation[];
  actions: { action: string; result: string; timestamp: Date }[];
  status: "planning" | "acting" | "observing" | "evaluating" | "completed" | "failed";
}

function getOpenAIClient(): OpenAI {
  if (!process.env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY is not configured");
  }
  return new OpenAI({ 
    baseURL: "https://api.x.ai/v1", 
    apiKey: process.env.XAI_API_KEY || "missing" 
  });
}

export async function planNextAction(
  state: PlannerState,
  maxIterations: number = 10
): Promise<{ action: string; params: Record<string, any>; reasoning: string } | null> {
  if (state.actions.length >= maxIterations) {
    return null;
  }

  const openai = getOpenAIClient();
  
  const lastObservation = state.observations[state.observations.length - 1];
  const recentActions = state.actions.slice(-5).map(a => 
    `- ${a.action}: ${a.result}`
  ).join("\n");

  const response = await openai.chat.completions.create({
    model: "grok-3-fast",
    messages: [
      {
        role: "system",
        content: `You are a browser automation agent. Given an objective and current page state, decide the next action.

Available actions:
- navigate: Go to a URL { "url": "https://..." }
- click: Click an element { "selector": "css selector" }
- type: Enter text { "selector": "css selector", "text": "text to type" }
- scroll: Scroll page { "direction": "down" | "up", "amount": 300 }
- wait: Wait for content { "ms": 1000 }
- extract: Get data from page { "selector": "css selector" }
- complete: Task is done { "summary": "what was accomplished" }

Respond in JSON:
{
  "action": "action_name",
  "params": { ... },
  "reasoning": "why this action"
}`
      },
      {
        role: "user",
        content: `Objective: ${state.objective}

Current page:
- URL: ${lastObservation?.url || "none"}
- Title: ${lastObservation?.title || "none"}
- Visible text (excerpt): ${lastObservation?.visibleText?.slice(0, 1000) || "none"}
- Available links: ${lastObservation?.links?.slice(0, 10).map(l => `"${l.text}" -> ${l.href}`).join(", ") || "none"}
- Forms: ${lastObservation?.forms?.length || 0} forms available

Recent actions:
${recentActions || "None yet"}

What should be the next action?`
      }
    ],
    response_format: { type: "json_object" }
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
    return {
      action: parsed.action || "complete",
      params: parsed.params || {},
      reasoning: parsed.reasoning || "No reasoning provided"
    };
  } catch {
    return null;
  }
}

export async function executeAction(
  sessionId: string,
  action: string,
  params: Record<string, any>
): Promise<{ success: boolean; result: string; observation?: BrowserObservation }> {
  const validation = await guardrails.validateAction(sessionId, action, params.url || params.selector || "unknown", params);
  
  if (!validation.allowed) {
    return { success: false, result: `Blocked: ${validation.reason}` };
  }

  try {
    let result: any;
    
    switch (action) {
      case "navigate":
        result = await browserSessionManager.navigate(sessionId, params.url);
        break;
      case "click":
        result = await browserSessionManager.click(sessionId, params.selector);
        break;
      case "type":
        result = await browserSessionManager.type(sessionId, params.selector, params.text);
        break;
      case "scroll":
        result = await browserSessionManager.scroll(sessionId, params.direction, params.amount);
        break;
      case "wait":
        result = await browserSessionManager.wait(sessionId, params.ms || 1000);
        break;
      case "complete":
        return { success: true, result: params.summary || "Task completed" };
      default:
        return { success: false, result: `Unknown action: ${action}` };
    }

    const pageState = await browserSessionManager.getPageState(sessionId);
    const screenshot = await browserSessionManager.getScreenshot(sessionId);

    const observation: BrowserObservation = {
      url: pageState?.url || "",
      title: pageState?.title || "",
      screenshot: screenshot || undefined,
      visibleText: pageState?.visibleText || "",
      links: pageState?.links || [],
      forms: pageState?.forms || [],
    };

    return {
      success: result.success,
      result: result.success ? "Action completed" : result.error || "Action failed",
      observation
    };
  } catch (error: any) {
    return { success: false, result: error.message };
  }
}

export async function evaluateProgress(
  state: PlannerState
): Promise<{ shouldContinue: boolean; feedback: string; confidence: number }> {
  const openai = getOpenAIClient();
  
  const lastObservation = state.observations[state.observations.length - 1];
  const actionsSummary = state.actions.map(a => a.action).join(" -> ");

  const response = await openai.chat.completions.create({
    model: "grok-3-fast",
    messages: [
      {
        role: "system",
        content: `Evaluate if the browser automation task is making progress toward the objective.

Respond in JSON:
{
  "shouldContinue": true/false,
  "feedback": "what's working or not",
  "confidence": 0.0-1.0,
  "isComplete": true/false
}`
      },
      {
        role: "user",
        content: `Objective: ${state.objective}

Actions taken: ${actionsSummary}
Number of actions: ${state.actions.length}

Current page:
- URL: ${lastObservation?.url || "none"}
- Title: ${lastObservation?.title || "none"}

Is the task making progress? Is it complete?`
      }
    ],
    response_format: { type: "json_object" }
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
    return {
      shouldContinue: parsed.shouldContinue !== false && !parsed.isComplete,
      feedback: parsed.feedback || "",
      confidence: parsed.confidence || 0.5
    };
  } catch {
    return { shouldContinue: true, feedback: "", confidence: 0.5 };
  }
}

export async function runBrowserLoop(
  objective: string,
  config?: { maxIterations?: number; allowedDomains?: string[] },
  onProgress?: (state: PlannerState) => void
): Promise<{ success: boolean; summary: string; observations: BrowserObservation[] }> {
  const maxIterations = config?.maxIterations || 15;
  
  const sessionId = await browserSessionManager.createSession(objective, {
    allowedDomains: config?.allowedDomains
  });

  const state: PlannerState = {
    sessionId,
    objective,
    currentStep: 0,
    observations: [],
    actions: [],
    status: "planning"
  };

  try {
    for (let i = 0; i < maxIterations; i++) {
      state.status = "planning";
      onProgress?.(state);

      const nextAction = await planNextAction(state, maxIterations);
      
      if (!nextAction || nextAction.action === "complete") {
        state.status = "completed";
        onProgress?.(state);
        
        await browserSessionManager.closeSession(sessionId);
        
        return {
          success: true,
          summary: nextAction?.params?.summary || "Task completed successfully",
          observations: state.observations
        };
      }

      state.status = "acting";
      onProgress?.(state);

      const result = await executeAction(sessionId, nextAction.action, nextAction.params);
      
      state.actions.push({
        action: `${nextAction.action}(${JSON.stringify(nextAction.params)})`,
        result: result.result,
        timestamp: new Date()
      });

      if (result.observation) {
        state.observations.push(result.observation);
      }

      state.status = "observing";
      onProgress?.(state);

      if (!result.success) {
        const evaluation = await evaluateProgress(state);
        
        if (!evaluation.shouldContinue || evaluation.confidence < 0.3) {
          state.status = "failed";
          onProgress?.(state);
          
          await browserSessionManager.closeSession(sessionId);
          
          return {
            success: false,
            summary: `Task failed: ${result.result}. ${evaluation.feedback}`,
            observations: state.observations
          };
        }
      }

      state.status = "evaluating";
      state.currentStep = i + 1;
      onProgress?.(state);

      if (i > 0 && i % 5 === 0) {
        const evaluation = await evaluateProgress(state);
        
        if (!evaluation.shouldContinue) {
          state.status = evaluation.confidence > 0.7 ? "completed" : "failed";
          onProgress?.(state);
          
          await browserSessionManager.closeSession(sessionId);
          
          return {
            success: evaluation.confidence > 0.7,
            summary: evaluation.feedback,
            observations: state.observations
          };
        }
      }
    }

    state.status = "completed";
    onProgress?.(state);
    
    await browserSessionManager.closeSession(sessionId);
    
    return {
      success: true,
      summary: `Completed after ${maxIterations} iterations`,
      observations: state.observations
    };
  } catch (error: any) {
    state.status = "failed";
    onProgress?.(state);
    
    await browserSessionManager.closeSession(sessionId).catch(() => {});
    
    return {
      success: false,
      summary: `Error: ${error.message}`,
      observations: state.observations
    };
  }
}
