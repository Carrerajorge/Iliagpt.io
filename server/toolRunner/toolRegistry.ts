import { ToolCommandName, ToolRunnerToolDefinition } from "./types";

export const TOOL_RUNNER_PROTOCOL_VERSION = "tool-runner-cli/1.0";
export const TOOL_RUNNER_COMMAND_VERSION = "1.0.0";

const TOOL_DEFINITIONS: ToolRunnerToolDefinition[] = [
  {
    name: "docgen",
    version: TOOL_RUNNER_COMMAND_VERSION,
    description: "Generate DOCX artifacts from deterministic JSON input.",
    capabilities: ["docx", "openxml", "document-generation", "stateless"],
    stateless: true,
    inputFormat: "json",
    outputFormat: "file+json",
  },
  {
    name: "xlsxgen",
    version: TOOL_RUNNER_COMMAND_VERSION,
    description: "Generate XLSX artifacts from deterministic JSON input.",
    capabilities: ["xlsx", "openxml", "spreadsheet-generation", "stateless"],
    stateless: true,
    inputFormat: "json",
    outputFormat: "file+json",
  },
  {
    name: "pptxgen",
    version: TOOL_RUNNER_COMMAND_VERSION,
    description: "Generate PPTX artifacts from deterministic JSON input.",
    capabilities: ["pptx", "openxml", "presentation-generation", "stateless"],
    stateless: true,
    inputFormat: "json",
    outputFormat: "file+json",
  },
  {
    name: "theme-apply",
    version: TOOL_RUNNER_COMMAND_VERSION,
    description: "Resolve and normalize design tokens/theme before rendering.",
    capabilities: ["theme", "design-tokens", "normalization", "stateless"],
    stateless: true,
    inputFormat: "json",
    outputFormat: "file+json",
  },
  {
    name: "render-preview",
    version: TOOL_RUNNER_COMMAND_VERSION,
    description: "Build deterministic preview metadata for generated artifacts.",
    capabilities: ["preview", "metadata", "rendering", "stateless"],
    stateless: true,
    inputFormat: "json",
    outputFormat: "file+json",
  },
  {
    name: "mso-validate",
    version: TOOL_RUNNER_COMMAND_VERSION,
    description: "Validate MSO/OpenXML integrity and compatibility constraints.",
    capabilities: ["mso", "openxml", "validation", "schema", "relationships"],
    stateless: true,
    inputFormat: "json",
    outputFormat: "file+json",
  },
];

export function listToolDefinitions(): ToolRunnerToolDefinition[] {
  return [...TOOL_DEFINITIONS];
}

export function getToolDefinition(name: ToolCommandName): ToolRunnerToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((tool) => tool.name === name);
}

export function isKnownTool(name: string): name is ToolCommandName {
  return TOOL_DEFINITIONS.some((tool) => tool.name === name);
}

export function getHealthSnapshot(command?: ToolCommandName): {
  status: "healthy";
  protocolVersion: string;
  commandVersion: string;
  tools: Array<{ name: ToolCommandName; status: "healthy"; version: string }>;
} {
  const filtered = command
    ? TOOL_DEFINITIONS.filter((tool) => tool.name === command)
    : TOOL_DEFINITIONS;

  return {
    status: "healthy",
    protocolVersion: TOOL_RUNNER_PROTOCOL_VERSION,
    commandVersion: TOOL_RUNNER_COMMAND_VERSION,
    tools: filtered.map((tool) => ({
      name: tool.name,
      status: "healthy",
      version: tool.version,
    })),
  };
}
