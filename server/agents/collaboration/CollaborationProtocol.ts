import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { WebSocket, WebSocketServer } from "ws";
import pino from "pino";

const logger = pino({ name: "CollaborationProtocol" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentRole = "leader" | "worker" | "reviewer" | "observer";

export type MessageType =
  | "hello"
  | "goodbye"
  | "role_assign"
  | "task_propose"
  | "task_accept"
  | "task_reject"
  | "task_bid"
  | "task_award"
  | "task_start"
  | "task_complete"
  | "task_fail"
  | "artifact_created"
  | "artifact_updated"
  | "review_request"
  | "review_result"
  | "conflict"
  | "vote_call"
  | "vote_cast"
  | "consensus"
  | "heartbeat"
  | "broadcast";

export interface CollabMessage {
  messageId: string;
  swarmId: string;
  from: string; // agentId
  to: string | "broadcast"; // agentId or "broadcast"
  type: MessageType;
  payload: unknown;
  timestamp: number;
  correlationId?: string; // for request-response pairs
  ttl?: number; // message expiry timestamp
}

export interface AgentSession {
  agentId: string;
  swarmId: string;
  role: AgentRole;
  capabilities: string[];
  currentLoad: number; // 0-1
  joinedAt: number;
  lastHeartbeatAt: number;
  socket?: WebSocket;
}

export interface SwarmState {
  swarmId: string;
  name: string;
  leaderId: string | null;
  agents: Map<string, AgentSession>;
  createdAt: number;
  taskCount: number;
  completedTaskCount: number;
  sharedContext: Record<string, unknown>;
}

export type ConsensusAlgorithm = "majority_vote" | "weighted_vote" | "leader_decides" | "unanimous";

export interface VoteSession {
  voteId: string;
  swarmId: string;
  topic: string;
  options: string[];
  algorithm: ConsensusAlgorithm;
  votes: Map<string, string>; // agentId → chosen option
  weights: Map<string, number>; // agentId → weight (for weighted_vote)
  requiredParticipants: number;
  deadline: number;
  result?: string;
  decidedAt?: number;
}

// ─── CollaborationProtocol ────────────────────────────────────────────────────

export class CollaborationProtocol extends EventEmitter {
  private swarms = new Map<string, SwarmState>();
  private sessions = new Map<string, AgentSession>(); // agentId → session
  private voteSessions = new Map<string, VoteSession>();
  private messageLog: CollabMessage[] = [];
  private wss?: WebSocketServer;

  /** Heartbeat interval in ms — agents not beating for 3× this are considered offline */
  private readonly heartbeatIntervalMs = 10_000;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(private readonly port?: number) {
    super();

    if (port) {
      this.wss = new WebSocketServer({ port });
      this.wss.on("connection", this.handleConnection.bind(this));
      logger.info({ port }, "[CollabProtocol] WebSocket server started");
    }

    this.heartbeatTimer = setInterval(
      this.checkHeartbeats.bind(this),
      this.heartbeatIntervalMs * 2
    );
  }

  // ── Swarm management ──────────────────────────────────────────────────────────

  createSwarm(name: string): SwarmState {
    const swarmId = randomUUID();
    const swarm: SwarmState = {
      swarmId,
      name,
      leaderId: null,
      agents: new Map(),
      createdAt: Date.now(),
      taskCount: 0,
      completedTaskCount: 0,
      sharedContext: {},
    };
    this.swarms.set(swarmId, swarm);
    logger.info({ swarmId, name }, "[CollabProtocol] Swarm created");
    this.emit("swarm:created", { swarmId, name });
    return swarm;
  }

  joinSwarm(
    swarmId: string,
    agentId: string,
    capabilities: string[],
    role: AgentRole = "worker",
    socket?: WebSocket
  ): AgentSession {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error(`Swarm '${swarmId}' not found`);

    const session: AgentSession = {
      agentId,
      swarmId,
      role,
      capabilities,
      currentLoad: 0,
      joinedAt: Date.now(),
      lastHeartbeatAt: Date.now(),
      socket,
    };

    swarm.agents.set(agentId, session);
    this.sessions.set(agentId, session);

    // Auto-elect leader if none exists
    if (!swarm.leaderId && role !== "observer") {
      this.electLeader(swarmId);
    }

    this.broadcast(swarmId, {
      from: agentId,
      type: "hello",
      payload: { agentId, capabilities, role },
    }, agentId);

    logger.info({ swarmId, agentId, role }, "[CollabProtocol] Agent joined swarm");
    this.emit("agent:joined", { swarmId, agentId, role });
    return session;
  }

  leaveSwarm(swarmId: string, agentId: string): void {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) return;

    swarm.agents.delete(agentId);
    this.sessions.delete(agentId);

    this.broadcast(swarmId, {
      from: agentId,
      type: "goodbye",
      payload: { agentId },
    }, agentId);

    // Re-elect leader if the leader left
    if (swarm.leaderId === agentId) {
      swarm.leaderId = null;
      this.electLeader(swarmId);
    }

    logger.info({ swarmId, agentId }, "[CollabProtocol] Agent left swarm");
    this.emit("agent:left", { swarmId, agentId });
  }

  // ── Leadership ────────────────────────────────────────────────────────────────

  private electLeader(swarmId: string): void {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) return;

    // Simple election: pick the worker/reviewer with lowest agentId (deterministic)
    const candidates = Array.from(swarm.agents.values()).filter(
      (a) => a.role !== "observer"
    );
    if (!candidates.length) return;

    candidates.sort((a, b) => a.agentId.localeCompare(b.agentId));
    const newLeader = candidates[0];

    swarm.leaderId = newLeader.agentId;
    newLeader.role = "leader";
    swarm.agents.set(newLeader.agentId, newLeader);

    this.broadcast(swarmId, {
      from: "system",
      type: "role_assign",
      payload: { agentId: newLeader.agentId, role: "leader" },
    });

    logger.info(
      { swarmId, leaderId: newLeader.agentId },
      "[CollabProtocol] Leader elected"
    );
    this.emit("leader:elected", { swarmId, leaderId: newLeader.agentId });
  }

  // ── Messaging ─────────────────────────────────────────────────────────────────

  send(message: Omit<CollabMessage, "messageId" | "timestamp">): CollabMessage {
    const fullMessage: CollabMessage = {
      ...message,
      messageId: randomUUID(),
      timestamp: Date.now(),
    };

    this.messageLog.push(fullMessage);
    if (this.messageLog.length > 10_000) this.messageLog.shift();

    this.deliverMessage(fullMessage);
    this.emit("message:sent", fullMessage);
    return fullMessage;
  }

  broadcast(
    swarmId: string,
    partial: Omit<CollabMessage, "messageId" | "timestamp" | "swarmId" | "to">,
    excludeAgentId?: string
  ): void {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) return;

    const message = this.send({ ...partial, swarmId, to: "broadcast" });

    for (const [agentId, session] of swarm.agents.entries()) {
      if (agentId === excludeAgentId) continue;
      if (session.socket?.readyState === WebSocket.OPEN) {
        session.socket.send(JSON.stringify(message));
      }
    }
  }

  private deliverMessage(message: CollabMessage): void {
    if (message.to === "broadcast") {
      const swarm = this.swarms.get(message.swarmId);
      if (swarm) {
        for (const session of swarm.agents.values()) {
          if (session.agentId !== message.from && session.socket?.readyState === WebSocket.OPEN) {
            session.socket.send(JSON.stringify(message));
          }
        }
      }
    } else {
      const target = this.sessions.get(message.to);
      if (target?.socket?.readyState === WebSocket.OPEN) {
        target.socket.send(JSON.stringify(message));
      }
    }
    this.emit(`message:${message.type}`, message);
  }

  // ── Voting / consensus ────────────────────────────────────────────────────────

  initiateVote(
    swarmId: string,
    topic: string,
    options: string[],
    algorithm: ConsensusAlgorithm = "majority_vote",
    timeoutMs = 30_000
  ): VoteSession {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error(`Swarm '${swarmId}' not found`);

    const voters = Array.from(swarm.agents.values()).filter(
      (a) => a.role !== "observer"
    );
    const weights = new Map(voters.map((a) => [a.agentId, 1 - a.currentLoad]));

    const voteSession: VoteSession = {
      voteId: randomUUID(),
      swarmId,
      topic,
      options,
      algorithm,
      votes: new Map(),
      weights,
      requiredParticipants: Math.ceil(voters.length * 0.5) + 1, // simple majority
      deadline: Date.now() + timeoutMs,
    };

    this.voteSessions.set(voteSession.voteId, voteSession);

    this.broadcast(swarmId, {
      from: "system",
      type: "vote_call",
      payload: {
        voteId: voteSession.voteId,
        topic,
        options,
        algorithm,
        deadline: voteSession.deadline,
      },
    });

    // Auto-resolve when deadline passes
    setTimeout(() => {
      this.resolveVote(voteSession.voteId);
    }, timeoutMs);

    logger.info({ voteId: voteSession.voteId, topic }, "[CollabProtocol] Vote initiated");
    return voteSession;
  }

  castVote(voteId: string, agentId: string, option: string): void {
    const vote = this.voteSessions.get(voteId);
    if (!vote) throw new Error(`Vote '${voteId}' not found`);
    if (Date.now() > vote.deadline) throw new Error(`Vote '${voteId}' has expired`);
    if (!vote.options.includes(option)) {
      throw new Error(`Option '${option}' is not valid for vote '${voteId}'`);
    }

    vote.votes.set(agentId, option);

    this.send({
      swarmId: vote.swarmId,
      from: agentId,
      to: "broadcast",
      type: "vote_cast",
      payload: { voteId, agentId, option },
      correlationId: voteId,
    });

    // Check if we have enough votes
    if (vote.votes.size >= vote.requiredParticipants) {
      this.resolveVote(voteId);
    }
  }

  private resolveVote(voteId: string): void {
    const vote = this.voteSessions.get(voteId);
    if (!vote || vote.result) return; // already resolved

    const tally = new Map<string, number>();

    for (const [agentId, option] of vote.votes.entries()) {
      const weight =
        vote.algorithm === "weighted_vote"
          ? (vote.weights.get(agentId) ?? 1)
          : 1;
      tally.set(option, (tally.get(option) ?? 0) + weight);
    }

    if (tally.size === 0) {
      vote.result = vote.options[0]; // fallback to first option
    } else {
      vote.result = Array.from(tally.entries()).sort(([, a], [, b]) => b - a)[0][0];
    }

    vote.decidedAt = Date.now();

    this.broadcast(vote.swarmId, {
      from: "system",
      type: "consensus",
      payload: {
        voteId,
        result: vote.result,
        tally: Object.fromEntries(tally),
        algorithm: vote.algorithm,
      },
    });

    logger.info(
      { voteId, result: vote.result },
      "[CollabProtocol] Vote resolved"
    );
    this.emit("vote:resolved", { voteId, result: vote.result });
  }

  // ── Heartbeat ────────────────────────────────────────────────────────────────

  heartbeat(agentId: string): void {
    const session = this.sessions.get(agentId);
    if (!session) return;
    session.lastHeartbeatAt = Date.now();

    this.send({
      swarmId: session.swarmId,
      from: agentId,
      to: "broadcast",
      type: "heartbeat",
      payload: { agentId, load: session.currentLoad },
    });
  }

  updateLoad(agentId: string, load: number): void {
    const session = this.sessions.get(agentId);
    if (!session) return;
    session.currentLoad = Math.max(0, Math.min(1, load));
  }

  private checkHeartbeats(): void {
    const staleThreshold = Date.now() - this.heartbeatIntervalMs * 3;

    for (const [agentId, session] of this.sessions.entries()) {
      if (session.lastHeartbeatAt < staleThreshold) {
        logger.warn(
          { agentId, swarmId: session.swarmId },
          "[CollabProtocol] Agent heartbeat timeout, removing"
        );
        this.leaveSwarm(session.swarmId, agentId);
      }
    }
  }

  // ── WebSocket connection handler ──────────────────────────────────────────────

  private handleConnection(ws: WebSocket): void {
    let agentId: string | null = null;
    let swarmId: string | null = null;

    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as {
          type: string;
          agentId?: string;
          swarmId?: string;
          capabilities?: string[];
          role?: AgentRole;
          payload?: unknown;
        };

        if (msg.type === "hello" && msg.agentId && msg.swarmId) {
          agentId = msg.agentId;
          swarmId = msg.swarmId;

          if (!this.swarms.has(swarmId)) {
            this.createSwarm(`swarm-${swarmId}`);
          }

          this.joinSwarm(
            swarmId,
            agentId,
            msg.capabilities ?? [],
            msg.role ?? "worker",
            ws
          );
        } else if (msg.type === "heartbeat" && agentId) {
          this.heartbeat(agentId);
        } else if (msg.type === "vote_cast" && agentId && typeof msg.payload === "object") {
          const { voteId, option } = msg.payload as { voteId: string; option: string };
          this.castVote(voteId, agentId, option);
        }
      } catch (err) {
        logger.error({ err }, "[CollabProtocol] Failed to parse WebSocket message");
      }
    });

    ws.on("close", () => {
      if (agentId && swarmId) {
        this.leaveSwarm(swarmId, agentId);
      }
    });
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getSwarm(swarmId: string): SwarmState | undefined {
    return this.swarms.get(swarmId);
  }

  getAgentSession(agentId: string): AgentSession | undefined {
    return this.sessions.get(agentId);
  }

  getSwarmAgents(swarmId: string): AgentSession[] {
    return Array.from(this.swarms.get(swarmId)?.agents.values() ?? []);
  }

  getMessageHistory(swarmId: string, limit = 100): CollabMessage[] {
    return this.messageLog
      .filter((m) => m.swarmId === swarmId)
      .slice(-limit);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  shutdown(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.wss?.close();
    this.removeAllListeners();
    logger.info("[CollabProtocol] Shutdown complete");
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────
let _protocol: CollaborationProtocol | null = null;
export function getCollaborationProtocol(port?: number): CollaborationProtocol {
  if (!_protocol) _protocol = new CollaborationProtocol(port);
  return _protocol;
}
