import fs from "fs/promises";
import path from "path";

const AGENT_ZERO_ROOT = path.resolve(process.cwd(), "external", "agent_ecosystem", "agent-zero");
const DEFAULT_AGENTS_DIR = "agents";
const BASE_PROMPTS_DIR = "prompts";

export type AgentZeroAgentSummary = {
  name: string;
  title: string;
  description: string;
  context: string;
  enabled: boolean;
  path: string;
};

export type AgentZeroPromptPack = {
  agent: AgentZeroAgentSummary;
  prompts: Record<string, string>;
  basePrompts: Record<string, string>;
  assembled: string;
};

const safeReadFile = async (filePath: string, maxBytes = 200_000): Promise<string> => {
  const data = await fs.readFile(filePath, "utf8");
  if (data.length <= maxBytes) return data;
  return `${data.slice(0, maxBytes)}\n...[truncated]`;
};

const readJsonFile = async (filePath: string): Promise<Record<string, unknown> | null> => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const readPromptDir = async (dirPath: string): Promise<Record<string, string>> => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const prompts: Record<string, string> = {};
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".md")) continue;
      const filePath = path.join(dirPath, entry.name);
      prompts[entry.name] = await safeReadFile(filePath);
    }
    return prompts;
  } catch {
    return {};
  }
};

export async function listAgentZeroAgents(): Promise<AgentZeroAgentSummary[]> {
  const agentsRoot = path.join(AGENT_ZERO_ROOT, DEFAULT_AGENTS_DIR);
  const entries = await fs.readdir(agentsRoot, { withFileTypes: true });
  const agents: AgentZeroAgentSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const agentDir = path.join(agentsRoot, entry.name);
    const agentJsonPath = path.join(agentDir, "agent.json");
    const data = await readJsonFile(agentJsonPath);

    const title = typeof data?.title === "string" ? data.title : entry.name;
    const description = typeof data?.description === "string" ? data.description : "";
    const context = typeof data?.context === "string" ? data.context : "";
    const enabled = data?.enabled === false ? false : true;

    agents.push({
      name: entry.name,
      title,
      description,
      context,
      enabled,
      path: agentDir,
    });
  }

  agents.sort((a, b) => a.name.localeCompare(b.name));
  return agents;
}

export async function loadAgentZeroPrompts(options: {
  agentName: string;
  includeBasePrompts?: boolean;
}): Promise<AgentZeroPromptPack> {
  const agentsRoot = path.join(AGENT_ZERO_ROOT, DEFAULT_AGENTS_DIR);
  const agentDir = path.join(agentsRoot, options.agentName);
  const agentJsonPath = path.join(agentDir, "agent.json");
  const data = await readJsonFile(agentJsonPath);

  const title = typeof data?.title === "string" ? data.title : options.agentName;
  const description = typeof data?.description === "string" ? data.description : "";
  const context = typeof data?.context === "string" ? data.context : "";
  const enabled = data?.enabled === false ? false : true;

  const promptsDir = path.join(agentDir, "prompts");
  const prompts = await readPromptDir(promptsDir);

  const basePrompts = options.includeBasePrompts
    ? await readPromptDir(path.join(AGENT_ZERO_ROOT, BASE_PROMPTS_DIR))
    : {};

  const assembled = assemblePrompts({ ...basePrompts, ...prompts });

  return {
    agent: {
      name: options.agentName,
      title,
      description,
      context,
      enabled,
      path: agentDir,
    },
    prompts,
    basePrompts,
    assembled,
  };
}

function assemblePrompts(prompts: Record<string, string>): string {
  return Object.keys(prompts)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `# ${name}\n${prompts[name]}`)
    .join("\n\n");
}
