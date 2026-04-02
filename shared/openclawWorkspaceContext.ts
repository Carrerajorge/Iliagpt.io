export type OpenClawCodingAgentProfile = "coder" | "reviewer" | "improver";

export interface OpenClawWorkspaceContext {
  projectId?: string;
  projectName?: string;
  repositoryPath: string;
  selectedFolder: string;
  codingAgents: OpenClawCodingAgentProfile[];
  runtimeTarget: string;
  executionAccess: string;
  branch?: string;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeOpenClawWorkspaceContext(
  input: unknown,
): OpenClawWorkspaceContext | undefined {
  if (!input || typeof input !== "object") return undefined;
  const source = input as Record<string, unknown>;

  const repositoryPath = normalizeNonEmptyString(source.repositoryPath);
  if (!repositoryPath) return undefined;

  let selectedFolder = normalizeNonEmptyString(source.selectedFolder) || ".";
  selectedFolder = selectedFolder.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!selectedFolder || selectedFolder === ".") selectedFolder = ".";
  if (selectedFolder.startsWith("/") || selectedFolder.includes("..")) {
    selectedFolder = ".";
  }

  const codingAgents = Array.isArray(source.codingAgents)
    ? source.codingAgents.filter(
        (value): value is OpenClawCodingAgentProfile =>
          value === "coder" || value === "reviewer" || value === "improver",
      )
    : [];

  return {
    projectId: normalizeNonEmptyString(source.projectId),
    projectName: normalizeNonEmptyString(source.projectName),
    repositoryPath,
    selectedFolder,
    codingAgents: codingAgents.length > 0 ? codingAgents : ["coder"],
    runtimeTarget: normalizeNonEmptyString(source.runtimeTarget) || "Local",
    executionAccess:
      normalizeNonEmptyString(source.executionAccess) || "Full access",
    branch: normalizeNonEmptyString(source.branch),
  };
}
