import { mcpRegistry, MCPServerEntry } from './mcpRegistry';

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  autoConnect?: boolean;
}

export interface DiscoverySource {
  type: 'config' | 'environment' | 'network' | 'manual';
  configs: MCPServerConfig[];
}

interface ToolManifest {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

const DEFAULT_SCAN_INTERVAL_MS = 60_000;
const HEALTH_CHECK_INTERVAL_MS = 30_000;

export class MCPAutoDiscovery {
  private scanInterval: ReturnType<typeof setInterval> | null = null;
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private discoveredServers: Map<string, MCPServerConfig> = new Map();
  private connectors: Map<string, MCPServerConnector> = new Map();
  private running = false;

  async start(intervalMs: number = DEFAULT_SCAN_INTERVAL_MS): Promise<void> {
    if (this.running) return;
    this.running = true;
    console.log('[MCPAutoDiscovery] Starting continuous discovery loop');

    await this.runDiscoveryCycle();

    this.scanInterval = setInterval(() => {
      this.runDiscoveryCycle().catch(err =>
        console.error('[MCPAutoDiscovery] Discovery cycle error:', err)
      );
    }, intervalMs);

    this.healthInterval = setInterval(() => {
      this.runHealthChecks().catch(err =>
        console.error('[MCPAutoDiscovery] Health check error:', err)
      );
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
    console.log('[MCPAutoDiscovery] Stopped');
  }

  async addSource(source: DiscoverySource): Promise<void> {
    console.log(`[MCPAutoDiscovery] Adding ${source.configs.length} servers from ${source.type} source`);
    for (const config of source.configs) {
      if (!this.discoveredServers.has(config.id)) {
        this.discoveredServers.set(config.id, config);
        if (config.autoConnect !== false) {
          await this.connectAndRegister(config);
        }
      }
    }
  }

  async addServer(config: MCPServerConfig): Promise<void> {
    this.discoveredServers.set(config.id, config);
    await this.connectAndRegister(config);
  }

  async removeServer(serverId: string): Promise<void> {
    const connector = this.connectors.get(serverId);
    if (connector) {
      await connector.disconnect();
      this.connectors.delete(serverId);
    }
    this.discoveredServers.delete(serverId);
    mcpRegistry.removeServer(serverId);
  }

  getDiscoveredServers(): MCPServerConfig[] {
    return Array.from(this.discoveredServers.values());
  }

  private async runDiscoveryCycle(): Promise<void> {
    console.log('[MCPAutoDiscovery] Running discovery cycle...');

    const envSources = this.scanEnvironment();
    for (const config of envSources) {
      if (!this.discoveredServers.has(config.id)) {
        console.log(`[MCPAutoDiscovery] Discovered new server from environment: ${config.name}`);
        this.discoveredServers.set(config.id, config);
        if (config.autoConnect !== false) {
          await this.connectAndRegister(config).catch(err =>
            console.error(`[MCPAutoDiscovery] Failed to connect to ${config.name}:`, err.message)
          );
        }
      }
    }

    console.log(`[MCPAutoDiscovery] Discovery cycle complete. ${this.discoveredServers.size} servers known.`);
  }

  private scanEnvironment(): MCPServerConfig[] {
    const configs: MCPServerConfig[] = [];

    const mcpServersEnv = process.env.MCP_SERVERS;
    if (mcpServersEnv) {
      try {
        const parsed = JSON.parse(mcpServersEnv) as MCPServerConfig[];
        configs.push(...parsed);
      } catch {
        console.warn('[MCPAutoDiscovery] Failed to parse MCP_SERVERS env var');
      }
    }

    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('MCP_SERVER_') && key.endsWith('_COMMAND') && value) {
        const prefix = key.replace('_COMMAND', '');
        const name = prefix.replace('MCP_SERVER_', '').toLowerCase().replace(/_/g, '-');
        const args = process.env[`${prefix}_ARGS`]?.split(',') || [];
        configs.push({
          id: `env-${name}`,
          name: `env/${name}`,
          transport: 'stdio',
          command: value,
          args,
          autoConnect: true,
        });
      }

      if (key.startsWith('MCP_SERVER_') && key.endsWith('_URL') && value) {
        const prefix = key.replace('_URL', '');
        const name = prefix.replace('MCP_SERVER_', '').toLowerCase().replace(/_/g, '-');
        configs.push({
          id: `env-${name}`,
          name: `env/${name}`,
          transport: 'sse',
          url: value,
          autoConnect: true,
        });
      }
    }

    return configs;
  }

  private async connectAndRegister(config: MCPServerConfig): Promise<void> {
    console.log(`[MCPAutoDiscovery] Connecting to server: ${config.name} (${config.transport})`);

    mcpRegistry.registerServer({
      id: config.id,
      name: config.name,
      transport: config.transport,
      command: config.command,
      args: config.args,
      url: config.url,
      env: config.env,
    });

    const connector = new MCPServerConnector(config);
    this.connectors.set(config.id, connector);

    try {
      await connector.connect();
      mcpRegistry.updateServerStatus(config.id, 'connected');

      const tools = await connector.fetchTools();
      for (const tool of tools) {
        const toolId = `${config.id}::${tool.name}`;
        const existing = mcpRegistry.getTool(toolId);
        if (!existing) {
          mcpRegistry.registerTool({
            id: toolId,
            name: `mcp_${config.name.replace(/\//g, '_')}_${tool.name}`,
            serverId: config.id,
            serverName: config.name,
            description: tool.description || `MCP tool from ${config.name}`,
            inputSchema: tool.inputSchema || {},
            tags: [config.transport, config.name],
          });
        }
      }

      console.log(`[MCPAutoDiscovery] Registered ${tools.length} tools from ${config.name}`);
    } catch (err: any) {
      console.error(`[MCPAutoDiscovery] Connection failed for ${config.name}: ${err.message}`);
      mcpRegistry.updateServerStatus(config.id, 'error');
    }
  }

  private async runHealthChecks(): Promise<void> {
    for (const [serverId, connector] of this.connectors) {
      try {
        const healthy = await connector.healthCheck();
        mcpRegistry.updateServerStatus(serverId, healthy ? 'connected' : 'error');
      } catch {
        mcpRegistry.updateServerStatus(serverId, 'error');
      }
    }
  }
}

class MCPServerConnector {
  private config: MCPServerConfig;
  private connected = false;
  private tools: ToolManifest[] = [];
  private childProcess: any = null;
  private requestId = 0;
  private pendingRequests: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }> = new Map();
  private outputBuffer = '';

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.config.transport === 'stdio' && this.config.command) {
      const { spawn } = await import('child_process');
      const env = { ...process.env, ...this.config.env };
      this.childProcess = spawn(this.config.command, this.config.args || [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });

      this.childProcess.stdout?.on('data', (data: Buffer) => {
        this.outputBuffer += data.toString();
        this.processOutputBuffer();
      });

      this.childProcess.stderr?.on('data', (data: Buffer) => {
        console.warn(`[MCPConnector:${this.config.name}] stderr: ${data.toString().trim()}`);
      });

      this.childProcess.on('exit', (code: number) => {
        console.log(`[MCPConnector:${this.config.name}] Process exited with code ${code}`);
        this.connected = false;
        for (const [, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`MCP server exited with code ${code}`));
        }
        this.pendingRequests.clear();
      });

      await this.sendJsonRpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'IliaGPT-AgentOS', version: '1.0.0' },
      });

      this.connected = true;
      console.log(`[MCPConnector] Stdio connected: ${this.config.command}`);
    } else if ((this.config.transport === 'sse' || this.config.transport === 'http') && this.config.url) {
      try {
        const resp = await fetch(`${this.config.url}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
        this.connected = resp?.ok ?? true;
        console.log(`[MCPConnector] HTTP/SSE connected: ${this.config.url}`);
      } catch {
        this.connected = true;
        console.log(`[MCPConnector] HTTP/SSE assumed connected: ${this.config.url}`);
      }
    } else {
      this.connected = true;
    }
  }

  private processOutputBuffer(): void {
    const lines = this.outputBuffer.split('\n');
    this.outputBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const pending = this.pendingRequests.get(msg.id)!;
          clearTimeout(pending.timer);
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error.message || 'MCP error'));
          } else {
            pending.resolve(msg.result);
          }
        }
      } catch {}
    }
  }

  private sendJsonRpc(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.childProcess?.stdin?.writable) {
        return reject(new Error('stdin not writable'));
      }
      const id = ++this.requestId;
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, 15000);
      this.pendingRequests.set(id, { resolve, reject, timer });
      this.childProcess.stdin.write(msg);
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.tools = [];
    if (this.childProcess) {
      this.childProcess.kill('SIGTERM');
      this.childProcess = null;
    }
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
    }
    this.pendingRequests.clear();
  }

  async fetchTools(): Promise<ToolManifest[]> {
    if (!this.connected) throw new Error('Not connected');

    if (this.config.transport === 'stdio' && this.childProcess) {
      try {
        const result = await this.sendJsonRpc('tools/list', {});
        this.tools = (result?.tools || []).map((t: any) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
      } catch (err: any) {
        console.warn(`[MCPConnector:${this.config.name}] fetchTools failed: ${err.message}`);
        this.tools = [];
      }
    } else if ((this.config.transport === 'sse' || this.config.transport === 'http') && this.config.url) {
      try {
        const resp = await fetch(`${this.config.url}/tools`, { signal: AbortSignal.timeout(10000) });
        if (resp.ok) {
          const data = await resp.json();
          this.tools = (data?.tools || data || []).map((t: any) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          }));
        }
      } catch (err: any) {
        console.warn(`[MCPConnector:${this.config.name}] HTTP fetchTools failed: ${err.message}`);
        this.tools = [];
      }
    }

    return this.tools;
  }

  async healthCheck(): Promise<boolean> {
    if (this.config.transport === 'stdio') {
      return this.connected && this.childProcess !== null && !this.childProcess.killed;
    }
    if (this.config.url) {
      try {
        const resp = await fetch(`${this.config.url}/health`, { signal: AbortSignal.timeout(5000) });
        return resp.ok;
      } catch {
        return false;
      }
    }
    return this.connected;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ success: boolean; content?: string; error?: string }> {
    if (!this.connected) {
      return { success: false, error: 'Server not connected' };
    }

    try {
      if (this.config.transport === 'stdio' && this.childProcess) {
        const result = await this.sendJsonRpc('tools/call', { name, arguments: args });
        const content = result?.content?.map((c: any) => c.text || JSON.stringify(c)).join('\n') || '';
        return { success: !result?.isError, content, error: result?.isError ? content : undefined };
      } else if (this.config.url) {
        const resp = await fetch(`${this.config.url}/tools/${name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(30000),
        });
        const data = await resp.json();
        return { success: resp.ok, content: JSON.stringify(data), error: resp.ok ? undefined : data.error };
      }
      return { success: false, error: 'No transport available' };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
}

export const mcpAutoDiscovery = new MCPAutoDiscovery();
