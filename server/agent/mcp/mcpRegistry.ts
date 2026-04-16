import { z } from 'zod';

export interface MCPToolEntry {
  id: string;
  name: string;
  serverId: string;
  serverName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  status: 'active' | 'degraded' | 'disabled' | 'pending';
  registeredAt: number;
  lastUsedAt: number | null;
  usageCount: number;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number;
  reliabilityScore: number;
  tags: string[];
}

export interface MCPServerEntry {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  status: 'connected' | 'disconnected' | 'error' | 'discovering';
  lastHealthCheck: number | null;
  healthCheckFailures: number;
  discoveredAt: number;
  toolCount: number;
}

const RELIABILITY_THRESHOLD = 0.3;
const MAX_HEALTH_FAILURES = 5;
const LATENCY_DECAY = 0.9;

export class MCPRegistry {
  private tools: Map<string, MCPToolEntry> = new Map();
  private servers: Map<string, MCPServerEntry> = new Map();
  private listeners: Array<(event: RegistryEvent) => void> = [];

  registerServer(server: Omit<MCPServerEntry, 'status' | 'lastHealthCheck' | 'healthCheckFailures' | 'discoveredAt' | 'toolCount'>): MCPServerEntry {
    const entry: MCPServerEntry = {
      ...server,
      status: 'discovering',
      lastHealthCheck: null,
      healthCheckFailures: 0,
      discoveredAt: Date.now(),
      toolCount: 0,
    };
    this.servers.set(server.id, entry);
    this.emit({ type: 'server_registered', serverId: server.id, serverName: server.name });
    return entry;
  }

  updateServerStatus(serverId: string, status: MCPServerEntry['status']): void {
    const server = this.servers.get(serverId);
    if (!server) return;
    server.status = status;
    if (status === 'connected') {
      server.lastHealthCheck = Date.now();
      server.healthCheckFailures = 0;
    } else if (status === 'error') {
      server.healthCheckFailures++;
      if (server.healthCheckFailures >= MAX_HEALTH_FAILURES) {
        server.status = 'disconnected';
        this.disableServerTools(serverId);
        this.emit({ type: 'server_disconnected', serverId, serverName: server.name });
      }
    }
  }

  registerTool(tool: Omit<MCPToolEntry, 'status' | 'registeredAt' | 'lastUsedAt' | 'usageCount' | 'successCount' | 'failureCount' | 'avgLatencyMs' | 'reliabilityScore'>): MCPToolEntry {
    const entry: MCPToolEntry = {
      ...tool,
      status: 'active',
      registeredAt: Date.now(),
      lastUsedAt: null,
      usageCount: 0,
      successCount: 0,
      failureCount: 0,
      avgLatencyMs: 0,
      reliabilityScore: 1.0,
    };
    this.tools.set(tool.id, entry);

    const server = this.servers.get(tool.serverId);
    if (server) {
      server.toolCount = this.getToolsByServer(tool.serverId).length;
    }

    this.emit({ type: 'tool_registered', toolId: tool.id, toolName: tool.name });
    return entry;
  }

  recordToolUsage(toolId: string, success: boolean, latencyMs: number): void {
    const tool = this.tools.get(toolId);
    if (!tool) return;

    tool.usageCount++;
    tool.lastUsedAt = Date.now();
    tool.avgLatencyMs = tool.avgLatencyMs * LATENCY_DECAY + latencyMs * (1 - LATENCY_DECAY);

    if (success) {
      tool.successCount++;
    } else {
      tool.failureCount++;
    }

    tool.reliabilityScore = tool.usageCount > 0
      ? tool.successCount / tool.usageCount
      : 1.0;

    if (tool.reliabilityScore < RELIABILITY_THRESHOLD && tool.usageCount >= 5) {
      tool.status = 'disabled';
      this.emit({ type: 'tool_auto_disabled', toolId, toolName: tool.name, reliability: tool.reliabilityScore });
    } else if (tool.reliabilityScore < 0.6 && tool.usageCount >= 3) {
      tool.status = 'degraded';
    }
  }

  getTool(toolId: string): MCPToolEntry | undefined {
    return this.tools.get(toolId);
  }

  getToolByName(name: string): MCPToolEntry | undefined {
    for (const tool of this.tools.values()) {
      if (tool.name === name) return tool;
    }
    return undefined;
  }

  getActiveTools(): MCPToolEntry[] {
    return Array.from(this.tools.values()).filter(t => t.status === 'active' || t.status === 'degraded');
  }

  getAllTools(): MCPToolEntry[] {
    return Array.from(this.tools.values());
  }

  getToolsByServer(serverId: string): MCPToolEntry[] {
    return Array.from(this.tools.values()).filter(t => t.serverId === serverId);
  }

  getServer(serverId: string): MCPServerEntry | undefined {
    return this.servers.get(serverId);
  }

  getAllServers(): MCPServerEntry[] {
    return Array.from(this.servers.values());
  }

  searchTools(query: string): MCPToolEntry[] {
    const q = query.toLowerCase();
    return this.getActiveTools().filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some(tag => tag.toLowerCase().includes(q))
    );
  }

  getStats(): RegistryStats {
    const allTools = this.getAllTools();
    const activeTools = allTools.filter(t => t.status === 'active');
    const degradedTools = allTools.filter(t => t.status === 'degraded');
    const disabledTools = allTools.filter(t => t.status === 'disabled');
    const servers = this.getAllServers();

    return {
      totalTools: allTools.length,
      activeTools: activeTools.length,
      degradedTools: degradedTools.length,
      disabledTools: disabledTools.length,
      totalServers: servers.length,
      connectedServers: servers.filter(s => s.status === 'connected').length,
      totalUsage: allTools.reduce((sum, t) => sum + t.usageCount, 0),
      avgReliability: allTools.length > 0
        ? allTools.reduce((sum, t) => sum + t.reliabilityScore, 0) / allTools.length
        : 1.0,
      topTools: allTools
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, 10)
        .map(t => ({ name: t.name, usage: t.usageCount, reliability: t.reliabilityScore })),
    };
  }

  removeServer(serverId: string): void {
    this.disableServerTools(serverId);
    for (const tool of this.getToolsByServer(serverId)) {
      this.tools.delete(tool.id);
    }
    this.servers.delete(serverId);
    this.emit({ type: 'server_removed', serverId });
  }

  enableTool(toolId: string): void {
    const tool = this.tools.get(toolId);
    if (tool) {
      tool.status = 'active';
      tool.successCount = 0;
      tool.failureCount = 0;
      tool.usageCount = 0;
      tool.reliabilityScore = 1.0;
      this.emit({ type: 'tool_enabled', toolId, toolName: tool.name });
    }
  }

  onEvent(listener: (event: RegistryEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private disableServerTools(serverId: string): void {
    for (const tool of this.getToolsByServer(serverId)) {
      tool.status = 'disabled';
    }
  }

  private emit(event: RegistryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[MCPRegistry] Event listener error:', e);
      }
    }
  }

  toJSON(): { servers: MCPServerEntry[]; tools: MCPToolEntry[] } {
    return {
      servers: this.getAllServers(),
      tools: this.getAllTools(),
    };
  }

  loadFromJSON(data: { servers: MCPServerEntry[]; tools: MCPToolEntry[] }): void {
    this.servers.clear();
    this.tools.clear();
    for (const s of data.servers) this.servers.set(s.id, s);
    for (const t of data.tools) this.tools.set(t.id, t);
  }
}

export interface RegistryStats {
  totalTools: number;
  activeTools: number;
  degradedTools: number;
  disabledTools: number;
  totalServers: number;
  connectedServers: number;
  totalUsage: number;
  avgReliability: number;
  topTools: Array<{ name: string; usage: number; reliability: number }>;
}

export type RegistryEvent =
  | { type: 'server_registered'; serverId: string; serverName: string }
  | { type: 'server_disconnected'; serverId: string; serverName: string }
  | { type: 'server_removed'; serverId: string }
  | { type: 'tool_registered'; toolId: string; toolName: string }
  | { type: 'tool_auto_disabled'; toolId: string; toolName: string; reliability: number }
  | { type: 'tool_enabled'; toolId: string; toolName: string }
  | { type: 'skill_acquired'; toolId: string; toolName: string; serverId: string };

export const mcpRegistry = new MCPRegistry();
