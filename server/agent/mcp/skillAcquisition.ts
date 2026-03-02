import { mcpRegistry, MCPToolEntry } from './mcpRegistry';
import { mcpAutoDiscovery, MCPServerConfig } from './mcpAutoDiscovery';

export type AcquisitionStatus = 'searching' | 'found' | 'evaluating' | 'pending_approval' | 'approved' | 'rejected' | 'installing' | 'installed' | 'failed';

export interface SkillCandidate {
  id: string;
  taskDescription: string;
  serverConfig: MCPServerConfig;
  toolName: string;
  toolDescription: string;
  relevanceScore: number;
  safetyScore: number;
  status: AcquisitionStatus;
  requestedAt: number;
  resolvedAt: number | null;
  rejectionReason?: string;
}

export interface AcquisitionRequest {
  id: string;
  taskDescription: string;
  candidates: SkillCandidate[];
  status: 'open' | 'resolved' | 'no_match';
  createdAt: number;
  resolvedAt: number | null;
}

export interface SkillSearchResult {
  serverConfig: MCPServerConfig;
  toolName: string;
  toolDescription: string;
  relevanceScore: number;
}

const KNOWN_MCP_REGISTRIES: MCPServerConfig[] = [
  {
    id: 'registry-filesystem',
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  },
  {
    id: 'registry-brave-search',
    name: 'brave-search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
  },
  {
    id: 'registry-github',
    name: 'github',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
  },
  {
    id: 'registry-puppeteer',
    name: 'puppeteer',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
  },
  {
    id: 'registry-sqlite',
    name: 'sqlite',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite'],
  },
  {
    id: 'registry-memory',
    name: 'memory',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
  },
];

const SAFETY_KEYWORDS_DANGEROUS = [
  'delete', 'remove', 'drop', 'truncate', 'format', 'destroy',
  'exec', 'eval', 'system', 'shell', 'sudo', 'admin',
];

const SAFETY_KEYWORDS_SAFE = [
  'read', 'search', 'list', 'get', 'fetch', 'query', 'find',
  'analyze', 'summarize', 'generate', 'create', 'convert',
];

export class SkillAcquisitionEngine {
  private requests: Map<string, AcquisitionRequest> = new Map();
  private approvalCallback: ((candidate: SkillCandidate) => Promise<boolean>) | null = null;
  private autoApproveThreshold = 0.8;

  setApprovalCallback(cb: (candidate: SkillCandidate) => Promise<boolean>): void {
    this.approvalCallback = cb;
  }

  setAutoApproveThreshold(threshold: number): void {
    this.autoApproveThreshold = Math.max(0, Math.min(1, threshold));
  }

  async searchForSkill(taskDescription: string): Promise<AcquisitionRequest> {
    const requestId = `acq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const request: AcquisitionRequest = {
      id: requestId,
      taskDescription,
      candidates: [],
      status: 'open',
      createdAt: Date.now(),
      resolvedAt: null,
    };

    console.log(`[SkillAcquisition] Searching for skills to handle: "${taskDescription}"`);

    const existingTools = mcpRegistry.searchTools(taskDescription);
    if (existingTools.length > 0) {
      console.log(`[SkillAcquisition] Found ${existingTools.length} existing tools matching the task`);
      request.status = 'resolved';
      request.resolvedAt = Date.now();
      this.requests.set(requestId, request);
      return request;
    }

    const searchResults = this.searchKnownRegistries(taskDescription);

    for (const result of searchResults) {
      const safetyScore = this.evaluateSafety(result.toolName, result.toolDescription);
      const candidate: SkillCandidate = {
        id: `cand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        taskDescription,
        serverConfig: result.serverConfig,
        toolName: result.toolName,
        toolDescription: result.toolDescription,
        relevanceScore: result.relevanceScore,
        safetyScore,
        status: 'evaluating',
        requestedAt: Date.now(),
        resolvedAt: null,
      };
      request.candidates.push(candidate);
    }

    if (request.candidates.length === 0) {
      request.status = 'no_match';
      request.resolvedAt = Date.now();
      console.log('[SkillAcquisition] No matching skills found');
    }

    this.requests.set(requestId, request);
    return request;
  }

  async acquireSkill(requestId: string, candidateId: string): Promise<SkillCandidate> {
    const request = this.requests.get(requestId);
    if (!request) throw new Error(`Acquisition request ${requestId} not found`);

    const candidate = request.candidates.find(c => c.id === candidateId);
    if (!candidate) throw new Error(`Candidate ${candidateId} not found`);

    if (candidate.safetyScore < 0.3) {
      candidate.status = 'rejected';
      candidate.rejectionReason = 'Safety score too low';
      candidate.resolvedAt = Date.now();
      return candidate;
    }

    const combinedScore = (candidate.relevanceScore * 0.6 + candidate.safetyScore * 0.4);

    if (combinedScore >= this.autoApproveThreshold) {
      candidate.status = 'approved';
      console.log(`[SkillAcquisition] Auto-approved: ${candidate.toolName} (score: ${combinedScore.toFixed(2)})`);
    } else if (this.approvalCallback) {
      candidate.status = 'pending_approval';
      try {
        const approved = await this.approvalCallback(candidate);
        candidate.status = approved ? 'approved' : 'rejected';
        if (!approved) {
          candidate.rejectionReason = 'Human rejected';
          candidate.resolvedAt = Date.now();
          return candidate;
        }
      } catch {
        candidate.status = 'rejected';
        candidate.rejectionReason = 'Approval callback failed';
        candidate.resolvedAt = Date.now();
        return candidate;
      }
    } else {
      candidate.status = 'approved';
    }

    candidate.status = 'installing';
    try {
      await mcpAutoDiscovery.addServer(candidate.serverConfig);

      candidate.status = 'installed';
      candidate.resolvedAt = Date.now();
      request.status = 'resolved';
      request.resolvedAt = Date.now();

      console.log(`[SkillAcquisition] Successfully installed skill: ${candidate.toolName}`);
    } catch (err: any) {
      candidate.status = 'failed';
      candidate.rejectionReason = `Installation failed: ${err.message}`;
      candidate.resolvedAt = Date.now();
    }

    return candidate;
  }

  async acquireBestCandidate(requestId: string): Promise<SkillCandidate | null> {
    const request = this.requests.get(requestId);
    if (!request || request.candidates.length === 0) return null;

    const sorted = [...request.candidates]
      .filter(c => c.status === 'evaluating')
      .sort((a, b) => {
        const scoreA = a.relevanceScore * 0.6 + a.safetyScore * 0.4;
        const scoreB = b.relevanceScore * 0.6 + b.safetyScore * 0.4;
        return scoreB - scoreA;
      });

    if (sorted.length === 0) return null;
    return this.acquireSkill(requestId, sorted[0].id);
  }

  getRequest(requestId: string): AcquisitionRequest | undefined {
    return this.requests.get(requestId);
  }

  getAllRequests(): AcquisitionRequest[] {
    return Array.from(this.requests.values());
  }

  getPendingRequests(): AcquisitionRequest[] {
    return Array.from(this.requests.values()).filter(r => r.status === 'open');
  }

  private searchKnownRegistries(taskDescription: string): SkillSearchResult[] {
    const results: SkillSearchResult[] = [];
    const taskLower = taskDescription.toLowerCase();

    for (const registry of KNOWN_MCP_REGISTRIES) {
      const relevance = this.computeRelevance(taskLower, registry.name);
      if (relevance > 0.2) {
        results.push({
          serverConfig: registry,
          toolName: registry.name,
          toolDescription: `MCP server providing ${registry.name} capabilities`,
          relevanceScore: relevance,
        });
      }
    }

    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return results.slice(0, 5);
  }

  private computeRelevance(taskLower: string, serverName: string): number {
    const keywordMap: Record<string, string[]> = {
      'filesystem': ['file', 'folder', 'directory', 'read', 'write', 'path', 'disk'],
      'brave-search': ['search', 'find', 'look up', 'web', 'internet', 'query'],
      'github': ['github', 'repository', 'repo', 'commit', 'pull request', 'issue', 'code'],
      'puppeteer': ['browser', 'webpage', 'scrape', 'screenshot', 'navigate', 'click', 'automate'],
      'sqlite': ['database', 'sql', 'query', 'table', 'data', 'sqlite'],
      'memory': ['remember', 'recall', 'store', 'memory', 'knowledge', 'note'],
    };

    const keywords = keywordMap[serverName] || [serverName];
    let matches = 0;
    for (const kw of keywords) {
      if (taskLower.includes(kw)) matches++;
    }

    return keywords.length > 0 ? matches / keywords.length : 0;
  }

  private evaluateSafety(toolName: string, description: string): number {
    const combined = `${toolName} ${description}`.toLowerCase();
    let safeScore = 0.7;

    for (const kw of SAFETY_KEYWORDS_DANGEROUS) {
      if (combined.includes(kw)) safeScore -= 0.15;
    }
    for (const kw of SAFETY_KEYWORDS_SAFE) {
      if (combined.includes(kw)) safeScore += 0.05;
    }

    return Math.max(0, Math.min(1, safeScore));
  }
}

export const skillAcquisition = new SkillAcquisitionEngine();
