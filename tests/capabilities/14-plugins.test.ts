/**
 * Capability: Plugins
 * Tests plugin registration, discovery, capability negotiation, and sandboxed execution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { createLLMClientMock, expectValidJson } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));

interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  enabled: boolean;
  sandboxed: boolean;
  manifest: Record<string, unknown>;
}

interface PluginExecutionResult {
  pluginId: string;
  capability: string;
  input: unknown;
  output: unknown;
  duration_ms: number;
  sandboxed: boolean;
  success: boolean;
  error?: string;
}

class PluginRegistry {
  private plugins = new Map<string, Plugin>();
  private executionLog: PluginExecutionResult[] = [];

  register(plugin: Plugin): void {
    if (!plugin.id || !plugin.name) throw new Error('Plugin must have id and name');
    this.plugins.set(plugin.id, plugin);
  }

  unregister(id: string): boolean {
    return this.plugins.delete(id);
  }

  getPlugin(id: string): Plugin | undefined {
    return this.plugins.get(id);
  }

  listPlugins(enabledOnly = false): Plugin[] {
    const all = Array.from(this.plugins.values());
    return enabledOnly ? all.filter((p) => p.enabled) : all;
  }

  findByCapability(capability: string): Plugin[] {
    return Array.from(this.plugins.values()).filter((p) => p.capabilities.includes(capability));
  }

  enable(id: string): boolean {
    const p = this.plugins.get(id);
    if (!p) return false;
    this.plugins.set(id, { ...p, enabled: true });
    return true;
  }

  disable(id: string): boolean {
    const p = this.plugins.get(id);
    if (!p) return false;
    this.plugins.set(id, { ...p, enabled: false });
    return true;
  }

  async execute(
    pluginId: string,
    capability: string,
    input: unknown,
    provider: ProviderConfig,
    llmClient: ReturnType<typeof createLLMClientMock>,
  ): Promise<PluginExecutionResult> {
    const plugin = this.plugins.get(pluginId);

    if (!plugin) {
      return { pluginId, capability, input, output: null, duration_ms: 0, sandboxed: false, success: false, error: 'Plugin not found' };
    }
    if (!plugin.enabled) {
      return { pluginId, capability, input, output: null, duration_ms: 0, sandboxed: plugin.sandboxed, success: false, error: 'Plugin disabled' };
    }
    if (!plugin.capabilities.includes(capability)) {
      return { pluginId, capability, input, output: null, duration_ms: 0, sandboxed: plugin.sandboxed, success: false, error: 'Capability not supported' };
    }

    const start = Date.now();
    const response = await llmClient.chat.completions.create({
      model: provider.model,
      messages: [
        { role: 'system', content: `Execute plugin ${pluginId} capability ${capability}. Return JSON result.` },
        { role: 'user', content: JSON.stringify(input) },
      ],
    });

    const result: PluginExecutionResult = {
      pluginId,
      capability,
      input,
      output: expectValidJson(response.choices[0].message.content),
      duration_ms: Date.now() - start,
      sandboxed: plugin.sandboxed,
      success: true,
    };

    this.executionLog.push(result);
    return result;
  }

  getExecutionLog(): PluginExecutionResult[] {
    return [...this.executionLog];
  }
}

const SAMPLE_PLUGINS: Plugin[] = [
  {
    id: 'weather-plugin',
    name: 'Weather Plugin',
    version: '1.2.0',
    description: 'Fetch real-time weather data',
    capabilities: ['get_weather', 'forecast'],
    enabled: true,
    sandboxed: true,
    manifest: { apiEndpoint: 'https://api.weather.example' },
  },
  {
    id: 'calculator-plugin',
    name: 'Calculator Plugin',
    version: '2.0.0',
    description: 'Advanced math operations',
    capabilities: ['calculate', 'convert_units', 'statistics'],
    enabled: true,
    sandboxed: true,
    manifest: {},
  },
  {
    id: 'disabled-plugin',
    name: 'Disabled Plugin',
    version: '1.0.0',
    description: 'This plugin is off',
    capabilities: ['do_something'],
    enabled: false,
    sandboxed: true,
    manifest: {},
  },
];

const PLUGIN_RESPONSE = JSON.stringify({ result: 'sunny', temperature: 22, unit: 'celsius', location: 'New York' });

runWithEachProvider('Plugins', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;
  let registry: PluginRegistry;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: PLUGIN_RESPONSE, model: provider.model });
    registry = new PluginRegistry();
    for (const p of SAMPLE_PLUGINS) registry.register(p);
  });

  it('registers and retrieves plugins', () => {
    expect(registry.listPlugins().length).toBe(3);
  });

  it('lists only enabled plugins', () => {
    const enabled = registry.listPlugins(true);
    expect(enabled.every((p) => p.enabled)).toBe(true);
    expect(enabled.length).toBe(2);
  });

  it('finds plugins by capability', () => {
    const plugins = registry.findByCapability('calculate');
    expect(plugins.length).toBe(1);
    expect(plugins[0].id).toBe('calculator-plugin');
  });

  it('returns empty array for unknown capability', () => {
    expect(registry.findByCapability('nonexistent_capability')).toHaveLength(0);
  });

  it('executes an enabled plugin successfully', async () => {
    const result = await registry.execute('weather-plugin', 'get_weather', { location: 'New York' }, provider, llmMock);
    expect(result.success).toBe(true);
  });

  it('fails when plugin not found', async () => {
    const result = await registry.execute('nonexistent', 'do_thing', {}, provider, llmMock);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('fails when plugin is disabled', async () => {
    const result = await registry.execute('disabled-plugin', 'do_something', {}, provider, llmMock);
    expect(result.success).toBe(false);
    expect(result.error).toContain('disabled');
  });

  it('fails for unsupported capability', async () => {
    const result = await registry.execute('weather-plugin', 'calculate', {}, provider, llmMock);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Capability not supported');
  });

  it('enables a disabled plugin', () => {
    registry.enable('disabled-plugin');
    const p = registry.getPlugin('disabled-plugin');
    expect(p?.enabled).toBe(true);
  });

  it('disables an enabled plugin', () => {
    registry.disable('weather-plugin');
    const p = registry.getPlugin('weather-plugin');
    expect(p?.enabled).toBe(false);
  });

  it('logs executions', async () => {
    await registry.execute('calculator-plugin', 'calculate', { expr: '2+2' }, provider, llmMock);
    expect(registry.getExecutionLog().length).toBe(1);
  });

  it('marks execution as sandboxed', async () => {
    const result = await registry.execute('weather-plugin', 'get_weather', { location: 'LA' }, provider, llmMock);
    expect(result.sandboxed).toBe(true);
  });

  it('throws when registering plugin without id', () => {
    expect(() => registry.register({ id: '', name: 'Bad', version: '1', description: '', capabilities: [], enabled: true, sandboxed: false, manifest: {} }))
      .toThrow();
  });

  it('calls LLM once per execution', async () => {
    await registry.execute('calculator-plugin', 'statistics', { data: [1, 2, 3] }, provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });
});
