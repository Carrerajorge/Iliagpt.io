/**
 * Capability: MCP Connectors
 * Tests Model Context Protocol connector execution: GitHub, Slack, Jira, etc.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { MCP_CONNECTOR_RESPONSE } from './_setup/mockResponses';
import { createLLMClientMock, expectValidJson, mockFetch } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));

interface McpConnector {
  id: string;
  name: string;
  version: string;
  tools: McpTool[];
  baseUrl: string;
  authType: 'api_key' | 'oauth' | 'none';
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpToolCallResult {
  connectorId: string;
  toolName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  duration_ms: number;
  success: boolean;
  error?: string;
}

const MOCK_CONNECTORS: McpConnector[] = [
  {
    id: 'github-mcp',
    name: 'GitHub MCP',
    version: '1.0.0',
    baseUrl: 'https://api.github.com',
    authType: 'api_key',
    tools: [
      { name: 'create_issue', description: 'Create a GitHub issue', inputSchema: { title: 'string', body: 'string' } },
      { name: 'list_repos', description: 'List repositories', inputSchema: { org: 'string' } },
      { name: 'create_pr', description: 'Create a pull request', inputSchema: { title: 'string', branch: 'string', base: 'string' } },
    ],
  },
  {
    id: 'slack-mcp',
    name: 'Slack MCP',
    version: '1.0.0',
    baseUrl: 'https://slack.com/api',
    authType: 'oauth',
    tools: [
      { name: 'send_message', description: 'Send a Slack message', inputSchema: { channel: 'string', text: 'string' } },
      { name: 'list_channels', description: 'List channels', inputSchema: {} },
    ],
  },
  {
    id: 'jira-mcp',
    name: 'Jira MCP',
    version: '1.0.0',
    baseUrl: 'https://your-org.atlassian.net',
    authType: 'api_key',
    tools: [
      { name: 'create_ticket', description: 'Create a Jira ticket', inputSchema: { summary: 'string', description: 'string', priority: 'string' } },
      { name: 'get_ticket', description: 'Get ticket by key', inputSchema: { key: 'string' } },
    ],
  },
];

class McpRegistry {
  private connectors = new Map<string, McpConnector>();

  register(connector: McpConnector) {
    this.connectors.set(connector.id, connector);
  }

  getConnector(id: string): McpConnector | undefined {
    return this.connectors.get(id);
  }

  listConnectors(): McpConnector[] {
    return Array.from(this.connectors.values());
  }

  getTool(connectorId: string, toolName: string): McpTool | undefined {
    return this.connectors.get(connectorId)?.tools.find((t) => t.name === toolName);
  }

  async callTool(
    connectorId: string,
    toolName: string,
    input: Record<string, unknown>,
    provider: ProviderConfig,
    llmClient: ReturnType<typeof createLLMClientMock>,
  ): Promise<McpToolCallResult> {
    const tool = this.getTool(connectorId, toolName);
    if (!tool) {
      return { connectorId, toolName, input, output: {}, duration_ms: 0, success: false, error: 'Tool not found' };
    }

    const response = await llmClient.chat.completions.create({
      model: provider.model,
      messages: [
        { role: 'system', content: `You are executing the ${toolName} tool on ${connectorId}. Return the result as JSON.` },
        { role: 'user', content: JSON.stringify(input) },
      ],
    });

    const result = expectValidJson(response.choices[0].message.content);
    return {
      connectorId,
      toolName,
      input,
      output: result.output as Record<string, unknown> ?? result,
      duration_ms: result.duration_ms as number ?? 100,
      success: true,
    };
  }
}

runWithEachProvider('MCP Connectors', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;
  let registry: McpRegistry;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: MCP_CONNECTOR_RESPONSE, model: provider.model });
    registry = new McpRegistry();
    for (const c of MOCK_CONNECTORS) registry.register(c);
  });

  it('lists all registered connectors', () => {
    expect(registry.listConnectors().length).toBe(3);
  });

  it('retrieves GitHub connector by ID', () => {
    const c = registry.getConnector('github-mcp');
    expect(c?.name).toBe('GitHub MCP');
  });

  it('lists tools for a connector', () => {
    const c = registry.getConnector('github-mcp');
    expect(c?.tools.length).toBeGreaterThan(0);
  });

  it('finds a specific tool by name', () => {
    const tool = registry.getTool('github-mcp', 'create_issue');
    expect(tool?.name).toBe('create_issue');
  });

  it('returns undefined for unknown connector', () => {
    expect(registry.getConnector('nonexistent')).toBeUndefined();
  });

  it('returns undefined for unknown tool', () => {
    expect(registry.getTool('github-mcp', 'nonexistent_tool')).toBeUndefined();
  });

  it('calls a GitHub tool successfully', async () => {
    const result = await registry.callTool(
      'github-mcp',
      'create_issue',
      { title: 'Fix login bug', body: 'SSO users cannot log in' },
      provider,
      llmMock,
    );
    expect(result.success).toBe(true);
    expect(result.connectorId).toBe('github-mcp');
  });

  it('returns failure for non-existent tool call', async () => {
    const result = await registry.callTool('github-mcp', 'bad_tool', {}, provider, llmMock);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('calls LLM once per tool execution', async () => {
    await registry.callTool('slack-mcp', 'send_message', { channel: '#general', text: 'Hello' }, provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('uses correct model', async () => {
    await registry.callTool('jira-mcp', 'create_ticket', { summary: 'Bug', description: 'Details' }, provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });

  it('response has duration_ms', async () => {
    const result = await registry.callTool('github-mcp', 'list_repos', { org: 'myorg' }, provider, llmMock);
    expect(typeof result.duration_ms).toBe('number');
  });

  it('MCP response has issueNumber in output', () => {
    const spec = expectValidJson(MCP_CONNECTOR_RESPONSE);
    const output = spec.output as Record<string, unknown>;
    expect(output).toHaveProperty('issueNumber');
    expect(output).toHaveProperty('status');
  });

  it('all connectors have auth type set', () => {
    for (const c of registry.listConnectors()) {
      expect(['api_key', 'oauth', 'none']).toContain(c.authType);
    }
  });
});
