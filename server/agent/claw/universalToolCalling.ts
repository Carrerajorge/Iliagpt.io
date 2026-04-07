import { z } from "zod";

export type Provider = "anthropic" | "openai" | "gemini" | "generic";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodSchema | Record<string, unknown>;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

function zodToJsonSchema(schema: z.ZodSchema | Record<string, unknown>): Record<string, unknown> {
  if (schema instanceof z.ZodType) {
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape as Record<string, z.ZodTypeAny>;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, val] of Object.entries(shape)) {
        properties[key] = { type: "string", description: (val as any)._def?.description ?? "" };
        if (!val.isOptional()) required.push(key);
      }
      return { type: "object", properties, required };
    }
    return { type: "object", properties: {} };
  }
  return schema;
}

function generateId(): string {
  return `tc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class UniversalToolAdapter {
  /**
   * Convert tool definitions to the format expected by a specific LLM provider.
   */
  formatToolsForProvider(tools: ToolDef[], provider: Provider): unknown {
    switch (provider) {
      case "anthropic":
        return tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: zodToJsonSchema(t.inputSchema),
        }));

      case "openai":
        return tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: zodToJsonSchema(t.inputSchema),
          },
        }));

      case "gemini":
        return [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: zodToJsonSchema(t.inputSchema),
            })),
          },
        ];

      case "generic":
        return this.buildGenericSystemPrompt(tools);
    }
  }

  /**
   * Extract tool calls from a provider-specific response object.
   */
  parseToolCallsFromResponse(response: any, provider: Provider): ParsedToolCall[] {
    switch (provider) {
      case "anthropic":
        return this.parseAnthropic(response);
      case "openai":
        return this.parseOpenAI(response);
      case "gemini":
        return this.parseGemini(response);
      case "generic":
        return this.parseToolCallsFromText(
          typeof response === "string" ? response : response?.text ?? response?.content ?? ""
        );
    }
  }

  /**
   * Parse tool calls from plain text (for models without native tool calling).
   * Looks for: <tool_call name="..." input='{"key": "value"}' />
   */
  parseToolCallsFromText(text: string): ParsedToolCall[] {
    const calls: ParsedToolCall[] = [];
    const regex = /<tool_call\s+name=["']([^"']+)["']\s+input=["'](.+?)["']\s*\/>/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      try {
        const input = JSON.parse(match[2]);
        calls.push({ id: generateId(), name: match[1], input });
      } catch {
        calls.push({ id: generateId(), name: match[1], input: { _raw: match[2] } });
      }
    }
    return calls;
  }

  // --- Private helpers ---

  private buildGenericSystemPrompt(tools: ToolDef[]): string {
    const toolBlocks = tools
      .map((t) => {
        const schema = zodToJsonSchema(t.inputSchema);
        return `<tool name="${t.name}" description="${t.description}">${JSON.stringify(schema.properties ?? {})}</tool>`;
      })
      .join("\n");

    return [
      "Available tools:",
      toolBlocks,
      "",
      'To use a tool, respond with: <tool_call name="tool_name" input=\'{"key": "value"}\' />',
    ].join("\n");
  }

  private parseAnthropic(response: any): ParsedToolCall[] {
    const content: any[] = response?.content ?? [];
    return content
      .filter((block: any) => block.type === "tool_use")
      .map((block: any) => ({
        id: block.id ?? generateId(),
        name: block.name,
        input: block.input ?? {},
      }));
  }

  private parseOpenAI(response: any): ParsedToolCall[] {
    const message = response?.choices?.[0]?.message;
    const toolCalls: any[] = message?.tool_calls ?? [];
    return toolCalls.map((tc: any) => {
      let input: Record<string, unknown> = {};
      try {
        input = typeof tc.function.arguments === "string"
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments;
      } catch {
        input = { _raw: tc.function.arguments };
      }
      return { id: tc.id ?? generateId(), name: tc.function.name, input };
    });
  }

  private parseGemini(response: any): ParsedToolCall[] {
    const parts: any[] =
      response?.candidates?.[0]?.content?.parts ?? [];
    return parts
      .filter((p: any) => p.functionCall)
      .map((p: any) => ({
        id: generateId(),
        name: p.functionCall.name,
        input: p.functionCall.args ?? {},
      }));
  }
}

export const universalToolAdapter = new UniversalToolAdapter();
