/**
 * UniversalToolCaller
 *
 * Translates tool definitions and tool call results between our canonical format
 * and the wire formats used by each LLM provider:
 *
 *   Anthropic  — tools array with input_schema, response: content[].type=="tool_use"
 *   OpenAI     — tools array with function + json_schema, response: tool_calls[]
 *   Gemini     — functionDeclarations in Tool, response: content.parts[].functionCall
 *
 * Also handles streaming tool-call assembly (deltas → complete call).
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI    from 'openai';
import { Logger } from '../../lib/logger';
import type { ToolDefinition, ToolResult } from './ToolRegistry';

// ─── Provider enum ────────────────────────────────────────────────────────────

export type ProviderName = 'anthropic' | 'openai' | 'gemini' | 'generic';

// ─── Canonical parsed tool call ───────────────────────────────────────────────

export interface ParsedToolCall {
  callId  : string;
  toolName: string;
  input   : unknown;
}

// ─── Canonical message types for the agentic loop ─────────────────────────────

export type AgentMessage =
  | { role: 'system';    content: string }
  | { role: 'user';      content: string | AgentContentPart[] }
  | { role: 'assistant'; content: string; tool_calls?: ParsedToolCall[] }
  | { role: 'tool';      callId: string; toolName: string; result: ToolResult };

export type AgentContentPart =
  | { type: 'text';  text: string }
  | { type: 'image'; url: string; mimeType?: string };

// ─── Zod-to-JSON-Schema helper ────────────────────────────────────────────────

function paramToJsonSchema(params: ToolDefinition['parameters']): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const p of params) {
    const prop: Record<string, unknown> = { description: p.description };
    switch (p.type) {
      case 'string' : prop['type'] = 'string';  break;
      case 'number' : prop['type'] = 'number';  break;
      case 'boolean': prop['type'] = 'boolean'; break;
      case 'object' : prop['type'] = 'object';  break;
      case 'array'  : prop['type'] = 'array';   break;
    }
    if (p.enum) prop['enum'] = p.enum;
    properties[p.name] = prop;
    if (p.required) required.push(p.name);
  }

  return { type: 'object', properties, required };
}

// ─── Anthropic format ─────────────────────────────────────────────────────────

export type AnthropicTool = Anthropic.Tool;
export type AnthropicMessage = Anthropic.MessageParam;

function toAnthropicTools(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map(t => ({
    name        : t.name,
    description : t.description,
    input_schema: paramToJsonSchema(t.parameters) as Anthropic.Tool['input_schema'],
  }));
}

function fromAnthropicResponse(
  response: Anthropic.Message,
): { text: string; toolCalls: ParsedToolCall[]; stopReason: string } {
  let text = '';
  const toolCalls: ParsedToolCall[] = [];

  for (const block of response.content) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        callId  : block.id,
        toolName: block.name,
        input   : block.input,
      });
    }
  }

  return { text, toolCalls, stopReason: response.stop_reason ?? 'end_turn' };
}

function toAnthropicMessages(messages: AgentMessage[]): {
  system?: string;
  messages: AnthropicMessage[];
} {
  let system: string | undefined;
  const out: AnthropicMessage[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      system = m.content;
      continue;
    }
    if (m.role === 'user') {
      const content = typeof m.content === 'string'
        ? m.content
        : m.content.map(p => p.type === 'text'
          ? { type: 'text' as const, text: p.text }
          : { type: 'image' as const, source: { type: 'url' as const, url: p.url } }
        );
      out.push({ role: 'user', content });
    } else if (m.role === 'assistant') {
      const content: Anthropic.ContentBlock[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          content.push({
            type : 'tool_use',
            id   : tc.callId,
            name : tc.toolName,
            input: tc.input as Record<string, unknown>,
          });
        }
      }
      out.push({ role: 'assistant', content });
    } else if (m.role === 'tool') {
      // Tool results go as user messages in Anthropic's model
      out.push({
        role   : 'user',
        content: [{
          type       : 'tool_result',
          tool_use_id: m.callId,
          content    : JSON.stringify(m.result.output ?? m.result.error),
          is_error   : !m.result.success,
        }],
      });
    }
  }

  return { system, messages: out };
}

// ─── OpenAI format ────────────────────────────────────────────────────────────

export type OpenAITool = OpenAI.ChatCompletionTool;
export type OpenAIMessage = OpenAI.ChatCompletionMessageParam;

function toOpenAITools(tools: ToolDefinition[]): OpenAITool[] {
  return tools.map(t => ({
    type    : 'function' as const,
    function: {
      name       : t.name,
      description: t.description,
      parameters : paramToJsonSchema(t.parameters),
    },
  }));
}

function fromOpenAIResponse(
  choice: OpenAI.ChatCompletion.Choice,
): { text: string; toolCalls: ParsedToolCall[]; stopReason: string } {
  const msg = choice.message;
  const text = msg.content ?? '';
  const toolCalls: ParsedToolCall[] = (msg.tool_calls ?? []).map(tc => ({
    callId  : tc.id,
    toolName: tc.function.name,
    input   : (() => {
      try { return JSON.parse(tc.function.arguments); }
      catch { return { _raw: tc.function.arguments }; }
    })(),
  }));
  return { text, toolCalls, stopReason: choice.finish_reason ?? 'stop' };
}

function toOpenAIMessages(messages: AgentMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: m.content });
    } else if (m.role === 'user') {
      out.push({
        role   : 'user',
        content: typeof m.content === 'string'
          ? m.content
          : m.content.map(p => p.type === 'text'
            ? { type: 'text' as const, text: p.text }
            : { type: 'image_url' as const, image_url: { url: p.url } }
          ),
      });
    } else if (m.role === 'assistant') {
      const aMsg: OpenAI.ChatCompletionAssistantMessageParam = { role: 'assistant', content: m.content || null };
      if (m.tool_calls?.length) {
        aMsg.tool_calls = m.tool_calls.map(tc => ({
          id      : tc.callId,
          type    : 'function' as const,
          function: { name: tc.toolName, arguments: JSON.stringify(tc.input) },
        }));
      }
      out.push(aMsg);
    } else if (m.role === 'tool') {
      out.push({
        role        : 'tool',
        tool_call_id: m.callId,
        content     : JSON.stringify(m.result.output ?? m.result.error),
      });
    }
  }

  return out;
}

// ─── Gemini format ────────────────────────────────────────────────────────────
// Using generic fetch since @google/genai types vary between SDK versions

interface GeminiFunctionDeclaration {
  name       : string;
  description: string;
  parameters : Record<string, unknown>;
}

interface GeminiTool { functionDeclarations: GeminiFunctionDeclaration[] }

function toGeminiTools(tools: ToolDefinition[]): GeminiTool[] {
  return [{
    functionDeclarations: tools.map(t => ({
      name       : t.name,
      description: t.description,
      parameters : paramToJsonSchema(t.parameters),
    })),
  }];
}

function fromGeminiResponse(response: unknown): {
  text: string; toolCalls: ParsedToolCall[]; stopReason: string
} {
  const resp = response as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args: unknown } }> }; finishReason?: string }> };
  let text = '';
  const toolCalls: ParsedToolCall[] = [];

  for (const candidate of resp.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.text) text += part.text;
      if (part.functionCall) {
        toolCalls.push({
          callId  : `gc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          toolName: part.functionCall.name,
          input   : part.functionCall.args,
        });
      }
    }
  }

  const stopReason = resp.candidates?.[0]?.finishReason ?? 'STOP';
  return { text, toolCalls, stopReason };
}

// ─── Streaming tool-call assembler (OpenAI delta format) ─────────────────────

export interface ToolCallDelta {
  index    : number;
  id?      : string;
  name?    : string;
  argsDelta: string;
}

export class StreamingToolCallAssembler {
  private calls: Map<number, { id: string; name: string; argsRaw: string }> = new Map();

  push(delta: ToolCallDelta): void {
    const existing = this.calls.get(delta.index);
    if (existing) {
      existing.argsRaw += delta.argsDelta;
    } else {
      this.calls.set(delta.index, {
        id     : delta.id ?? `tc-${delta.index}`,
        name   : delta.name ?? '',
        argsRaw: delta.argsDelta,
      });
    }
  }

  flush(): ParsedToolCall[] {
    const result: ParsedToolCall[] = [];
    for (const [, call] of this.calls) {
      let input: unknown;
      try { input = JSON.parse(call.argsRaw); }
      catch { input = { _raw: call.argsRaw }; }
      result.push({ callId: call.id, toolName: call.name, input });
    }
    this.calls.clear();
    return result;
  }
}

// ─── Main class ───────────────────────────────────────────────────────────────

export class UniversalToolCaller {
  // ── Format conversion ──────────────────────────────────────────────────────

  toProviderTools(tools: ToolDefinition[], provider: ProviderName): unknown {
    switch (provider) {
      case 'anthropic': return toAnthropicTools(tools);
      case 'openai'   : return toOpenAITools(tools);
      case 'gemini'   : return toGeminiTools(tools);
      default:
        // Generic: return OpenAI format as a lingua franca
        return toOpenAITools(tools);
    }
  }

  toProviderMessages(messages: AgentMessage[], provider: ProviderName): unknown {
    switch (provider) {
      case 'anthropic': return toAnthropicMessages(messages);
      case 'openai'   :
      case 'generic'  : return toOpenAIMessages(messages);
      case 'gemini'   : {
        // Convert to Gemini content array — simplified
        const oai = toOpenAIMessages(messages);
        return oai.map(m => ({
          role : m.role === 'assistant' ? 'model' : m.role,
          parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
        }));
      }
    }
  }

  parseResponse(
    response: unknown,
    provider: ProviderName,
  ): { text: string; toolCalls: ParsedToolCall[]; stopReason: string } {
    switch (provider) {
      case 'anthropic': return fromAnthropicResponse(response as Anthropic.Message);
      case 'openai'   :
      case 'generic'  : {
        const r = response as OpenAI.ChatCompletion;
        return fromOpenAIResponse(r.choices[0]!);
      }
      case 'gemini'   : return fromGeminiResponse(response);
    }
  }

  /** Build a tool result message to feed back into the conversation. */
  buildToolResultMessage(
    callId  : string,
    toolName: string,
    result  : ToolResult,
  ): AgentMessage {
    return { role: 'tool', callId, toolName, result };
  }

  /** Detect which provider to use based on model string. */
  detectProvider(model: string): ProviderName {
    if (/^claude/i.test(model)) return 'anthropic';
    if (/^gpt|^o[1-9]|^ft:/i.test(model)) return 'openai';
    if (/^gemini/i.test(model)) return 'gemini';
    return 'openai'; // default to OpenAI-compat format
  }

  /** Format tool results as a readable string for injection into a text prompt. */
  formatResultsForPrompt(results: Array<{ name: string; result: ToolResult }>): string {
    return results.map(({ name, result }) => {
      const status = result.success ? '✓' : '✗';
      const output = result.success
        ? JSON.stringify(result.output, null, 2)
        : `Error (${result.error?.code}): ${result.error?.message}`;
      return `[Tool: ${name}] ${status}\n${output}`;
    }).join('\n\n');
  }
}

export const universalToolCaller = new UniversalToolCaller();
