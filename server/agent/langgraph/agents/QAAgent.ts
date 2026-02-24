import { z } from "zod";
import OpenAI from "openai";
import { BaseAgent, BaseAgentConfig, AgentTask, AgentResult, AgentCapability } from "./types";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export class QAAgent extends BaseAgent {
  constructor() {
    const config: BaseAgentConfig = {
      name: "QAAgent",
      description: "Specialized agent for quality assurance, testing, validation, and verification. Expert at identifying issues and ensuring quality standards.",
      model: DEFAULT_MODEL,
      temperature: 0.1,
      maxTokens: 8192,
      systemPrompt: `You are the QAAgent - an expert quality assurance engineer.

Your capabilities:
1. Test Case Generation: Create comprehensive test cases from requirements
2. Test Execution: Plan and execute testing strategies
3. Bug Identification: Find defects and edge cases
4. Validation: Verify outputs against specifications
5. Performance Testing: Identify bottlenecks and issues
6. Accessibility Testing: Ensure WCAG compliance

Testing methodology:
- Requirements-based testing
- Boundary value analysis
- Equivalence partitioning
- Error guessing
- Exploratory testing
- Regression testing

Quality metrics:
- Code coverage
- Defect density
- Test pass rate
- Performance benchmarks
- Accessibility scores

Output formats:
- Test cases in structured format
- Bug reports with reproduction steps
- Test execution reports
- Quality dashboards`,
      tools: ["code_test", "code_review", "verify", "health_check"],
      timeout: 180000,
      maxIterations: 25,
    };
    super(config);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    this.updateState({ status: "running", currentTask: task.description, startedAt: new Date().toISOString() });

    try {
      const qaTaskType = this.determineQATaskType(task);
      let result: any;

      switch (qaTaskType) {
        case "generate_tests":
          result = await this.generateTestCases(task);
          break;
        case "validate":
          result = await this.validateOutput(task);
          break;
        case "bug_hunt":
          result = await this.huntBugs(task);
          break;
        case "performance":
          result = await this.performanceTest(task);
          break;
        case "accessibility":
          result = await this.accessibilityTest(task);
          break;
        default:
          result = await this.handleGeneralQA(task);
      }

      this.updateState({ status: "completed", progress: 100, completedAt: new Date().toISOString() });

      return {
        taskId: task.id,
        agentId: this.state.id,
        success: true,
        output: result,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      this.updateState({ status: "failed", error: error.message });
      return {
        taskId: task.id,
        agentId: this.state.id,
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  private determineQATaskType(task: AgentTask): string {
    const description = task.description.toLowerCase();
    if (description.includes("test case") || description.includes("generate test")) return "generate_tests";
    if (description.includes("validate") || description.includes("verify")) return "validate";
    if (description.includes("bug") || description.includes("defect") || description.includes("issue")) return "bug_hunt";
    if (description.includes("performance") || description.includes("load") || description.includes("stress")) return "performance";
    if (description.includes("accessibility") || description.includes("a11y") || description.includes("wcag")) return "accessibility";
    return "general";
  }

  private async generateTestCases(task: AgentTask): Promise<any> {
    const requirements = task.input.requirements || task.description;
    const testType = task.input.testType || "functional";

    const messages: any[] = [
      { role: "system", content: this.config.systemPrompt },
      {
        role: "user",
        content: `Generate ${testType} test cases for:\n${requirements}\n\nAdditional context: ${JSON.stringify(task.input)}\n\nReturn JSON:\n{\n  "testSuite": {\n    "name": "test suite name",\n    "description": "what is being tested",\n    "testCases": [\n      {\n        "id": "TC001",\n        "name": "test case name",\n        "description": "what is tested",\n        "preconditions": ["setup required"],\n        "steps": [{"step": 1, "action": "", "expectedResult": ""}],\n        "priority": "high|medium|low",\n        "type": "positive|negative|edge"\n      }\n    ]\n  },\n  "coverage": {\n    "requirements": ["covered requirements"],\n    "gaps": ["areas not covered"]\n  },\n  "estimatedDuration": "time to execute all tests"\n}`,
      },
    ];

    let content = "";
    let isComplete = false;
    let iteration = 0;

    while (!isComplete && iteration < this.config.maxIterations) {
      iteration++;
      const response = await xaiClient.chat.completions.create({
        model: this.config.model,
        messages,
        temperature: 0.1,
        tools: [
          {
            type: "function",
            function: {
              name: "delegate_task",
              description: "Delegate a sub-task to a specialized agent.",
              parameters: {
                type: "object",
                properties: {
                  targetAgentName: { type: "string" },
                  subTaskDescription: { type: "string" },
                  inputData: { type: "object" }
                },
                required: ["targetAgentName", "subTaskDescription"]
              }
            }
          }
        ],
        tool_choice: "auto",
      });

      const message = response.choices[0].message;
      messages.push(message);

      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          if (toolCall.type === "function" && toolCall.function?.name === "delegate_task") {
            const args = JSON.parse(toolCall.function.arguments);
            try {
              const result = await this.delegateTask(args.targetAgentName, args.subTaskDescription, args.inputData || {});
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(result.output)
              });
            } catch (err: any) {
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `Error delegating task: ${err.message}`
              });
            }
          }
        }
      } else {
        content = message.content || "{}";
        isComplete = true;
      }
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "test_generation",
      testCases: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async validateOutput(task: AgentTask): Promise<any> {
    const actual = task.input.actual || "";
    const expected = task.input.expected || "";
    const criteria = task.input.criteria || [];

    const messages: any[] = [
      { role: "system", content: this.config.systemPrompt },
      {
        role: "user",
        content: `Validate output against specification:\nActual: ${JSON.stringify(actual)}\nExpected: ${JSON.stringify(expected)}\nCriteria: ${JSON.stringify(criteria)}\nTask: ${task.description}\n\nReturn JSON:\n{\n  "valid": boolean,\n  "score": 0-100,\n  "checks": [\n    {"criterion": "", "passed": boolean, "details": "", "severity": "low|medium|high"}\n  ],\n  "discrepancies": ["list of differences"],\n  "recommendations": ["suggestions for improvement"]\n}`,
      },
    ];

    let content = "";
    let isComplete = false;
    let iteration = 0;

    while (!isComplete && iteration < this.config.maxIterations) {
      iteration++;
      const response = await xaiClient.chat.completions.create({
        model: this.config.model,
        messages,
        temperature: 0.1,
        tools: [
          {
            type: "function",
            function: {
              name: "delegate_task",
              description: "Delegate a sub-task to a specialized agent.",
              parameters: {
                type: "object",
                properties: {
                  targetAgentName: { type: "string" },
                  subTaskDescription: { type: "string" },
                  inputData: { type: "object" }
                },
                required: ["targetAgentName", "subTaskDescription"]
              }
            }
          }
        ],
        tool_choice: "auto",
      });

      const message = response.choices[0].message;
      messages.push(message);

      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          if (toolCall.type === "function" && toolCall.function?.name === "delegate_task") {
            const args = JSON.parse(toolCall.function.arguments);
            try {
              const result = await this.delegateTask(args.targetAgentName, args.subTaskDescription, args.inputData || {});
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(result.output)
              });
            } catch (err: any) {
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `Error delegating task: ${err.message}`
              });
            }
          }
        }
      } else {
        content = message.content || "{}";
        isComplete = true;
      }
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "validation",
      validation: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async huntBugs(task: AgentTask): Promise<any> {
    const code = task.input.code || "";
    const context = task.input.context || "";

    const messages: any[] = [
      { role: "system", content: this.config.systemPrompt },
      {
        role: "user",
        content: `Find bugs and issues in:\n\`\`\`\n${code}\n\`\`\`\n\nContext: ${context}\nTask: ${task.description}\n\nReturn JSON:\n{\n  "bugs": [\n    {\n      "id": "BUG001",\n      "severity": "critical|high|medium|low",\n      "type": "logic|security|performance|ux",\n      "location": "file:line",\n      "description": "what's wrong",\n      "reproductionSteps": ["how to reproduce"],\n      "suggestedFix": "how to fix",\n      "confidence": 0-100\n    }\n  ],\n  "codeSmells": ["potential issues"],\n  "edgeCases": ["unhandled scenarios"],\n  "overallRisk": "low|medium|high"\n}`,
      },
    ];

    let content = "";
    let isComplete = false;
    let iteration = 0;

    while (!isComplete && iteration < this.config.maxIterations) {
      iteration++;
      const response = await xaiClient.chat.completions.create({
        model: this.config.model,
        messages,
        temperature: 0.1,
        tools: [
          {
            type: "function",
            function: {
              name: "delegate_task",
              description: "Delegate a sub-task to a specialized agent.",
              parameters: {
                type: "object",
                properties: {
                  targetAgentName: { type: "string" },
                  subTaskDescription: { type: "string" },
                  inputData: { type: "object" }
                },
                required: ["targetAgentName", "subTaskDescription"]
              }
            }
          }
        ],
        tool_choice: "auto",
      });

      const message = response.choices[0].message;
      messages.push(message);

      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          if (toolCall.type === "function" && toolCall.function?.name === "delegate_task") {
            const args = JSON.parse(toolCall.function.arguments);
            try {
              const result = await this.delegateTask(args.targetAgentName, args.subTaskDescription, args.inputData || {});
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(result.output)
              });
            } catch (err: any) {
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `Error delegating task: ${err.message}`
              });
            }
          }
        }
      } else {
        content = message.content || "{}";
        isComplete = true;
      }
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "bug_hunting",
      findings: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async performanceTest(task: AgentTask): Promise<any> {
    const target = task.input.target || "";
    const metrics = task.input.metrics || ["response_time", "throughput", "memory"];

    const messages: any[] = [
      { role: "system", content: this.config.systemPrompt },
      {
        role: "user",
        content: `Create performance test plan for:\nTarget: ${target}\nMetrics: ${JSON.stringify(metrics)}\nTask: ${task.description}\n\nReturn JSON:\n{\n  "testPlan": {\n    "scenarios": [\n      {\n        "name": "scenario name",\n        "load": "concurrent users/requests",\n        "duration": "test duration",\n        "rampUp": "ramp up time"\n      }\n    ],\n    "metrics": ["metrics to measure"],\n    "thresholds": {"response_time": "< 200ms", "error_rate": "< 1%"}\n  },\n  "tools": ["recommended tools"],\n  "code": {\n    "k6": "k6 script",\n    "artillery": "artillery config"\n  }\n}`,
      },
    ];

    let content = "";
    let isComplete = false;
    let iteration = 0;

    while (!isComplete && iteration < this.config.maxIterations) {
      iteration++;
      const response = await xaiClient.chat.completions.create({
        model: this.config.model,
        messages,
        temperature: 0.1,
        tools: [
          {
            type: "function",
            function: {
              name: "delegate_task",
              description: "Delegate a sub-task to a specialized agent.",
              parameters: {
                type: "object",
                properties: {
                  targetAgentName: { type: "string" },
                  subTaskDescription: { type: "string" },
                  inputData: { type: "object" }
                },
                required: ["targetAgentName", "subTaskDescription"]
              }
            }
          }
        ],
        tool_choice: "auto",
      });

      const message = response.choices[0].message;
      messages.push(message);

      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          if (toolCall.type === "function" && toolCall.function?.name === "delegate_task") {
            const args = JSON.parse(toolCall.function.arguments);
            try {
              const result = await this.delegateTask(args.targetAgentName, args.subTaskDescription, args.inputData || {});
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(result.output)
              });
            } catch (err: any) {
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `Error delegating task: ${err.message}`
              });
            }
          }
        }
      } else {
        content = message.content || "{}";
        isComplete = true;
      }
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "performance_testing",
      testPlan: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async accessibilityTest(task: AgentTask): Promise<any> {
    const target = task.input.target || task.description;
    const standard = task.input.standard || "WCAG 2.1 AA";

    const messages: any[] = [
      { role: "system", content: this.config.systemPrompt },
      {
        role: "user",
        content: `Create accessibility test checklist for:\nTarget: ${target}\nStandard: ${standard}\nTask: ${task.description}\n\nReturn JSON:\n{\n  "checklist": [\n    {\n      "criterion": "WCAG criterion",\n      "level": "A|AA|AAA",\n      "category": "perceivable|operable|understandable|robust",\n      "testMethod": "how to test",\n      "automatable": boolean\n    }\n  ],\n  "tools": ["recommended a11y tools"],\n  "commonIssues": ["likely accessibility issues to check"]\n}`,
      },
    ];

    let content = "";
    let isComplete = false;
    let iteration = 0;

    while (!isComplete && iteration < this.config.maxIterations) {
      iteration++;
      const response = await xaiClient.chat.completions.create({
        model: this.config.model,
        messages,
        temperature: 0.1,
        tools: [
          {
            type: "function",
            function: {
              name: "delegate_task",
              description: "Delegate a sub-task to a specialized agent.",
              parameters: {
                type: "object",
                properties: {
                  targetAgentName: { type: "string" },
                  subTaskDescription: { type: "string" },
                  inputData: { type: "object" }
                },
                required: ["targetAgentName", "subTaskDescription"]
              }
            }
          }
        ],
        tool_choice: "auto",
      });

      const message = response.choices[0].message;
      messages.push(message);

      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          if (toolCall.type === "function" && toolCall.function?.name === "delegate_task") {
            const args = JSON.parse(toolCall.function.arguments);
            try {
              const result = await this.delegateTask(args.targetAgentName, args.subTaskDescription, args.inputData || {});
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(result.output)
              });
            } catch (err: any) {
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `Error delegating task: ${err.message}`
              });
            }
          }
        }
      } else {
        content = message.content || "{}";
        isComplete = true;
      }
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "accessibility_testing",
      checklist: jsonMatch ? JSON.parse(jsonMatch[0]) : { description: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async handleGeneralQA(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        { role: "user", content: `QA task: ${task.description}\nInput: ${JSON.stringify(task.input)}` },
      ],
      temperature: 0.1,
    });

    return {
      type: "general_qa",
      result: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: "generate_tests",
        description: "Generate test cases from requirements",
        inputSchema: z.object({ requirements: z.string(), testType: z.string().optional() }),
        outputSchema: z.object({ testCases: z.array(z.any()), coverage: z.any() }),
      },
      {
        name: "validate",
        description: "Validate output against specifications",
        inputSchema: z.object({ actual: z.any(), expected: z.any() }),
        outputSchema: z.object({ valid: z.boolean(), discrepancies: z.array(z.string()) }),
      },
      {
        name: "find_bugs",
        description: "Identify bugs and issues in code",
        inputSchema: z.object({ code: z.string() }),
        outputSchema: z.object({ bugs: z.array(z.any()) }),
      },
    ];
  }
}

export const qaAgent = new QAAgent();
