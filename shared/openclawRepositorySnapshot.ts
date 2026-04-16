export type OpenClawRepositoryStyle =
  | "single-package"
  | "monorepo"
  | "polyglot"
  | "unknown";

export type OpenClawPackageManager =
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun"
  | "uv"
  | "pip"
  | "unknown";

export type OpenClawPreferredCommandKind =
  | "dev"
  | "build"
  | "test"
  | "lint";

export interface OpenClawRepositoryRoot {
  path: string;
  kind: "repository" | "application" | "package" | "service";
  manifest: "package.json" | "pyproject.toml" | "requirements.txt";
  name?: string;
}

export interface OpenClawPreferredCommand {
  command: string;
  workingDirectory: string;
  source: "selected-root" | "repository-root" | "heuristic";
}

export interface OpenClawRepositorySnapshot {
  generatedAt: string;
  repositoryPath: string;
  resolvedRepositoryPath: string;
  repositoryExists: boolean;
  branch?: string;
  headSha?: string;
  repoStyle: OpenClawRepositoryStyle;
  packageManager: OpenClawPackageManager;
  stacks: string[];
  roots: OpenClawRepositoryRoot[];
  selectedRoot?: string;
  preferredCommands: Partial<
    Record<OpenClawPreferredCommandKind, OpenClawPreferredCommand>
  >;
  ciWorkflows: string[];
  deployWorkflows: string[];
  sensitivePaths: string[];
  openClawSignals: string[];
}
