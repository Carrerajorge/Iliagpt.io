import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import {
  getClaudeAgentBackbone,
  CLAUDE_MODELS,
  type AgentMessage,
} from "./ClaudeAgentBackbone.js";

const logger = pino({ name: "CodeAgent" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type CodeTask =
  | "write"
  | "debug"
  | "refactor"
  | "add_tests"
  | "security_review"
  | "explain"
  | "convert"
  | "document";

export type Language =
  | "typescript"
  | "javascript"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "csharp"
  | "cpp"
  | "sql"
  | "bash"
  | "other";

export interface CodeFile {
  path: string;
  content: string;
  language: Language;
}

export interface SecurityVulnerability {
  severity: "low" | "medium" | "high" | "critical";
  type: string;
  description: string;
  location?: string;
  fix: string;
  cweId?: string;
}

export interface TestCase {
  name: string;
  description: string;
  type: "unit" | "integration" | "e2e";
  code: string;
}

export interface CodeReviewResult {
  overallScore: number;
  summary: string;
  issues: Array<{
    severity: "info" | "warning" | "error";
    message: string;
    location?: string;
    suggestion: string;
  }>;
  positives: string[];
  securityVulnerabilities: SecurityVulnerability[];
  suggestedRefactoring: string[];
}

export interface CodeTaskResult {
  taskId: string;
  task: CodeTask;
  inputFiles: CodeFile[];
  outputFiles: CodeFile[];
  explanation: string;
  testsGenerated?: TestCase[];
  reviewResult?: CodeReviewResult;
  securityIssues?: SecurityVulnerability[];
  iterationCount: number;
  tokensUsed: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface GitOperation {
  type: "create_branch" | "commit" | "create_pr";
  branchName?: string;
  commitMessage?: string;
  prTitle?: string;
  prDescription?: string;
  files?: string[];
}

/** Safe code executor interface — implementations use execFile (not exec) to prevent injection */
export type SafeCodeExecutor = (
  code: string,
  language: Language
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

// ─── Language helpers ─────────────────────────────────────────────────────────

function langToExt(lang: Language): string {
  const map: Record<Language, string> = {
    typescript: "ts", javascript: "js", python: "py",
    rust: "rs", go: "go", java: "java", csharp: "cs",
    cpp: "cpp", sql: "sql", bash: "sh", other: "txt",
  };
  return map[lang] ?? "txt";
}

// ─── CodeAgent ────────────────────────────────────────────────────────────────

export class CodeAgent extends EventEmitter {
  private taskHistory: CodeTaskResult[] = [];

  constructor(
    private readonly backbone = getClaudeAgentBackbone(),
    private readonly codeExecutor?: SafeCodeExecutor
  ) {
    super();
    logger.info("[CodeAgent] Initialized");
  }

  // ── Write code ────────────────────────────────────────────────────────────────

  async write(
    description: string,
    language: Language,
    context?: {
      projectStructure?: string;
      existingFiles?: CodeFile[];
      requirements?: string[];
    }
  ): Promise<CodeTaskResult> {
    const taskId = randomUUID();
    const startedAt = Date.now();

    logger.info({ taskId, language, description: description.slice(0, 60) }, "[CodeAgent] Writing code");
    this.emit("task:started", { taskId, task: "write" });

    const contextBlock = context
      ? [
          context.projectStructure ? `PROJECT STRUCTURE:\n${context.projectStructure}` : "",
          (context.existingFiles ?? []).length > 0
            ? `EXISTING CODE:\n${(context.existingFiles ?? [])
                .map((f) => `\`\`\`${f.language}\n// ${f.path}\n${f.content.slice(0, 500)}\n\`\`\``)
                .join("\n\n")}`
            : "",
          (context.requirements ?? []).length > 0
            ? `REQUIREMENTS:\n${(context.requirements ?? []).map((r) => `- ${r}`).join("\n")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n")
      : "";

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Write production-quality ${language} code for this requirement.

DESCRIPTION: ${description}
${contextBlock}

Rules:
- Write complete, working code (no placeholders)
- Follow ${language} best practices and conventions
- Add appropriate error handling
- Include JSDoc/docstrings for public APIs
- Make the code testable

Output your code in a fenced code block.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.SONNET,
      maxTokens: 4096,
      system: `You are an expert ${language} developer who writes clean, production-ready code.`,
    });

    const outputFiles = this.extractCodeBlocks(response.text, language);
    let iterationCount = 1;

    // Iterative refinement: if executor provided, test and fix
    if (this.codeExecutor && outputFiles.length > 0) {
      const mainFile = outputFiles[0];
      try {
        const execution = await this.codeExecutor(mainFile.content, language);
        if (execution.exitCode !== 0 && execution.stderr) {
          const fixed = await this.debugCode(mainFile.content, execution.stderr, language);
          if (fixed) {
            outputFiles[0] = { ...mainFile, content: fixed };
            iterationCount++;
          }
        }
      } catch {
        // Executor failed — proceed with unverified code
      }
    }

    const result = this.buildResult(
      taskId, "write", [], outputFiles, response.text,
      iterationCount, response.usage.inputTokens + response.usage.outputTokens, startedAt, true
    );

    this.taskHistory.push(result);
    this.emit("task:completed", result);
    return result;
  }

  // ── Debug code ────────────────────────────────────────────────────────────────

  async debug(
    code: string,
    error: string,
    language: Language,
    filePath = "unknown"
  ): Promise<CodeTaskResult> {
    const taskId = randomUUID();
    const startedAt = Date.now();

    logger.info({ taskId, language, error: error.slice(0, 80) }, "[CodeAgent] Debugging");

    const fixed = await this.debugCode(code, error, language);

    const inputFiles: CodeFile[] = [{ path: filePath, content: code, language }];
    const outputFiles: CodeFile[] = fixed ? [{ path: filePath, content: fixed, language }] : [];

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Explain the bug and fix in one paragraph.\n\nORIGINAL ERROR: ${error.slice(0, 300)}`,
      },
    ];

    const expResponse = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.HAIKU,
      maxTokens: 512,
      system: "Explain code bugs clearly.",
    });

    const result = this.buildResult(
      taskId, "debug", inputFiles, outputFiles, expResponse.text,
      1, 0, startedAt, !!fixed
    );
    this.taskHistory.push(result);
    this.emit("task:completed", result);
    return result;
  }

  private async debugCode(code: string, error: string, language: Language): Promise<string | null> {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Fix this ${language} code. Return ONLY the fixed code in a fenced code block.

ERROR:\n${error.slice(0, 500)}

CODE:
\`\`\`${language}
${code.slice(0, 3000)}
\`\`\``,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.SONNET,
      maxTokens: 4096,
      system: `You are an expert ${language} debugger. Fix code errors precisely.`,
    });

    const blocks = this.extractCodeBlocks(response.text, language);
    return blocks[0]?.content ?? null;
  }

  // ── Refactor ──────────────────────────────────────────────────────────────────

  async refactor(
    files: CodeFile[],
    goal: "performance" | "readability" | "maintainability" | "modernize"
  ): Promise<CodeTaskResult> {
    const taskId = randomUUID();
    const startedAt = Date.now();

    const fileBlocks = files
      .map((f) => `\`\`\`${f.language}\n// ${f.path}\n${f.content}\n\`\`\``)
      .join("\n\n");

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Refactor this code for ${goal}. Return each file in a fenced code block with the path as a comment.

${fileBlocks}

Focus on ${goal}. Preserve all functionality. Explain key changes after the code.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.SONNET,
      maxTokens: 6000,
      system: "Expert code refactoring engineer. Improve quality while preserving behavior.",
    });

    const outputFiles = this.extractCodeBlocks(response.text, files[0]?.language ?? "other");
    const result = this.buildResult(
      taskId, "refactor", files, outputFiles, response.text,
      1, response.usage.inputTokens + response.usage.outputTokens, startedAt, true
    );
    this.taskHistory.push(result);
    return result;
  }

  // ── Add tests ─────────────────────────────────────────────────────────────────

  async addTests(file: CodeFile, framework?: string): Promise<CodeTaskResult> {
    const taskId = randomUUID();
    const startedAt = Date.now();

    const defaultFramework =
      file.language === "typescript" || file.language === "javascript"
        ? "vitest"
        : file.language === "python"
        ? "pytest"
        : "built-in";

    const fw = framework ?? defaultFramework;

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Generate comprehensive tests for this ${file.language} code using ${fw}.

CODE (${file.path}):
\`\`\`${file.language}
${file.content}
\`\`\`

Cover: happy path, edge cases, error conditions, async behavior. Output the test file.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.SONNET,
      maxTokens: 4096,
      system: `Expert at writing ${fw} tests for ${file.language} code.`,
    });

    const testFiles = this.extractCodeBlocks(response.text, file.language);
    const ext = langToExt(file.language);
    const testPath = file.path.replace(new RegExp(`\\.${ext}$`), `.test.${ext}`);
    if (testFiles[0]) testFiles[0].path = testPath;

    const result = this.buildResult(
      taskId, "add_tests", [file], testFiles, response.text,
      1, response.usage.inputTokens + response.usage.outputTokens, startedAt, true
    );
    this.taskHistory.push(result);
    return result;
  }

  // ── Security review ───────────────────────────────────────────────────────────

  async securityReview(files: CodeFile[]): Promise<CodeTaskResult> {
    const taskId = randomUUID();
    const startedAt = Date.now();

    const fileBlocks = files
      .map((f) => `\`\`\`${f.language}\n// ${f.path}\n${f.content.slice(0, 2000)}\n\`\`\``)
      .join("\n\n");

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Security review — find OWASP Top 10 and common vulnerabilities.

${fileBlocks}

Output JSON:
{
  "overallScore": 0-10,
  "summary": "brief",
  "vulnerabilities": [{"severity":"low|medium|high|critical","type":"...","description":"...","location":"file:line","fix":"...","cweId":"CWE-XX"}],
  "positives": [],
  "recommendations": []
}
Return ONLY valid JSON.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.OPUS,
      maxTokens: 3000,
      system: "Senior application security engineer reviewing code for vulnerabilities.",
    });

    let reviewResult: CodeReviewResult | undefined;
    let securityIssues: SecurityVulnerability[] = [];

    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          overallScore?: number;
          summary?: string;
          vulnerabilities?: Array<{
            severity?: string;
            type?: string;
            description?: string;
            location?: string;
            fix?: string;
            cweId?: string;
          }>;
          positives?: string[];
          recommendations?: string[];
        };

        securityIssues = (parsed.vulnerabilities ?? []).map((v) => ({
          severity: (v.severity ?? "medium") as SecurityVulnerability["severity"],
          type: v.type ?? "Unknown",
          description: v.description ?? "",
          location: v.location,
          fix: v.fix ?? "",
          cweId: v.cweId,
        }));

        reviewResult = {
          overallScore: parsed.overallScore ?? 5,
          summary: parsed.summary ?? "",
          issues: securityIssues.map((v) => ({
            severity: (v.severity === "critical" || v.severity === "high") ? "error" as const : "warning" as const,
            message: `${v.type}: ${v.description}`,
            location: v.location,
            suggestion: v.fix,
          })),
          positives: parsed.positives ?? [],
          securityVulnerabilities: securityIssues,
          suggestedRefactoring: parsed.recommendations ?? [],
        };
      }
    } catch {
      // Use raw response
    }

    const result = this.buildResult(
      taskId, "security_review", files, [], response.text,
      1, response.usage.inputTokens + response.usage.outputTokens, startedAt, true
    );
    result.reviewResult = reviewResult;
    result.securityIssues = securityIssues;

    const criticalCount = securityIssues.filter((v) => v.severity === "critical").length;
    if (criticalCount > 0) {
      logger.warn({ taskId, criticalCount }, "[CodeAgent] Critical security issues found");
      this.emit("security:critical_issues", { taskId, count: criticalCount });
    }

    this.taskHistory.push(result);
    return result;
  }

  // ── Explain code ──────────────────────────────────────────────────────────────

  async explain(
    file: CodeFile,
    audienceLevel: "beginner" | "intermediate" | "expert" = "intermediate"
  ): Promise<CodeTaskResult> {
    const taskId = randomUUID();
    const startedAt = Date.now();

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Explain this ${file.language} code for a ${audienceLevel} developer.

\`\`\`${file.language}
${file.content}
\`\`\`

Cover: what it does, how it works, key patterns, non-obvious parts.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.SONNET,
      maxTokens: 2048,
      system: `Explain ${file.language} code for ${audienceLevel} developers.`,
    });

    const result = this.buildResult(
      taskId, "explain", [file], [], response.text,
      1, response.usage.inputTokens + response.usage.outputTokens, startedAt, true
    );
    this.taskHistory.push(result);
    return result;
  }

  // ── Convert language ──────────────────────────────────────────────────────────

  async convert(file: CodeFile, targetLanguage: Language): Promise<CodeTaskResult> {
    const taskId = randomUUID();
    const startedAt = Date.now();

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Convert this ${file.language} code to idiomatic ${targetLanguage}.

\`\`\`${file.language}
${file.content}
\`\`\`

Use ${targetLanguage} idioms (not literal translation). Follow naming conventions. Preserve all functionality.

Output in a fenced \`\`\`${targetLanguage} block.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.SONNET,
      maxTokens: 4096,
      system: "Convert code between programming languages idiomatically.",
    });

    const outputFiles = this.extractCodeBlocks(response.text, targetLanguage);
    const result = this.buildResult(
      taskId, "convert", [file], outputFiles, response.text,
      1, response.usage.inputTokens + response.usage.outputTokens, startedAt, outputFiles.length > 0
    );
    this.taskHistory.push(result);
    return result;
  }

  // ── Generate documentation ────────────────────────────────────────────────────

  async document(files: CodeFile[]): Promise<CodeTaskResult> {
    const taskId = randomUUID();
    const startedAt = Date.now();

    const fileBlocks = files
      .map((f) => `\`\`\`${f.language}\n// ${f.path}\n${f.content.slice(0, 2000)}\n\`\`\``)
      .join("\n\n");

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Generate comprehensive documentation for this codebase.

${fileBlocks}

Create: overview, API docs for public functions/classes, usage examples, architecture notes. Output Markdown.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.SONNET,
      maxTokens: 4096,
      system: "Write clear, comprehensive technical documentation.",
    });

    const docFile: CodeFile = { path: "DOCUMENTATION.md", content: response.text, language: "other" };
    const result = this.buildResult(
      taskId, "document", files, [docFile], response.text,
      1, response.usage.inputTokens + response.usage.outputTokens, startedAt, true
    );
    this.taskHistory.push(result);
    return result;
  }

  // ── Git suggestion ────────────────────────────────────────────────────────────

  suggestGitOperation(taskResult: CodeTaskResult): GitOperation {
    const prefixMap: Record<CodeTask, string> = {
      write: "feat", debug: "fix", refactor: "refactor",
      add_tests: "test", security_review: "security",
      explain: "docs", convert: "chore", document: "docs",
    };

    return {
      type: "commit",
      branchName: `${prefixMap[taskResult.task]}/agent-${taskResult.taskId.slice(0, 8)}`,
      commitMessage: `${prefixMap[taskResult.task]}: ${taskResult.explanation.slice(0, 72)}`,
      files: taskResult.outputFiles.map((f) => f.path),
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private extractCodeBlocks(text: string, defaultLang: Language): CodeFile[] {
    const blocks: CodeFile[] = [];
    const regex = /```(\w+)?\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = regex.exec(text)) !== null) {
      const lang = (match[1] ?? defaultLang) as Language;
      const content = match[2].trim();
      const pathMatch = content.match(/^\/\/\s*(.+\.\w+)/);
      const path = pathMatch ? pathMatch[1] : `output_${index}.${langToExt(lang)}`;
      blocks.push({ path, content, language: lang });
      index++;
    }

    return blocks;
  }

  private buildResult(
    taskId: string,
    task: CodeTask,
    inputFiles: CodeFile[],
    outputFiles: CodeFile[],
    explanation: string,
    iterationCount: number,
    tokensUsed: number,
    startedAt: number,
    success: boolean
  ): CodeTaskResult {
    return {
      taskId, task, inputFiles, outputFiles,
      explanation, iterationCount, tokensUsed,
      durationMs: Date.now() - startedAt, success,
    };
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getTaskHistory(limit = 20): CodeTaskResult[] {
    return this.taskHistory.slice(-limit).reverse();
  }

  getStats() {
    const byTask = new Map<CodeTask, number>();
    for (const r of this.taskHistory) {
      byTask.set(r.task, (byTask.get(r.task) ?? 0) + 1);
    }
    return {
      totalTasks: this.taskHistory.length,
      successRate: this.taskHistory.length > 0
        ? this.taskHistory.filter((r) => r.success).length / this.taskHistory.length
        : 0,
      byTask: Object.fromEntries(byTask.entries()),
      avgDurationMs:
        this.taskHistory.length > 0
          ? this.taskHistory.reduce((s, r) => s + r.durationMs, 0) / this.taskHistory.length
          : 0,
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: CodeAgent | null = null;

export function getCodeAgent(executor?: SafeCodeExecutor): CodeAgent {
  if (!_instance) _instance = new CodeAgent(undefined, executor);
  return _instance;
}
