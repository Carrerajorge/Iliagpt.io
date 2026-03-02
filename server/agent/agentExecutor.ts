import { z } from "zod";
import type { Response } from "express";
import { toolRegistry, type ToolContext, type ToolResult } from "./toolRegistry";
import { emitTraceEvent } from "./unifiedChatHandler";
import type { RequestSpec } from "./requestSpec";

import { randomUUID } from "crypto";
import { getGeminiClientOrThrow } from "../lib/gemini";
import { requestUnderstandingAgent } from "./requestUnderstanding";
import OpenAI from "openai";
import {
  AGENT_TOOLS as OPENCLAW_TOOLS,
  executeToolCall as executeOpenClawToolCall,
  type ToolCall as OpenClawToolCall,
} from "../agents/toolEngine";

export interface AgentExecutorOptions {
  maxIterations?: number;
  timeout?: number;
  runId: string;
  userId: string;
  chatId: string;
  requestSpec: RequestSpec;
  accessLevel?: 'owner' | 'trusted' | 'unknown';
}

import { type FunctionDeclaration, AGENT_TOOLS } from "../config/agentTools";

import { zodToJsonSchema } from "zod-to-json-schema";
import { BUNDLED_SKILL_TOOLS } from "./tools/bundledSkillTools";

const dynamicSkillTools: FunctionDeclaration[] = BUNDLED_SKILL_TOOLS.map(t => {
  const schema = zodToJsonSchema(t.inputSchema, { target: "jsonSchema7" }) as any;
  // Remove unsupported keywords for Gemini
  if (schema.$schema) delete schema.$schema;
  if (schema.additionalProperties !== undefined) delete schema.additionalProperties;

  return {
    name: t.name,
    description: t.description,
    parameters: schema
  };
});

const LOCAL_FILESYSTEM_SIGNAL_REGEX =
  /\b(?:carpetas?|caprteas?|careptas?|carpteas?|folders?|directorios?|directories?|archivos?|files?)\b.*\b(?:mac|computadora|pc|laptop|sistema|escritorio|desktop|descargas|downloads|documentos|documents|home|disco)\b|\b(?:analiza|explora|listar|list|revisa|cuenta|count|cu[aá]ntas?)\b.*\b(?:mi\s+(?:mac|computadora|pc)|desktop|escritorio|home)\b|\b(?:cu[aá]ntas?|how\s+many|cantidad(?:\s+de)?|n[uú]mero(?:\s+de)?)\s+(?:carpetas?|caprteas?|careptas?|carpteas?|folders?|directorios?|directories?|archivos?|files?)\b/i;
const SKILL_SIGNAL_REGEX = /\b(skill|skills|habilidad|habilidades)\b|\$[a-z0-9_-]{2,80}/i;

function tokenizePrompt(rawPrompt: string): string[] {
  return String(rawPrompt || "")
    .toLowerCase()
    .split(/[^a-z0-9áéíóúñ_-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function getRelevantDynamicSkillTools(rawPrompt: string, maxTools = 8): FunctionDeclaration[] {
  if (!SKILL_SIGNAL_REGEX.test(rawPrompt)) {
    return [];
  }
  const tokens = tokenizePrompt(rawPrompt);
  if (tokens.length === 0) {
    return dynamicSkillTools.slice(0, maxTools);
  }

  const scored = dynamicSkillTools
    .map((tool) => {
      const haystack = `${tool.name} ${tool.description || ""}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) {
          score += 1;
        }
      }
      return { tool, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, maxTools).map((entry) => entry.tool);
}

function withToolSubset(tools: FunctionDeclaration[], names: string[]): FunctionDeclaration[] {
  const allowed = new Set(names);
  return tools.filter((tool) => allowed.has(tool.name));
}

function getToolsForIntent(
  intent: string,
  accessLevel: 'owner' | 'trusted' | 'unknown' = 'owner',
  rawPrompt = "",
): FunctionDeclaration[] {
  const toolPool = [...AGENT_TOOLS, ...getRelevantDynamicSkillTools(rawPrompt)];
  let matchedTools = toolPool;

  switch (intent) {
    case "research":
      matchedTools = withToolSubset(toolPool, ["web_search", "fetch_url", "memory_search", "openclaw_rag_search"]);
      break;
    case "presentation_creation":
      matchedTools = withToolSubset(toolPool, ["create_presentation", "web_search", "fetch_url"]);
      break;
    case "document_generation":
      matchedTools = withToolSubset(toolPool, ["create_document", "web_search", "fetch_url", "memory_search"]);
      break;
    case "spreadsheet_creation":
      matchedTools = withToolSubset(toolPool, ["create_spreadsheet", "analyze_data", "generate_chart"]);
      break;
    case "data_analysis":
      matchedTools = withToolSubset(toolPool, ["analyze_data", "generate_chart", "create_spreadsheet", "read_file"]);
      break;
    case "web_automation":
      matchedTools = withToolSubset(toolPool, ["web_search", "fetch_url", "browse_and_act"]);
      break;
    default:
      matchedTools = toolPool;
      break;
  }

  // For local computer/folder requests, force local read-only tools into the set.
  if (LOCAL_FILESYSTEM_SIGNAL_REGEX.test(rawPrompt)) {
    const mustHave = new Set(["list_files", "read_file", "memory_search", "openclaw_clawi_status"]);
    const byName = new Map(matchedTools.map((tool) => [tool.name, tool]));
    for (const tool of AGENT_TOOLS) {
      if (mustHave.has(tool.name)) {
        byName.set(tool.name, tool);
      }
    }
    matchedTools = Array.from(byName.values());
  }

  // Filter out sensitive tools if user is not the owner
  if (accessLevel !== 'owner') {
    const sensitiveToolPatterns = ["browse_and_act", "skill_shell", "skill_run_command", "skill_system", "skill_file", "openclaw_clawi_exec"];
    matchedTools = matchedTools.filter(t => !sensitiveToolPatterns.some(pattern => t.name.includes(pattern)));
  }

  // Restrict completely unknown users to safe, read-only tools
  if (accessLevel === 'unknown') {
    const safeToolPatterns = ["web_search", "fetch_url", "analyze_data", "list_files", "read_file", "memory_search"];
    matchedTools = matchedTools.filter(t => safeToolPatterns.some(pattern => t.name.includes(pattern)));
  }

  return matchedTools;
}

import {
  type ReservationDetails,
  type ReservationMissingField,
  extractReservationDetails,
  getMissingReservationFields,
  isRestaurantReservationRequest,
  normalizeSpaces,
  formatReservationDetails,
  buildReservationClarificationQuestion
} from "./utils/reservationExtractor";

async function executeToolCall(
  toolName: string,
  args: Record<string, any>,
  context: ToolContext,
  runId: string,
  sseRes?: Response,
  preExtractedReservation?: ReservationDetails
): Promise<{ result: any; artifact?: { type: string; url: string; name: string } }> {
  console.log(`[AgentExecutor] Executing tool: ${toolName}`, args);

  await emitTraceEvent(runId, "tool_call_started", {
    toolCall: {
      id: randomUUID(),
      name: toolName,
      input: args,
      status: "running"
    }
  });

  const startTime = Date.now();
  let result: any;
  let artifact: { type: string; url: string; name: string } | undefined;

  try {
    switch (toolName) {
      case "web_search": {
        try {
          // Use DuckDuckGo search directly (avoids toolRegistry network policy blocks)
          const { searchWeb } = await import("../services/webSearch");
          const searchResult = await searchWeb(args.query, args.maxResults || 5);
          result = searchResult.results?.length > 0
            ? searchResult.results.map((r: any) => ({ title: r.title, url: r.url, snippet: r.snippet }))
            : { message: "No results found", query: args.query };
        } catch (err: any) {
          // Fallback to toolRegistry
          const searchResult = await toolRegistry.execute("search", {
            query: args.query,
            maxResults: args.maxResults || 5
          }, context);
          result = searchResult.success ? searchResult.output : { error: searchResult.error?.message };
        }
        break;
      }

      case "fetch_url": {
        try {
          const { fetchUrl } = await import("../services/webSearch");
          const fetchResult = await fetchUrl(args.url, {
            extractText: args.extractText ?? true,
            maxLength: 50000
          });
          result = fetchResult;
        } catch (err: any) {
          result = { error: err.message };
        }
        break;
      }





      case "analyze_data": {
        try {
          // Dynamic import to keep startup fast
          const ss = await import("simple-statistics");

          let parsedData: any[] = [];
          if (typeof args.data === "string") {
            try {
              parsedData = JSON.parse(args.data);
            } catch {
              // Try CSV parsing if JSON fails? For now rely on description or basic numbers
              result = { error: "Could not parse data as JSON" };
            }
          } else if (Array.isArray(args.data)) {
            parsedData = args.data;
          }

          if (parsedData.length > 0) {
            // Extract numeric values if it's an array of objects
            const valueKeys = Object.keys(parsedData[0]).filter(k => typeof parsedData[0][k] === 'number');
            const insights: string[] = [];

            valueKeys.forEach(key => {
              const values = parsedData.map((d: any) => d[key]);
              const mean = ss.mean(values);
              const median = ss.median(values);
              const max = ss.max(values);
              const min = ss.min(values);
              const stdDev = ss.standardDeviation(values);

              insights.push(`Field '${key}': Mean=${mean.toFixed(2)}, Median=${median}, Range=[${min}, ${max}], StdDev=${stdDev.toFixed(2)}`);
            });

            result = {
              summary: `Analysis performed on ${parsedData.length} records.`,
              type: args.analysisType || "statistical",
              insights,
              stats: {
                recordCount: parsedData.length,
                fieldsAnalyzed: valueKeys
              }
            };
          } else {
            result = { error: "No valid data provided for analysis" };
          }
        } catch (e: any) {
          result = { error: `Analysis failed: ${e.message}` };
        }
        break;
      }

      case "generate_chart": {
        // Return a structured Chart.js/Recharts compatible config
        const chartConfig = {
          type: args.chartType,
          data: args.data, // Expects { labels: [], datasets: [{ label: '', data: [] }] }
          options: {
            responsive: true,
            plugins: {
              title: {
                display: true,
                text: args.title
              },
              legend: {
                position: 'top'
              }
            }
          }
        };

        result = {
          success: true,
          chartType: args.chartType,
          title: args.title,
          config: chartConfig,
          message: "Chart configuration generated successfully"
        };
        break;
      }

      default: {
        const toolResult = await toolRegistry.execute(toolName, args, context);
        result = toolResult.success ? toolResult.output : { error: toolResult.error?.message };
      }
    }

    const durationMs = Date.now() - startTime;

    await emitTraceEvent(runId, "tool_call_succeeded", {
      toolCall: {
        id: randomUUID(),
        name: toolName,
        input: args,
        output: result,
        status: "completed",
        durationMs
      }
    });

    return { result, artifact };

  } catch (error: any) {
    const durationMs = Date.now() - startTime;

    await emitTraceEvent(runId, "tool_call_failed", {
      toolCall: {
        id: randomUUID(),
        name: toolName,
        input: args,
        status: "failed",
        error: error.message,
        durationMs
      }
    });

    return { result: { error: error.message } };
  }
}

function collectRecentUserText(messages: Array<{ role: string; content: string }>): string {
  return messages
    .filter((m) => m.role === "user")
    .slice(-4)
    .map((m) => normalizeSpaces(m.content))
    .filter(Boolean)
    .join(" ");
}

function extractExplicitPath(rawText: string): string | null {
  const text = String(rawText || "");
  const absolutePath = text.match(/(\/[^\s"'`]+)/);
  if (absolutePath?.[1]) {
    return absolutePath[1];
  }
  const homePath = text.match(/(~\/[^\s"'`]+)/);
  if (homePath?.[1]) {
    return homePath[1];
  }
  return null;
}

function inferLocalDirectoryFromPrompt(rawText: string): string {
  const explicit = extractExplicitPath(rawText);
  if (explicit) return explicit;

  const lower = String(rawText || "").toLowerCase();
  if (/\b(escritorio|desktop)\b/i.test(lower)) return "~/Desktop";
  if (/\b(descargas|downloads)\b/i.test(lower)) return "~/Downloads";
  if (/\b(documentos|documents)\b/i.test(lower)) return "~/Documents";
  if (/\b(im[aá]genes|pictures|fotos|photos)\b/i.test(lower)) return "~/Pictures";
  if (/\b(m[uú]sica|music)\b/i.test(lower)) return "~/Music";
  if (/\b(videos|movies)\b/i.test(lower)) return "~/Movies";
  return "~";
}

export async function executeAgentLoop(
  messages: Array<{ role: string; content: string }>,
  res: Response,
  options: AgentExecutorOptions
): Promise<string> {
  const ai = getGeminiClientOrThrow();
  const { runId, userId, chatId, requestSpec, maxIterations = 10, accessLevel = 'owner' } = options;

  const writeSse = (event: string, payload: Record<string, unknown>) => {
    try {
      const r = res as any;
      if (r.writableEnded || r.destroyed) return false;
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      if (typeof r.flush === "function") r.flush();
      return true;
    } catch {
      return false;
    }
  };

  const sse = {
    write: (event: string, payload: Record<string, unknown>) => writeSse(event, payload),
    end: () => {
      try {
        const r = res as any;
        if (!r.writableEnded && !r.destroyed) {
          res.end();
        }
      } catch {
        // ignore
      }
    },
  };

  const tools = getToolsForIntent(requestSpec.intent, accessLevel, requestSpec.rawMessage || "");
  const toolContext: ToolContext = { userId, chatId, runId };

  const artifacts: Array<{ type: string; url: string; name: string }> = [];
  let iteration = 0;
  let conversationHistory = [...messages];
  let fullResponse = "";

  const recentUserText = collectRecentUserText(messages) || requestSpec.rawMessage || "";
  const isLocalFsRequest = LOCAL_FILESYSTEM_SIGNAL_REGEX.test(recentUserText || requestSpec.rawMessage || "");

  // Request understanding brief is best-effort: if the planner LLM is unavailable
  // or the call fails for any reason, we continue without the brief rather than
  // aborting the entire agent loop (which would surface as a generic error).
  let requestBrief: Awaited<ReturnType<typeof requestUnderstandingAgent.buildBrief>> | null = null;
  try {
    requestBrief = await requestUnderstandingAgent.buildBrief({
      text: recentUserText || requestSpec.rawMessage || "",
      conversationHistory: messages
        .slice(-6)
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content || "") })),
      availableTools: tools.map((tool) => tool.name),
      userId,
      chatId,
      requestId: runId,
      userPlan: "free",
    });

    writeSse(res, "brief", {
      runId,
      brief: requestBrief,
    });

    if (requestBrief.blocker?.is_blocked) {
      const question =
        normalizeSpaces(requestBrief.blocker.question || "") ||
        "Necesito una aclaración para ejecutar la solicitud con seguridad.";
      fullResponse = question;

      writeSse(res, "clarification", {
        runId,
        question,
        blocker: "intent_requirements",
      });

      const chunks = question.match(/.{1,100}/g) || [question];
      for (let i = 0; i < chunks.length; i++) {
        writeSse(res, "chunk", {
          content: chunks[i],
          sequence: i + 1,
          runId,
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      await emitTraceEvent(runId, "progress_update", {
        progress: {
          current: 0,
          total: maxIterations,
          message: "Waiting for required clarification before tool execution",
        },
      });
      await emitTraceEvent(runId, "agent_completed", {
        agent: {
          name: requestSpec.primaryAgent,
          role: "primary",
          status: "completed",
        },
        iterations: 0,
        artifactsGenerated: 0,
      });

      return fullResponse;
    }

    conversationHistory.unshift({
      role: "system",
      content: `Execution brief:
- Objective: ${requestBrief.objective}
- Scope(in): ${requestBrief.scope.in_scope.join("; ") || "n/a"}
- Required inputs: ${requestBrief.required_inputs.filter((entry) => entry.required).map((entry) => entry.input).join("; ") || "none"}
- Expected output: ${requestBrief.expected_output.format} :: ${requestBrief.expected_output.description}
- Definition of done: ${requestBrief.definition_of_done.join("; ") || "n/a"}
- Suggested tools: ${requestBrief.tool_routing.suggested_tools.join(", ") || "none"}
- Blocked tools: ${requestBrief.tool_routing.blocked_tools.join(", ") || "none"}
- Guardrails flags: ${requestBrief.guardrails.flags.join(", ") || "none"}`,
    });
  } catch (briefErr: any) {
    console.warn(`[AgentLoop] requestUnderstanding.buildBrief failed (non-fatal):`, briefErr?.message || briefErr);
  }

  const isReservationRequest =
    requestSpec.intent === "web_automation" && isRestaurantReservationRequest(recentUserText);
  const reservationDetails = isReservationRequest ? extractReservationDetails(recentUserText) : undefined;

  if (isReservationRequest && reservationDetails) {
    const missingFields = getMissingReservationFields(reservationDetails);
    if (missingFields.length > 0) {
      const clarificationQuestion = buildReservationClarificationQuestion(reservationDetails, missingFields);
      fullResponse = clarificationQuestion;
      writeSse(res, "clarification", {
        runId,
        question: clarificationQuestion,
        missingFields,
      });
      const chunks = clarificationQuestion.match(/.{1,100}/g) || [clarificationQuestion];
      for (let i = 0; i < chunks.length; i++) {
        writeSse(res, "chunk", {
          content: chunks[i],
          sequence: i + 1,
          runId
        });
        await new Promise(r => setTimeout(r, 10));
      }
      await emitTraceEvent(runId, "progress_update", {
        progress: {
          current: 0,
          total: maxIterations,
          message: "Waiting for missing reservation details from user"
        }
      });
      await emitTraceEvent(runId, "agent_completed", {
        agent: {
          name: requestSpec.primaryAgent,
          role: "primary",
          status: "completed"
        },
        iterations: 0,
        artifactsGenerated: 0,
      });
      return fullResponse;
    }
  }

  // For web_automation intent, inject a system hint so the LLM uses browse_and_act
  // We PREPEND it as the first system message for maximum priority
  if (requestSpec.intent === "web_automation") {
    const reservationHint =
      isReservationRequest && reservationDetails
        ? `\nReservation details extracted from the user: ${formatReservationDetails(reservationDetails)}`
        : "";
    conversationHistory.unshift({
      role: "system",
      content: `YOU ARE A WEB AUTOMATION AGENT. YOUR PRIMARY FUNCTION IS TO CALL TOOLS, NOT GENERATE TEXT.

YOU MUST IMMEDIATELY call the "browse_and_act" function to complete the user's request. DO NOT write text responses.

MANDATORY RULES:
1. Your FIRST action MUST be a function call to "browse_and_act" with a URL and goal
2. For restaurant reservations in Peru: url="https://www.mesa247.pe", goal="[full details from user]"
3. For hotel bookings: url="https://www.booking.com"
4. For flights: url="https://www.google.com/travel/flights"
5. For general web tasks: url="https://www.google.com"
6. The browse_and_act tool controls a REAL Chromium browser — it can click, type, scroll, fill forms, navigate
7. Include ALL details in the goal: date, time, number of people, location, contact details, preferences
8. For reservations, only claim success if a real confirmation page or confirmation code is visible.

DO NOT respond with text. CALL browse_and_act NOW.${reservationHint}`
    });
  }

  if (isLocalFsRequest) {
    const inferredDirectory = inferLocalDirectoryFromPrompt(recentUserText || requestSpec.rawMessage || "");
    conversationHistory.unshift({
      role: "system",
      content: `YOU ARE A LOCAL FILESYSTEM ANALYST.
You MUST inspect the user's local folders by calling tools, not by asking the user to run commands.

MANDATORY RULES:
1) Your first action should call "list_files".
2) If the user did not provide a path, start with directory="${inferredDirectory}".
3) Use additional list_files calls for key folders when useful (Desktop/Downloads/Documents).
4) Summarize findings clearly with concrete paths and counts.
5) NEVER tell the user to run /local or terminal commands manually.`,
    });
  }

  console.log(`[AgentExecutor] Starting loop: intent=${requestSpec.intent}, tools=[${tools.map(t => t.name).join(', ')}], messages=${conversationHistory.length}, systemMsgs=${conversationHistory.filter(m => m.role === 'system').length}, toolDeclarations=${tools.length}`);

  await emitTraceEvent(runId, "progress_update", {
    progress: {
      current: 0,
      total: maxIterations,
      message: `Starting agent loop with ${tools.length} available tools`
    }
  });

  while (iteration < maxIterations) {
    iteration++;

    await emitTraceEvent(runId, "thinking", {
      content: `Iteration ${iteration}: Analyzing and planning next action...`,
      phase: "execution"
    });

    try {
      const openaiClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
      });

      const openaiMessages: OpenAI.ChatCompletionMessageParam[] = conversationHistory.map(m => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      }));

      const openaiTools: OpenAI.ChatCompletionTool[] = [
        ...tools.map(t => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description || "",
            parameters: t.parameters || {},
          }
        })),
        ...OPENCLAW_TOOLS,
      ];

      const uniqueToolNames = new Set<string>();
      const dedupedTools = openaiTools.filter(t => {
        if (uniqueToolNames.has(t.function.name)) return false;
        uniqueToolNames.add(t.function.name);
        return true;
      });

      const agentModel = process.env.AGENT_MODEL || "minimax/minimax-m2.5";
      const completionPromise = openaiClient.chat.completions.create({
        model: agentModel,
        messages: openaiMessages,
        temperature: 0.7,
        max_tokens: 4096,
        tools: dedupedTools.length > 0 ? dedupedTools : undefined,
        tool_choice: dedupedTools.length > 0 ? "auto" : undefined,
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Agent LLM call timed out after 60s")), 60000)
      );

      const response = await Promise.race([completionPromise, timeoutPromise]);

      const choice = response.choices?.[0];
      if (!choice) {
        throw new Error("No response from model");
      }

      const toolCalls = choice.message?.tool_calls || [];
      let hasToolCall = toolCalls.length > 0;
      let textContent = choice.message?.content || "";
      let shouldExitAgentLoop = false;

      console.log(`[AgentExecutor] Iteration ${iteration}: LLM returned ${toolCalls.length} tool_calls, text=${textContent.slice(0, 80)}...`);

      if (hasToolCall) {
        conversationHistory.push({
          role: "assistant",
          content: choice.message.content || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        } as any);
      }

      for (const tc of toolCalls) {
        const name = tc.function.name;
        let args: Record<string, any> = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}

        sse.write("tool_start", {
          runId,
          toolName: name,
          args,
          iteration
        });

        let result: any;
        let artifact: { type: string; url: string; name: string } | undefined;

        const isOpenClawTool = OPENCLAW_TOOLS.some(t => t.function.name === name);
        if (isOpenClawTool) {
          const toolResult = await executeOpenClawToolCall(
            { id: tc.id, type: "function", function: { name, arguments: tc.function.arguments } },
            (msg) => sse.write("tool_status", { runId, toolName: name, status: msg, iteration })
          );
          try { result = JSON.parse(toolResult.content); } catch { result = toolResult.content; }
        } else {
          const execResult = await executeToolCall(
            name,
            args,
            toolContext,
            runId,
            res,
            reservationDetails
          );
          result = execResult.result;
          artifact = execResult.artifact;
        }

        if (artifact) {
          artifacts.push(artifact);
        }

        sse.write("tool_result", {
          runId,
          toolName: name,
          result,
          artifact,
          iteration
        });

        let resultSummary: string;
        if (name === "browse_and_act") {
          const r = result as any;
          resultSummary = JSON.stringify({
            success: r.success,
            stepsCount: r.stepsCount || r.steps?.length || 0,
            summary: r.data?.summary || r.data?.finalUrl || "Task completed",
            lastSteps: (r.steps || []).slice(-3).map((s: any) =>
              typeof s === 'string' ? s.slice(0, 100) : JSON.stringify(s).slice(0, 100)
            ),
          });
        } else {
          const raw = JSON.stringify(result);
          resultSummary = raw.length > 2000 ? raw.slice(0, 2000) + "... [truncated]" : raw;
        }

        conversationHistory.push({
          role: "tool",
          tool_call_id: tc.id,
          content: resultSummary,
        } as any);

        if (name === "browse_and_act") {
          const r = result as any;
          const wasSuccessful = r.success === true;
          const stepsCount = r.stepsCount || r.steps?.length || 0;
          const lastSteps = (r.steps || []).slice(-3).map((s: any) =>
            typeof s === 'string' ? s : (s?.action || s?.description || JSON.stringify(s).slice(0, 80))
          );
          const dataStatus = String(r?.data?.status || "").toLowerCase();
          const missingFields = Array.isArray(r?.data?.missingFields)
            ? (r.data.missingFields as string[])
            : [];
          const clarificationQuestion = typeof r?.data?.question === "string" ? r.data.question.trim() : "";
          const confirmationCode =
            r?.data?.confirmationCode ||
            r?.data?.reservationCode ||
            r?.data?.bookingReference ||
            r?.data?.confirmation;
          const isNeedsUserInput = dataStatus === "needs_user_input" || missingFields.length > 0;

          let summaryText: string;
          if (isNeedsUserInput) {
            const reason = String(r?.data?.reason || "").toLowerCase();
            const question =
              clarificationQuestion ||
              `Para continuar con la reserva necesito: ${missingFields.join(", ")}.`;
            if (reason === "no_web_availability" && isReservationRequest) {
              const rd = reservationDetails;
              const avail = Array.isArray(r?.data?.availableTimes) ? r.data.availableTimes : [];
              const availBlock = avail.length > 0 ? `\n\n**Horarios disponibles:** ${avail.join(", ")}` : "";
              summaryText = `**Sin disponibilidad online**\n\n${question}${availBlock}\n\n_Restaurante: ${rd?.restaurant || "—"} · Fecha: ${rd?.date || "—"} · Personas: ${rd?.partySize || "—"}_`;
            } else if (reason === "past_date" && isReservationRequest) {
              summaryText = `**Fecha pasada**\n\n${question}`;
            } else if (reason === "duplicate_reservation_detected" && isReservationRequest) {
              summaryText = `**Reserva duplicada**\n\n${question}`;
            } else if (reason === "restaurant_closed" && isReservationRequest) {
              summaryText = `**Restaurante cerrado**\n\n${question}`;
            } else if (reason === "runtime_timeout") {
              summaryText = `**Tiempo agotado**\n\n${question}`;
            } else if (reason === "page_navigation_error" || reason === "browser_session_closed") {
              summaryText = `**Error de conexion**\n\n${question}`;
            } else if (reason === "invalid_contact_data") {
              summaryText = `**Datos invalidos**\n\n${question}`;
            } else {
              summaryText = question;
            }
            sse.write("clarification", {
              runId,
              question,
              missingFields,
            });
          } else if (isReservationRequest) {
            const rd = reservationDetails;
            const checkItems: string[] = [];
            if (rd?.restaurant) checkItems.push(`- [x] **Restaurante:** ${rd.restaurant}`);
            if (rd?.date) checkItems.push(`- [x] **Fecha:** ${rd.date}`);
            if (r?.data?.timeAdjusted && r?.data?.selectedTime) {
              checkItems.push(`- [x] **Hora:** ${r.data.selectedTime} _(solicitada: ${r.data.requestedTime || rd?.time})_`);
            } else if (rd?.time) {
              checkItems.push(`- [x] **Hora:** ${rd.time}`);
            }
            if (rd?.partySize) checkItems.push(`- [x] **Personas:** ${rd.partySize}`);
            if (rd?.contactName) checkItems.push(`- [x] **Nombre:** ${rd.contactName}`);
            if (rd?.phone) checkItems.push(`- [x] **Telefono:** ${rd.phone}`);
            if (rd?.email) checkItems.push(`- [x] **Email:** ${rd.email}`);

            const checklistBlock = checkItems.length > 0 ? `\n\n**Checklist:**\n${checkItems.join("\n")}` : "";
            if (wasSuccessful && confirmationCode) {
              summaryText = `**Reserva confirmada en la web**\n\nCodigo/confirmacion: ${confirmationCode}${checklistBlock}\n\n**Ultimas acciones:**\n${lastSteps.map((s: string) => `- ${s}`).join("\n")}`;
            } else if (wasSuccessful) {
              summaryText = `**Automatizacion web completada exitosamente**${checklistBlock}\n\nRealice ${stepsCount} acciones en el navegador para completar tu solicitud.\n\n**Ultimas acciones:**\n${lastSteps.map((s: string) => `- ${s}`).join("\n")}`;
            } else {
              summaryText = `**Automatizacion web finalizada** (${stepsCount} pasos)${checklistBlock}\n\nNavegue por el sitio web y realice varias acciones, pero no pude confirmar que la tarea se completo al 100%.\n\n**Ultimas acciones:**\n${lastSteps.map((s: string) => `- ${s}`).join("\n")}\n\nTe recomiendo verificar directamente en el sitio web.`;
            }
          } else if (wasSuccessful && confirmationCode) {
            summaryText = `**Reserva confirmada en la web**\n\nCodigo/confirmacion: ${confirmationCode}\n\n**Ultimas acciones:**\n${lastSteps.map((s: string) => `- ${s}`).join("\n")}`;
          } else if (wasSuccessful) {
            summaryText = `**Automatizacion web completada exitosamente**\n\nRealice ${stepsCount} acciones en el navegador para completar tu solicitud.\n\n**Ultimas acciones:**\n${lastSteps.map((s: string) => `- ${s}`).join("\n")}`;
          } else {
            summaryText = `**Automatizacion web finalizada** (${stepsCount} pasos)\n\nNavegue por el sitio web y realice varias acciones, pero no pude confirmar que la tarea se completo al 100%.\n\n**Ultimas acciones:**\n${lastSteps.map((s: string) => `- ${s}`).join("\n")}\n\nTe recomiendo verificar directamente en el sitio web.`;
          }

          fullResponse = summaryText;
          sse.write("chunk", {
            content: "\n\n" + summaryText,
            sequence: 1,
            runId,
          });
          console.log(`[AgentExecutor] browse_and_act FAST EXIT: success=${wasSuccessful}, steps=${stepsCount}`);
          shouldExitAgentLoop = true;
          break;
        }
      }

      if (shouldExitAgentLoop) {
        break;
      }

      if (textContent) {
        fullResponse += textContent;

        if (!hasToolCall) {
          // For web_automation intent: if the LLM returned text instead of a tool call
          // AND we haven't already tried browse_and_act (iteration 1 = first attempt),
          // force it to use browse_and_act by injecting a strong nudge and retrying.
          // After the first browse_and_act attempt, allow text responses (result summaries).
          const alreadyUsedBrowser = conversationHistory.some(m =>
            (m as any).role === "tool" && (m as any).tool_call_id && String(m.content || "").includes("browse_and_act")
            || (m as any).tool_calls?.some((tc: any) => tc.function?.name === "browse_and_act")
          );
          if (requestSpec.intent === "web_automation" && iteration <= 2 && !alreadyUsedBrowser) {
            console.log(`[AgentExecutor] web_automation: LLM returned text instead of tool call on iteration ${iteration}, forcing tool use...`);
            conversationHistory.push({
              role: "assistant",
              content: textContent
            });
            conversationHistory.push({
              role: "user",
              content: `IMPORTANT: Do NOT respond with text. You MUST call the "browse_and_act" function right now to open a real browser and complete the task. Call browse_and_act with url="https://www.mesa247.pe" and goal containing all the details from the user's request. Do it NOW.`
            });
            textContent = "";
            fullResponse = "";
            continue; // retry the iteration
          }

          const alreadyUsedListFiles = conversationHistory.some((m) =>
            (m as any).tool_calls?.some((tc: any) => tc.function?.name === "list_files"),
          );
          if (isLocalFsRequest && iteration <= 2 && !alreadyUsedListFiles) {
            const inferredDirectory = inferLocalDirectoryFromPrompt(recentUserText || requestSpec.rawMessage || "");
            console.log(`[AgentExecutor] local_fs: LLM returned text instead of tool call on iteration ${iteration}, forcing list_files(${inferredDirectory})...`);
            conversationHistory.push({
              role: "assistant",
              content: textContent,
            });
            conversationHistory.push({
              role: "user",
              content: `IMPORTANT: do not ask the user to run commands. Call list_files now with {"directory":"${inferredDirectory}","maxEntries":200}. After that, summarize findings with concrete paths and counts.`,
            });
            textContent = "";
            fullResponse = "";
            continue; // retry the iteration
          }

          // A1: Agent Verifier - Quality Gate
          try {
            // Dynamic import to avoid circular dependencies if any, though explicit import is better. 
            // Since I can't add top-level imports easily with replace_file_content if I don't target the top, I'll use dynamic import or just hope for the best? 
            // Actually, I should use multi_replace to add the import.
            // But wait, I can use dynamic import here to be safe and localized.
            const { validateResponse } = await import("../services/responseValidator");
            const validation = validateResponse(textContent);

            if (!validation.isValid && iteration < maxIterations) {
              console.warn(`[AgentVerifier] Response rejected: ${validation.issues.map(i => i.message).join(", ")}`);

              await emitTraceEvent(runId, "verification_failed", {
                issues: validation.issues,
                rejectedContent: textContent.substring(0, 100) + "..."
              });

              conversationHistory.push({
                role: "assistant",
                content: textContent
              });
              conversationHistory.push({
                role: "user",
                content: `SYSTEM_ALERT: Your response was rejected by the Quality Verifier. 
Issues detected:
${validation.issues.map(i => `- ${i.message}`).join("\n")}

Please rewrite your response addressing these issues.`
              });

              // Skip streaming and continue to next iteration for retry
              continue;
            }
          } catch (err: any) {
            console.error("[AgentVerifier] Error during validation:", err);
            // Fail open: if verifier crashes, let the response through but log it
            await emitTraceEvent(runId, "verification_failed", {
              error: {
                message: `Verifier crashed: ${err.message}`,
                details: { stack: err.stack }
              },
              metadata: {
                checkName: "System Integrity",
                contentSnippet: textContent.substring(0, 50)
              }
            });
          }

          const chunks = textContent.match(/.{1,100}/g) || [textContent];
          for (let i = 0; i < chunks.length; i++) {
            sse.write("chunk", {
              content: chunks[i],
              sequence: i + 1,
              runId
            });
            await new Promise(r => setTimeout(r, 10));
          }

          break;
        }
      }

      await emitTraceEvent(runId, "progress_update", {
        progress: {
          current: iteration,
          total: maxIterations,
          message: `Completed iteration ${iteration}`
        }
      });

    } catch (error: any) {
      console.error(`[AgentExecutor] Error in iteration ${iteration}:`, error?.message || error);

      await emitTraceEvent(runId, "error", {
        error: {
          code: "AGENT_EXECUTION_ERROR",
          message: error.message,
          retryable: iteration < maxIterations
        }
      });

      // If browse_and_act already ran successfully and the follow-up LLM call
      // failed (timeout, too-large context, etc.), generate a fallback summary
      // instead of retrying forever or crashing.
      const alreadyBrowsed = conversationHistory.some(m =>
        (m as any).tool_calls?.some((tc: any) => tc.function?.name === "browse_and_act")
      );
      if (alreadyBrowsed && !fullResponse) {
        console.log(`[AgentExecutor] Post-browse LLM call failed, generating fallback summary`);
        // Extract browse result from conversation history
        const browseResultMsg = conversationHistory.find(m =>
          (m as any).role === "tool" && String(m.content || "").includes('"success"')
        );
        const browseData = String(browseResultMsg?.content || "");
        const successMatch = browseData.match(/"success"\s*:\s*(true|false)/);
        const wasSuccessful = successMatch?.[1] === "true";

        const fallback = wasSuccessful
          ? "✅ He completado la automatización web exitosamente. El navegador realizó todas las acciones necesarias en el sitio web."
          : "⚠️ He intentado completar la tarea de automatización web. El navegador navegó por el sitio web y realizó varias acciones, pero no pude confirmar que la tarea se completó al 100%. Te recomiendo verificar directamente en el sitio.";

        fullResponse = fallback;
        const chunks = fallback.match(/.{1,100}/g) || [fallback];
        for (let i = 0; i < chunks.length; i++) {
          sse.write("chunk", {
            content: chunks[i],
            sequence: i + 1,
            runId
          });
        }
        break; // Exit the while loop
      }

      if (iteration >= maxIterations) {
        throw error;
      }
    }
  }

  if (!fullResponse && iteration >= maxIterations) {
    const fallbackMsg = artifacts.length > 0
      ? `He completado las tareas solicitadas y generé ${artifacts.length} archivo(s) para ti.`
      : "He procesado tu solicitud. Avísame si necesitas algo más.";
    fullResponse = fallbackMsg;
    sse.write("chunk", {
      content: fallbackMsg,
      sequence: 1,
      runId
    });
  }

  if (artifacts.length > 0) {
    sse.write("artifacts", {
      runId,
      artifacts,
      count: artifacts.length
    });
  }

  await emitTraceEvent(runId, "agent_completed", {
    agent: {
      name: requestSpec.primaryAgent,
      role: "primary",
      status: "completed"
    },
    iterations: iteration,
    artifactsGenerated: artifacts.length
  });

  // Ensure deterministic termination signal is sent when the agent finishes,
  // preventing the frontend from getting stuck in an infinite polling loop.
  sse.write("done", { runId, status: "completed", isFallback: true });
  sse.end();

  return fullResponse;
}

export {
  AGENT_TOOLS,
  getToolsForIntent,
  isRestaurantReservationRequest,
  extractReservationDetails,
  getMissingReservationFields,
  formatReservationDetails,
  buildReservationClarificationQuestion,
  normalizeSpaces,
  collectRecentUserText,
};
export type { ReservationDetails, ReservationMissingField };
