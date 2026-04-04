/**
 * CollaborationProtocol — WebSocket-based real-time multi-agent collaboration
 * with roles, proposals, consensus voting, and heartbeat management.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { createHmac } from 'crypto';
import { z } from 'zod';
import { Logger } from '../../lib/logger';

// ─────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────

export enum AgentRole {
  ORCHESTRATOR = 'ORCHESTRATOR',
  PLANNER = 'PLANNER',
  EXECUTOR = 'EXECUTOR',
  CRITIC = 'CRITIC',
  RESEARCHER = 'RESEARCHER',
  SUMMARIZER = 'SUMMARIZER',
  COORDINATOR = 'COORDINATOR',
}

// ─────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────

export interface CollaborationSession {
  id: string;
  name: string;
  createdAt: Date;
  agentIds: string[];
  roles: Map<string, AgentRole>;
  status: 'open' | 'locked' | 'closed';
  topic: string;
  maxAgents: number;
  metadata: Record<string, unknown>;
}

export interface ProtocolMessage {
  id: string;
  sessionId: string;
  fromAgentId: string;
  toAgentId: string | 'broadcast';
  role: AgentRole;
  type:
    | 'join'
    | 'leave'
    | 'message'
    | 'propose'
    | 'vote'
    | 'consensus'
    | 'delegate'
    | 'heartbeat'
    | 'error';
  payload: unknown;
  timestamp: Date;
  signature?: string;
  priority: number; // 1–10
}

export interface VoteRecord {
  proposalId: string;
  agentId: string;
  vote: 'yes' | 'no' | 'abstain';
  reason?: string;
  timestamp: Date;
}

export interface Proposal {
  id: string;
  sessionId: string;
  proposedBy: string;
  content: unknown;
  requiredApprovalPct: number; // 0–1
  votes: VoteRecord[];
  status: 'open' | 'passed' | 'rejected' | 'expired';
  expiresAt: Date;
  createdAt: Date;
}

export interface CollaborationStats {
  sessions: number;
  messages: number;
  proposals: number;
  consensusReached: number;
  avgSessionDuration: number; // ms
}

// ─────────────────────────────────────────────
// Zod schemas for runtime validation
// ─────────────────────────────────────────────

const CreateSessionOptionsSchema = z.object({
  maxAgents: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const SendMessageSchema = z.object({
  sessionId: z.string().min(1),
  fromAgentId: z.string().min(1),
  toAgentId: z.union([z.string().min(1), z.literal('broadcast')]),
  role: z.nativeEnum(AgentRole),
  type: z.enum([
    'join',
    'leave',
    'message',
    'propose',
    'vote',
    'consensus',
    'delegate',
    'heartbeat',
    'error',
  ]),
  payload: z.unknown(),
  priority: z.number().min(1).max(10),
  signature: z.string().optional(),
});

// ─────────────────────────────────────────────
// Internal tracking for session lifecycle times
// ─────────────────────────────────────────────

interface SessionMeta {
  closedAt?: Date;
  openedAt: Date;
}

// ─────────────────────────────────────────────
// CollaborationProtocol class
// ─────────────────────────────────────────────

export class CollaborationProtocol extends EventEmitter {
  private readonly sessions: Map<string, CollaborationSession> = new Map();
  private readonly proposals: Map<string, Proposal> = new Map();
  private readonly messageLog: ProtocolMessage[] = [];
  private readonly heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
  private readonly sessionMeta: Map<string, SessionMeta> = new Map();

  private readonly MESSAGE_LOG_CAP = 10_000;
  private readonly DEFAULT_MAX_AGENTS = 20;
  private readonly DEFAULT_TTL_MS = 60_000;
  private readonly DEFAULT_APPROVAL_PCT = 0.51;
  private readonly DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;

  private consensusReachedCount = 0;

  // ─── Session lifecycle ─────────────────────

  createSession(
    name: string,
    topic: string,
    options?: { maxAgents?: number; metadata?: Record<string, unknown> },
  ): CollaborationSession {
    const parsed = CreateSessionOptionsSchema.parse(options ?? {});
    const id = randomUUID();
    const session: CollaborationSession = {
      id,
      name,
      createdAt: new Date(),
      agentIds: [],
      roles: new Map(),
      status: 'open',
      topic,
      maxAgents: parsed.maxAgents ?? this.DEFAULT_MAX_AGENTS,
      metadata: parsed.metadata ?? {},
    };
    this.sessions.set(id, session);
    this.sessionMeta.set(id, { openedAt: new Date() });
    Logger.info('[CollaborationProtocol] Session created', { sessionId: id, name, topic });
    this.emit('session:created', session);
    return session;
  }

  joinSession(sessionId: string, agentId: string, role: AgentRole): void {
    const session = this._requireSession(sessionId);
    if (session.status !== 'open') {
      throw new Error(`Session ${sessionId} is not open (status: ${session.status})`);
    }
    if (session.agentIds.includes(agentId)) {
      throw new Error(`Agent ${agentId} already in session ${sessionId}`);
    }
    if (session.agentIds.length >= session.maxAgents) {
      throw new Error(
        `Session ${sessionId} is full (maxAgents=${session.maxAgents})`,
      );
    }
    session.agentIds.push(agentId);
    session.roles.set(agentId, role);
    Logger.info('[CollaborationProtocol] Agent joined session', {
      sessionId,
      agentId,
      role,
    });
    const msg = this._buildAndLog({
      sessionId,
      fromAgentId: agentId,
      toAgentId: 'broadcast',
      role,
      type: 'join',
      payload: { agentId, role },
      priority: 5,
    });
    this.emit('agent:joined', { session, agentId, role, message: msg });
    this.emit('message', msg);
  }

  leaveSession(sessionId: string, agentId: string): void {
    const session = this._requireSession(sessionId);
    const idx = session.agentIds.indexOf(agentId);
    if (idx === -1) {
      throw new Error(`Agent ${agentId} not found in session ${sessionId}`);
    }
    const role = session.roles.get(agentId) ?? AgentRole.EXECUTOR;
    session.agentIds.splice(idx, 1);
    session.roles.delete(agentId);
    Logger.info('[CollaborationProtocol] Agent left session', { sessionId, agentId });
    const msg = this._buildAndLog({
      sessionId,
      fromAgentId: agentId,
      toAgentId: 'broadcast',
      role,
      type: 'leave',
      payload: { agentId },
      priority: 4,
    });
    this.emit('agent:left', { session, agentId, message: msg });
    this.emit('message', msg);
    if (session.agentIds.length === 0) {
      Logger.info('[CollaborationProtocol] Session empty — closing', { sessionId });
      this.closeSession(sessionId);
    }
  }

  // ─── Messaging ────────────────────────────

  send(
    msg: Omit<ProtocolMessage, 'id' | 'timestamp'>,
  ): ProtocolMessage {
    SendMessageSchema.parse(msg);
    this._requireSession(msg.sessionId);
    const full = this._buildAndLog(msg);
    this.emit('message', full);
    return full;
  }

  broadcast(
    sessionId: string,
    fromAgentId: string,
    type: ProtocolMessage['type'],
    payload: unknown,
  ): ProtocolMessage[] {
    const session = this._requireSession(sessionId);
    const role = session.roles.get(fromAgentId) ?? AgentRole.EXECUTOR;
    const msgs: ProtocolMessage[] = [];
    for (const agentId of session.agentIds) {
      if (agentId === fromAgentId) continue;
      const msg = this._buildAndLog({
        sessionId,
        fromAgentId,
        toAgentId: agentId,
        role,
        type,
        payload,
        priority: 5,
      });
      this.emit('message', msg);
      msgs.push(msg);
    }
    return msgs;
  }

  // ─── Proposals & voting ───────────────────

  propose(
    sessionId: string,
    proposedBy: string,
    content: unknown,
    requiredApprovalPct: number = this.DEFAULT_APPROVAL_PCT,
    ttlMs: number = this.DEFAULT_TTL_MS,
  ): Proposal {
    this._requireSession(sessionId);
    if (requiredApprovalPct < 0 || requiredApprovalPct > 1) {
      throw new Error('requiredApprovalPct must be between 0 and 1');
    }
    const proposal: Proposal = {
      id: randomUUID(),
      sessionId,
      proposedBy,
      content,
      requiredApprovalPct,
      votes: [],
      status: 'open',
      expiresAt: new Date(Date.now() + ttlMs),
      createdAt: new Date(),
    };
    this.proposals.set(proposal.id, proposal);

    // Auto-expire proposal after TTL
    setTimeout(() => {
      const p = this.proposals.get(proposal.id);
      if (p && p.status === 'open') {
        p.status = 'expired';
        Logger.warn('[CollaborationProtocol] Proposal expired', {
          proposalId: p.id,
        });
      }
    }, ttlMs);

    const session = this._requireSession(sessionId);
    const role = session.roles.get(proposedBy) ?? AgentRole.EXECUTOR;
    const msg = this._buildAndLog({
      sessionId,
      fromAgentId: proposedBy,
      toAgentId: 'broadcast',
      role,
      type: 'propose',
      payload: { proposalId: proposal.id, content, requiredApprovalPct, expiresAt: proposal.expiresAt },
      priority: 7,
    });
    this.emit('proposal:created', proposal);
    this.emit('message', msg);
    Logger.info('[CollaborationProtocol] Proposal created', {
      proposalId: proposal.id,
      sessionId,
      proposedBy,
    });
    return proposal;
  }

  castVote(
    proposalId: string,
    agentId: string,
    vote: VoteRecord['vote'],
    reason?: string,
  ): VoteRecord {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
    if (proposal.status !== 'open') {
      throw new Error(`Proposal ${proposalId} is not open (status: ${proposal.status})`);
    }
    if (new Date() > proposal.expiresAt) {
      proposal.status = 'expired';
      throw new Error(`Proposal ${proposalId} has expired`);
    }
    const existing = proposal.votes.find((v) => v.agentId === agentId);
    if (existing) {
      throw new Error(`Agent ${agentId} has already voted on proposal ${proposalId}`);
    }
    const record: VoteRecord = {
      proposalId,
      agentId,
      vote,
      reason,
      timestamp: new Date(),
    };
    proposal.votes.push(record);

    const session = this._requireSession(proposal.sessionId);
    const role = session.roles.get(agentId) ?? AgentRole.EXECUTOR;
    const msg = this._buildAndLog({
      sessionId: proposal.sessionId,
      fromAgentId: agentId,
      toAgentId: 'broadcast',
      role,
      type: 'vote',
      payload: { proposalId, vote, reason },
      priority: 6,
    });
    this.emit('vote:cast', { record, proposal });
    this.emit('message', msg);

    // Check if quorum is reached
    this._resolveProposal(proposal);

    return record;
  }

  getConsensus(proposalId: string): {
    reached: boolean;
    result?: 'passed' | 'rejected';
    tally: Record<string, number>;
  } {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
    const tally: Record<string, number> = { yes: 0, no: 0, abstain: 0 };
    for (const v of proposal.votes) {
      tally[v.vote] = (tally[v.vote] ?? 0) + 1;
    }
    const reached = proposal.status === 'passed' || proposal.status === 'rejected';
    return {
      reached,
      result: reached ? (proposal.status as 'passed' | 'rejected') : undefined,
      tally,
    };
  }

  // ─── Task delegation ──────────────────────

  delegateTask(
    sessionId: string,
    from: string,
    to: string,
    task: unknown,
  ): ProtocolMessage {
    const session = this._requireSession(sessionId);
    const role = session.roles.get(from) ?? AgentRole.EXECUTOR;
    const msg = this._buildAndLog({
      sessionId,
      fromAgentId: from,
      toAgentId: to,
      role,
      type: 'delegate',
      payload: { task, delegatedAt: new Date() },
      priority: 8,
    });
    this.emit('task:delegated', { sessionId, from, to, task, message: msg });
    this.emit('message', msg);
    Logger.info('[CollaborationProtocol] Task delegated', {
      sessionId,
      from,
      to,
    });
    return msg;
  }

  // ─── Session control ──────────────────────

  closeSession(sessionId: string): void {
    const session = this._requireSession(sessionId);
    if (session.status === 'closed') return;
    session.status = 'closed';
    this._stopHeartbeat(sessionId);
    const meta = this.sessionMeta.get(sessionId);
    if (meta) meta.closedAt = new Date();
    Logger.info('[CollaborationProtocol] Session closed', { sessionId });
    this.emit('session:closed', session);
  }

  startHeartbeat(sessionId: string, intervalMs: number = this.DEFAULT_HEARTBEAT_INTERVAL_MS): void {
    this._requireSession(sessionId);
    if (this.heartbeatIntervals.has(sessionId)) {
      this._stopHeartbeat(sessionId);
    }
    const handle = setInterval(() => {
      const session = this.sessions.get(sessionId);
      if (!session || session.status === 'closed') {
        this._stopHeartbeat(sessionId);
        return;
      }
      for (const agentId of session.agentIds) {
        const role = session.roles.get(agentId) ?? AgentRole.EXECUTOR;
        const msg = this._buildAndLog({
          sessionId,
          fromAgentId: 'system',
          toAgentId: agentId,
          role,
          type: 'heartbeat',
          payload: { ts: Date.now() },
          priority: 1,
        });
        this.emit('message', msg);
      }
    }, intervalMs);
    this.heartbeatIntervals.set(sessionId, handle);
    Logger.debug('[CollaborationProtocol] Heartbeat started', {
      sessionId,
      intervalMs,
    });
  }

  // ─── Getters ──────────────────────────────

  getSession(sessionId: string): CollaborationSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionMessages(sessionId: string, limit?: number): ProtocolMessage[] {
    const msgs = this.messageLog.filter((m) => m.sessionId === sessionId);
    return limit !== undefined ? msgs.slice(-limit) : msgs;
  }

  getStats(): CollaborationStats {
    const closedSessions = [...this.sessionMeta.values()].filter(
      (m) => m.closedAt !== undefined,
    );
    const totalDuration = closedSessions.reduce((acc, m) => {
      return acc + (m.closedAt!.getTime() - m.openedAt.getTime());
    }, 0);
    const avgSessionDuration =
      closedSessions.length > 0 ? totalDuration / closedSessions.length : 0;

    return {
      sessions: this.sessions.size,
      messages: this.messageLog.length,
      proposals: this.proposals.size,
      consensusReached: this.consensusReachedCount,
      avgSessionDuration,
    };
  }

  // ─── Private helpers ──────────────────────

  private _resolveProposal(proposal: Proposal): void {
    if (proposal.status !== 'open') return;
    const session = this.sessions.get(proposal.sessionId);
    if (!session) return;

    const totalAgents = session.agentIds.length;
    const totalVotes = proposal.votes.length;
    const yesVotes = proposal.votes.filter((v) => v.vote === 'yes').length;
    const noVotes = proposal.votes.filter((v) => v.vote === 'no').length;

    if (totalAgents === 0) return;

    const yesRatio = yesVotes / totalAgents;
    const noRatio = noVotes / totalAgents;

    // Quorum: either yes or no has passed the threshold, OR all agents voted
    const allVoted = totalVotes >= totalAgents;

    if (yesRatio >= proposal.requiredApprovalPct) {
      proposal.status = 'passed';
    } else if (noRatio >= proposal.requiredApprovalPct) {
      proposal.status = 'rejected';
    } else if (allVoted) {
      // All voted but neither threshold met — majority wins
      proposal.status = yesVotes >= noVotes ? 'passed' : 'rejected';
    } else {
      return; // Not yet resolved
    }

    this.consensusReachedCount++;
    const role = session.roles.get(proposal.proposedBy) ?? AgentRole.EXECUTOR;
    const consensusMsg = this._buildAndLog({
      sessionId: proposal.sessionId,
      fromAgentId: 'system',
      toAgentId: 'broadcast',
      role,
      type: 'consensus',
      payload: {
        proposalId: proposal.id,
        result: proposal.status,
        yesVotes,
        noVotes,
        abstainVotes: proposal.votes.filter((v) => v.vote === 'abstain').length,
      },
      priority: 9,
    });
    Logger.info('[CollaborationProtocol] Consensus reached', {
      proposalId: proposal.id,
      result: proposal.status,
    });
    this.emit('consensus:reached', { proposal, message: consensusMsg });
    this.emit('message', consensusMsg);
  }

  private _signMessage(msg: ProtocolMessage, secret: string): string {
    const data = JSON.stringify({
      id: msg.id,
      sessionId: msg.sessionId,
      fromAgentId: msg.fromAgentId,
      toAgentId: msg.toAgentId,
      type: msg.type,
      timestamp: msg.timestamp.toISOString(),
      payload: msg.payload,
    });
    return createHmac('sha256', secret).update(data).digest('hex');
  }

  private _verifyMessage(msg: ProtocolMessage, secret: string): boolean {
    if (!msg.signature) return false;
    const expected = this._signMessage({ ...msg, signature: undefined }, secret);
    return expected === msg.signature;
  }

  private _buildAndLog(
    partial: Omit<ProtocolMessage, 'id' | 'timestamp'>,
  ): ProtocolMessage {
    const msg: ProtocolMessage = {
      id: randomUUID(),
      timestamp: new Date(),
      ...partial,
    };
    if (this.messageLog.length >= this.MESSAGE_LOG_CAP) {
      this.messageLog.splice(0, 1);
    }
    this.messageLog.push(msg);
    return msg;
  }

  private _requireSession(sessionId: string): CollaborationSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session;
  }

  private _stopHeartbeat(sessionId: string): void {
    const handle = this.heartbeatIntervals.get(sessionId);
    if (handle) {
      clearInterval(handle);
      this.heartbeatIntervals.delete(sessionId);
      Logger.debug('[CollaborationProtocol] Heartbeat stopped', { sessionId });
    }
  }

  // ─── Cleanup ──────────────────────────────

  destroy(): void {
    for (const sessionId of this.heartbeatIntervals.keys()) {
      this._stopHeartbeat(sessionId);
    }
    this.removeAllListeners();
    Logger.info('[CollaborationProtocol] Destroyed');
  }
}
