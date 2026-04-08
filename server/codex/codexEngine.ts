/**
 * Codex VC Coding Agent Engine
 *
 * Orchestrates an LLM-driven coding loop: given a user instruction, the engine
 * generates a plan of steps (file writes, terminal commands, installs, etc.),
 * executes each step via a sandboxed workspace, retries on failure, and yields
 * real-time step events for UI consumption.
 *
 * NOTE: Terminal execution is delegated to the Sandbox class which uses
 * child_process.spawn with shell:true — this is intentional for running
 * arbitrary build commands. The Sandbox validates all commands against
 * BLOCKED_COMMANDS before execution. See sandbox.ts and
 * server/agent/claw/terminalTool.ts for the established pattern.
 */

import crypto from "crypto";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { llmGateway } from "../lib/llmGateway";
import { Sandbox, createSandbox } from "./sandbox";

// --- Types ---

export interface CodexSession {
  id: string;
  userId: string;
  projectName: string;
  workspace: string;
  framework: string;
  status: "idle" | "planning" | "coding" | "running" | "error";
  createdAt: Date;
  steps: CodexStep[];
  iteration: number;
}

export interface CodexStep {
  id: string;
  type: "plan" | "file_write" | "file_read" | "terminal" | "install" | "preview" | "fix";
  description: string;
  status: "pending" | "running" | "done" | "error";
  output?: string;
  error?: string;
  timestamp: number;
}

interface PlannedStep {
  type: "file_write" | "terminal";
  path?: string;
  content?: string;
  command?: string;
  description: string;
}

// --- Constants ---

const MAX_ITERATIONS = 20;
const MAX_RETRIES_PER_STEP = 3;
const DEFAULT_MODEL = "grok-3-mini";

const SYSTEM_PROMPT = `You are a coding agent. Given the user's instruction and the current project state, output a JSON array of steps to execute. Each step is:
{
  "type": "file_write" | "terminal",
  "path": "<relative file path (for file_write)>",
  "content": "<file content (for file_write)>",
  "command": "<shell command (for terminal)>",
  "description": "<brief description of what this step does>"
}

Rules:
- Output ONLY a valid JSON array. No markdown fencing, no explanation outside the array.
- For new projects, start with package.json and config files before source files.
- Use "terminal" for installing dependencies (npm install), running builds, starting dev servers, etc.
- Use "file_write" for creating or overwriting files.
- Keep each step focused and atomic.
- If fixing an error, output only the steps needed to fix it.`;

const FIX_PROMPT = `The previous step failed with this error:

{error}

Current project files:
{files}

Generate a JSON array of fix steps (same format as before) to resolve this error. Output ONLY the JSON array.`;

// --- Session store ---

const sessions = new Map<string, CodexSession>();
const sandboxes = new Map<string, Sandbox>();

// --- Helper: call LLM and extract text ---

async function callLLM(
  messages: ChatCompletionMessageParam[],
  userId: string,
  model: string = DEFAULT_MODEL,
): Promise<string> {
  const response = await llmGateway.chat(messages, {
    model,
    userId,
    maxTokens: 8192,
    temperature: 0.2,
  });
  return response.content;
}

// --- Helper: parse plan from LLM output ---

function parsePlan(raw: string): PlannedStep[] {
  // Strip markdown code fences if the LLM wraps them
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Attempt to extract JSON array from surrounding text
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) {
      throw new Error("LLM did not return a valid JSON array of steps");
    }
    parsed = JSON.parse(match[0]);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("LLM response is not an array");
  }

  return parsed.map((step: any) => ({
    type: step.type === "terminal" ? "terminal" : "file_write",
    path: step.path,
    content: step.content,
    command: step.command,
    description: step.description || "Unnamed step",
  }));
}

// --- Helper: get project file listing as context string ---

async function getProjectContext(sandbox: Sandbox): Promise<string> {
  try {
    const files = await sandbox.listFiles();
    if (files.length === 0) return "(empty project)";
    return files
      .map((f) => `${f.type === "directory" ? "D" : "F"} ${f.relativePath}${f.size != null ? ` (${f.size}b)` : ""}`)
      .join("\n");
  } catch {
    return "(unable to list files)";
  }
}

// --- Public API ---

/** Create a new Codex coding session with a sandboxed workspace. */
export async function createSession(
  userId: string,
  projectName: string,
  instruction: string,
  template?: string,
): Promise<CodexSession> {
  const id = crypto.randomUUID();
  const sandbox = await createSandbox(id);

  // Initialize from template if provided
  const framework = template || "blank";
  if (template) {
    const templateCommands: Record<string, string> = {
      react: "npm init vite@latest . -- --template react-ts && npm install",
      next: "npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-git --use-npm",
      express: 'npm init -y && npm install express typescript @types/express @types/node ts-node && npx tsc --init',
      node: "npm init -y",
    };
    const cmd = templateCommands[template];
    if (cmd) {
      await sandbox.exec(cmd, 120_000);
    }
  }

  const session: CodexSession = {
    id,
    userId,
    projectName,
    workspace: sandbox.workspace,
    framework,
    status: "idle",
    createdAt: new Date(),
    steps: [],
    iteration: 0,
  };

  sessions.set(id, session);
  sandboxes.set(id, sandbox);
  return session;
}

/**
 * Execute an instruction within a Codex session.
 *
 * This is the main agent loop: it asks the LLM for a plan, executes each step,
 * and retries failures. Yields CodexStep events for real-time UI streaming.
 */
export async function* executeInstruction(
  sessionId: string,
  instruction: string,
): AsyncGenerator<CodexStep> {
  const session = sessions.get(sessionId);
  const sandbox = sandboxes.get(sessionId);
  if (!session || !sandbox) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  session.status = "planning";
  session.iteration = 0;

  // --- Step 1: Generate plan ---
  const projectFiles = await getProjectContext(sandbox);
  const planMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Project: ${session.projectName}\nFramework: ${session.framework}\n\nCurrent files:\n${projectFiles}\n\nInstruction: ${instruction}`,
    },
  ];

  const planStep: CodexStep = {
    id: crypto.randomUUID(),
    type: "plan",
    description: "Generating execution plan",
    status: "running",
    timestamp: Date.now(),
  };
  session.steps.push(planStep);
  yield planStep;

  let plan: PlannedStep[];
  try {
    const rawPlan = await callLLM(planMessages, session.userId);
    plan = parsePlan(rawPlan);
    planStep.status = "done";
    planStep.output = `${plan.length} step(s) planned`;
  } catch (err: any) {
    planStep.status = "error";
    planStep.error = err.message;
    session.status = "error";
    yield { ...planStep };
    return;
  }
  yield { ...planStep };

  // --- Step 2: Execute each planned step ---
  session.status = "coding";

  for (const planned of plan) {
    if (session.iteration >= MAX_ITERATIONS) {
      const limitStep: CodexStep = {
        id: crypto.randomUUID(),
        type: "plan",
        description: "Iteration limit reached",
        status: "error",
        error: `Exceeded maximum of ${MAX_ITERATIONS} iterations`,
        timestamp: Date.now(),
      };
      session.steps.push(limitStep);
      session.status = "error";
      yield limitStep;
      return;
    }

    session.iteration++;
    const step = await executeStep(planned, sandbox, session);
    yield step;

    // --- Step 3: Retry on failure ---
    if (step.status === "error" && step.error) {
      let fixed = false;
      for (let retry = 0; retry < MAX_RETRIES_PER_STEP && !fixed; retry++) {
        session.iteration++;
        if (session.iteration >= MAX_ITERATIONS) break;

        const fixStep = await attemptFix(step.error, sandbox, session);
        yield fixStep;
        if (fixStep.status === "done") {
          fixed = true;
        }
      }

      if (!fixed) {
        session.status = "error";
        return;
      }
    }
  }

  session.status = "idle";
}

/** Execute a single planned step in the sandbox. */
async function executeStep(
  planned: PlannedStep,
  sandbox: Sandbox,
  session: CodexSession,
): Promise<CodexStep> {
  const step: CodexStep = {
    id: crypto.randomUUID(),
    type: planned.type === "terminal" ? "terminal" : "file_write",
    description: planned.description,
    status: "running",
    timestamp: Date.now(),
  };
  session.steps.push(step);

  try {
    if (planned.type === "file_write" && planned.path && planned.content !== undefined) {
      await sandbox.writeFile(planned.path, planned.content);
      step.output = `Wrote ${planned.path} (${Buffer.byteLength(planned.content, "utf-8")} bytes)`;
      step.status = "done";
    } else if (planned.type === "terminal" && planned.command) {
      session.status = "running";
      const result = await sandbox.exec(planned.command);
      step.output = result.stdout || result.stderr || "(no output)";
      if (result.exitCode !== 0) {
        step.status = "error";
        step.error = `Exit code ${result.exitCode}: ${result.stderr || result.stdout}`.slice(0, 2000);
      } else {
        step.status = "done";
      }
      session.status = "coding";
    } else {
      step.status = "error";
      step.error = "Invalid step: missing required fields";
    }
  } catch (err: any) {
    step.status = "error";
    step.error = err.message;
  }

  return step;
}

/** Ask the LLM for a fix and execute the resulting steps. */
async function attemptFix(
  errorText: string,
  sandbox: Sandbox,
  session: CodexSession,
): Promise<CodexStep> {
  const fixStep: CodexStep = {
    id: crypto.randomUUID(),
    type: "fix",
    description: "Attempting automatic fix",
    status: "running",
    timestamp: Date.now(),
  };
  session.steps.push(fixStep);

  try {
    const projectFiles = await getProjectContext(sandbox);
    const prompt = FIX_PROMPT
      .replace("{error}", errorText.slice(0, 1500))
      .replace("{files}", projectFiles.slice(0, 3000));

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ];

    const rawFix = await callLLM(messages, session.userId);
    const fixPlan = parsePlan(rawFix);

    // Execute each fix step sequentially
    for (const planned of fixPlan) {
      const result = await executeStep(planned, sandbox, session);
      if (result.status === "error") {
        fixStep.status = "error";
        fixStep.error = result.error;
        return fixStep;
      }
    }

    fixStep.status = "done";
    fixStep.output = `Applied ${fixPlan.length} fix step(s)`;
  } catch (err: any) {
    fixStep.status = "error";
    fixStep.error = err.message;
  }

  return fixStep;
}

/** Retrieve an existing session by ID. */
export function getSession(sessionId: string): CodexSession | undefined {
  return sessions.get(sessionId);
}

/** Close a session: cleanup sandbox and remove from store. */
export async function closeSession(sessionId: string): Promise<void> {
  const sandbox = sandboxes.get(sessionId);
  if (sandbox) {
    await sandbox.cleanup();
    sandboxes.delete(sessionId);
  }
  sessions.delete(sessionId);
}

/** List all sessions for a given user. */
export function listSessions(userId: string): CodexSession[] {
  const result: CodexSession[] = [];
  for (const session of sessions.values()) {
    if (session.userId === userId) {
      result.push(session);
    }
  }
  return result;
}

// --- Convenience wrappers used by the router ---

function getSandboxOrThrow(sessionId: string) {
  const sandbox = sandboxes.get(sessionId);
  if (!sandbox) throw new Error(`Session "${sessionId}" not found or sandbox not initialized`);
  return sandbox;
}

export async function listFiles(sessionId: string) {
  return getSandboxOrThrow(sessionId).listFiles();
}

export async function readFile(sessionId: string, filePath: string) {
  return getSandboxOrThrow(sessionId).readFile(filePath);
}

export async function writeFile(sessionId: string, filePath: string, content: string) {
  return getSandboxOrThrow(sessionId).writeFile(filePath, content);
}

export async function runCommand(sessionId: string, command: string) {
  return getSandboxOrThrow(sessionId).exec(command);
}
