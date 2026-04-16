import { describe, expect, it } from 'vitest';
import { parseGenericToolCallsFromText } from '../agentic/core/AgenticLoop';

describe('parseGenericToolCallsFromText', () => {
  it('parses a direct tool payload', () => {
    const calls = parseGenericToolCallsFromText(
      '{"tool":"read_file","input":{"path":"README.md"}}',
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.toolName).toBe('read_file');
    expect(calls[0]?.input).toEqual({ path: 'README.md' });
  });

  it('parses fenced multi-tool payloads with mixed key shapes', () => {
    const calls = parseGenericToolCallsFromText(`
Here is the action plan:

\`\`\`json
{
  "tools": [
    { "tool": "web_search", "input": { "query": "openclaw task flow" } },
    { "toolName": "bash", "arguments": { "command": "pwd" } }
  ]
}
\`\`\`
`);

    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.toolName)).toEqual(['web_search', 'bash']);
    expect(calls[0]?.input).toEqual({ query: 'openclaw task flow' });
    expect(calls[1]?.input).toEqual({ command: 'pwd' });
  });

  it('ignores plain json that is not a tool call', () => {
    const calls = parseGenericToolCallsFromText('{"summary":"done","status":"ok"}');
    expect(calls).toEqual([]);
  });
});
