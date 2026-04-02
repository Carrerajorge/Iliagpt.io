import fs from "fs/promises";
import path from "path";
import { AGENT_ECOSYSTEM_WAVES, type AgentEcosystemWaveId } from "../data/agentEcosystemWaves";

export type AgentEcosystemWorkspaceRepo = {
  name: string;
  path: string;
  wave: AgentEcosystemWaveId | "unassigned";
  exists: boolean;
};

const normalizeRepoName = (value: string): string => value.trim().toLowerCase().replace(/_/g, "-");

const getWaveForRepo = (repo: string): AgentEcosystemWorkspaceRepo["wave"] => {
  const normalized = normalizeRepoName(repo);
  for (const [wave, repos] of Object.entries(AGENT_ECOSYSTEM_WAVES)) {
    if (repos.some((name) => normalizeRepoName(name) === normalized)) {
      return wave as AgentEcosystemWaveId;
    }
  }
  return "unassigned";
};

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function loadAgentEcosystemWorkspace(root = process.cwd()): Promise<AgentEcosystemWorkspaceRepo[]> {
  const ecosystemRoot = path.join(root, "external", "agent_ecosystem");
  const manifestPath = path.join(ecosystemRoot, "repos.manifest.json");
  const listPath = path.join(ecosystemRoot, "repos.list");

  const manifest = await readJson<{ repos?: Array<{ name: string; path?: string; exists?: boolean }> }>(manifestPath);
  if (manifest?.repos?.length) {
    return manifest.repos.map((repo) => ({
      name: repo.name,
      path: path.resolve(root, repo.path || path.join("external", "agent_ecosystem", repo.name)),
      exists: Boolean(repo.exists),
      wave: getWaveForRepo(repo.name),
    }));
  }

  const rawList = await fs.readFile(listPath, "utf8");
  const rows = rawList.split(/\r?\n/).filter(Boolean);
  return rows.map((row) => {
    const [name] = row.split("|");
    const repoPath = path.resolve(root, "external", "agent_ecosystem", name);
    return {
      name,
      path: repoPath,
      exists: true,
      wave: getWaveForRepo(name),
    };
  });
}

export async function getWaveRepos(wave: AgentEcosystemWaveId, root = process.cwd()) {
  const repos = await loadAgentEcosystemWorkspace(root);
  return repos.filter((repo) => repo.wave === wave);
}
