import { tool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export const codeGenerateTool = tool(
  async (input) => {
    const { description, language, framework, includeTests = false, includeDocumentation = true } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an expert software developer. Generate high-quality, production-ready code.

Guidelines:
1. Follow language best practices and conventions
2. Include proper error handling
3. Write clean, readable code with meaningful names
4. Add inline comments for complex logic
5. Consider edge cases and validation
6. Use modern syntax and patterns

Return JSON:
{
  "code": {
    "main": "the main code",
    "tests": "test code if requested",
    "types": "type definitions if applicable"
  },
  "language": "language used",
  "framework": "framework if any",
  "files": [
    {
      "name": "filename",
      "content": "file content",
      "description": "what this file does"
    }
  ],
  "dependencies": ["required packages"],
  "documentation": {
    "usage": "how to use",
    "api": "API documentation if applicable",
    "examples": ["usage examples"]
  },
  "complexity": {
    "timeComplexity": "O(n) etc",
    "spaceComplexity": "O(n) etc"
  }
}`,
          },
          {
            role: "user",
            content: `Generate code for:
Description: ${description}
Language: ${language}
${framework ? `Framework: ${framework}` : ""}
Include tests: ${includeTests}
Include documentation: ${includeDocumentation}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          language,
          framework,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        code: { main: content },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "code_generate",
    description: "Generates production-ready code with documentation, tests, and proper error handling.",
    schema: z.object({
      description: z.string().describe("What the code should do"),
      language: z.enum(["typescript", "javascript", "python", "go", "rust", "java", "c++", "c#", "php", "ruby", "swift", "kotlin"])
        .describe("Programming language"),
      framework: z.string().optional().describe("Framework to use (React, Express, Django, etc.)"),
      includeTests: z.boolean().optional().default(false).describe("Generate unit tests"),
      includeDocumentation: z.boolean().optional().default(true).describe("Include documentation"),
    }),
  }
);

export const codeReviewTool = tool(
  async (input) => {
    const { code, language, focus = ["all"] } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a senior code reviewer. Perform thorough code review.

Review areas:
- bugs: Logic errors, null references, race conditions
- security: Injection, XSS, auth issues, data exposure
- performance: Inefficient algorithms, memory leaks, N+1
- style: Naming, formatting, readability
- architecture: Design patterns, SOLID principles, coupling
- maintainability: Complexity, duplication, testability
- all: Complete review

Return JSON:
{
  "summary": "overall assessment",
  "score": {
    "overall": 1-10,
    "security": 1-10,
    "performance": 1-10,
    "maintainability": 1-10,
    "readability": 1-10
  },
  "issues": [
    {
      "severity": "critical|high|medium|low",
      "category": "bug|security|performance|style|architecture",
      "line": number,
      "description": "what's wrong",
      "suggestion": "how to fix",
      "code": "suggested fix code"
    }
  ],
  "positives": ["things done well"],
  "recommendations": ["improvement suggestions"],
  "securityFindings": [
    {
      "vulnerability": "type",
      "cwe": "CWE-XXX",
      "severity": "critical|high|medium|low",
      "remediation": "how to fix"
    }
  ],
  "codeSmells": ["detected code smells"],
  "suggestedRefactoring": ["refactoring opportunities"]
}`,
          },
          {
            role: "user",
            content: `Review this ${language} code:

\`\`\`${language}
${code}
\`\`\`

Focus areas: ${focus.join(", ")}`,
          },
        ],
        temperature: 0.2,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          language,
          focus,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        review: content,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "code_review",
    description: "Reviews code for bugs, security issues, performance problems, and style violations.",
    schema: z.object({
      code: z.string().describe("Code to review"),
      language: z.string().describe("Programming language"),
      focus: z.array(z.enum(["all", "bugs", "security", "performance", "style", "architecture", "maintainability"]))
        .optional().default(["all"]).describe("Review focus areas"),
    }),
  }
);

export const codeRefactorTool = tool(
  async (input) => {
    const { code, language, goals = ["readability"], preserveApi = true } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a refactoring expert. Improve code while preserving functionality.

Refactoring goals:
- readability: Clearer names, better structure, comments
- performance: Optimize algorithms, reduce complexity
- modularity: Extract functions, reduce coupling
- testability: Make code easier to test
- modern: Update to modern syntax/patterns
- dry: Remove duplication
- solid: Apply SOLID principles

Return JSON:
{
  "refactoredCode": "the improved code",
  "changes": [
    {
      "type": "rename|extract|inline|move|simplify|optimize",
      "description": "what was changed",
      "before": "original code snippet",
      "after": "refactored code snippet",
      "reason": "why this improves the code"
    }
  ],
  "metrics": {
    "linesBefore": number,
    "linesAfter": number,
    "complexityBefore": number,
    "complexityAfter": number,
    "functionsExtracted": number
  },
  "apiChanges": boolean,
  "breakingChanges": ["list if any"],
  "testingRecommendations": ["tests to add/update"]
}`,
          },
          {
            role: "user",
            content: `Refactor this ${language} code:

\`\`\`${language}
${code}
\`\`\`

Goals: ${goals.join(", ")}
Preserve API: ${preserveApi}`,
          },
        ],
        temperature: 0.3,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          language,
          goals,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        refactoredCode: content,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "code_refactor",
    description: "Refactors code for better readability, performance, modularity, or modern patterns while preserving functionality.",
    schema: z.object({
      code: z.string().describe("Code to refactor"),
      language: z.string().describe("Programming language"),
      goals: z.array(z.enum(["readability", "performance", "modularity", "testability", "modern", "dry", "solid"]))
        .optional().default(["readability"]).describe("Refactoring goals"),
      preserveApi: z.boolean().optional().default(true).describe("Keep public API unchanged"),
    }),
  }
);

export const codeTestTool = tool(
  async (input) => {
    const { code, language, framework = "auto", coverage = "unit" } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a testing expert. Generate comprehensive test suites.

Test types:
- unit: Function-level tests, mocking dependencies
- integration: Component interaction tests
- e2e: Full user flow tests

Return JSON:
{
  "testSuite": {
    "framework": "testing framework used",
    "tests": [
      {
        "name": "test name",
        "type": "unit|integration|e2e",
        "code": "test code",
        "description": "what it tests",
        "assertions": number
      }
    ],
    "setup": "setup code if needed",
    "teardown": "teardown code if needed",
    "mocks": [
      {
        "name": "mock name",
        "code": "mock implementation"
      }
    ]
  },
  "coverage": {
    "functions": ["functions covered"],
    "branches": ["branches covered"],
    "estimatedCoverage": "percentage"
  },
  "edgeCases": ["edge cases tested"],
  "runCommand": "command to run tests"
}`,
          },
          {
            role: "user",
            content: `Generate tests for this ${language} code:

\`\`\`${language}
${code}
\`\`\`

Framework: ${framework}
Coverage level: ${coverage}`,
          },
        ],
        temperature: 0.3,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          language,
          framework,
          coverage,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        testSuite: content,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "code_test",
    description: "Generates unit, integration, and e2e tests with mocks and coverage analysis.",
    schema: z.object({
      code: z.string().describe("Code to test"),
      language: z.string().describe("Programming language"),
      framework: z.string().optional().default("auto").describe("Test framework (jest, pytest, etc.)"),
      coverage: z.enum(["unit", "integration", "e2e", "full"]).optional().default("unit").describe("Coverage level"),
    }),
  }
);

export const codeDebugTool = tool(
  async (input) => {
    const { code, language, error, stackTrace } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a debugging expert. Analyze code errors and provide fixes.

Return JSON:
{
  "diagnosis": {
    "errorType": "type of error",
    "rootCause": "what's causing the error",
    "location": "where in the code",
    "explanation": "detailed explanation"
  },
  "fixes": [
    {
      "description": "what to fix",
      "code": "corrected code",
      "confidence": 0.0-1.0,
      "explanation": "why this fixes it"
    }
  ],
  "stackTraceAnalysis": {
    "entryPoint": "where error originated",
    "callChain": ["function call chain"],
    "relevantFrames": ["important stack frames"]
  },
  "prevention": ["how to prevent this in future"],
  "relatedIssues": ["similar issues to watch for"],
  "debuggingSteps": [
    {
      "step": 1,
      "action": "what to do",
      "expected": "what to look for"
    }
  ]
}`,
          },
          {
            role: "user",
            content: `Debug this ${language} code:

\`\`\`${language}
${code}
\`\`\`

Error: ${error}
${stackTrace ? `Stack trace:\n${stackTrace}` : ""}`,
          },
        ],
        temperature: 0.2,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          language,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        diagnosis: content,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "code_debug",
    description: "Analyzes code errors, stack traces, and provides fixes with detailed explanations.",
    schema: z.object({
      code: z.string().describe("Code with the bug"),
      language: z.string().describe("Programming language"),
      error: z.string().describe("Error message"),
      stackTrace: z.string().optional().describe("Stack trace if available"),
    }),
  }
);

export const DEVELOPMENT_TOOLS = [
  codeGenerateTool,
  codeReviewTool,
  codeRefactorTool,
  codeTestTool,
  codeDebugTool,
];
