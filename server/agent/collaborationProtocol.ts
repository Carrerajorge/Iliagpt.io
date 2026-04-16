/**
 * Agent Collaboration Protocol for ILIAGPT PRO 3.0
 * 
 * Protocolo de comunicación estructurada entre agentes:
 * - Mensajes tipados (request, inform, propose, confirm, reject)
 * - Negociación de tareas
 * - Consenso por votación
 * - Delegación con seguimiento
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";

// ============================================
// Types and Interfaces
// ============================================

export type MessageType = 'request' | 'inform' | 'propose' | 'confirm' | 'reject' | 'query' | 'subscribe' | 'cancel';
export type ConversationStatus = 'active' | 'completed' | 'failed' | 'cancelled' | 'timeout';
export type VoteType = 'approve' | 'reject' | 'abstain';

export interface AgentMessage {
    id: string;
    conversationId: string;
    type: MessageType;
    from: string;
    to: string | string[];
    content: any;
    replyTo?: string;
    timestamp: Date;
    metadata: {
        priority: number;
        ttl: number;
        requiresResponse: boolean;
        timeout?: number;
    };
}

export interface Conversation {
    id: string;
    topic: string;
    initiator: string;
    participants: string[];
    messages: AgentMessage[];
    status: ConversationStatus;
    createdAt: Date;
    updatedAt: Date;
    result?: any;
}

export interface TaskDelegation {
    id: string;
    task: any;
    delegator: string;
    delegatee: string;
    status: 'pending' | 'accepted' | 'rejected' | 'in_progress' | 'completed' | 'failed';
    createdAt: Date;
    acceptedAt?: Date;
    completedAt?: Date;
    result?: any;
    feedback?: string;
}

export interface VotingSession {
    id: string;
    topic: string;
    options: string[];
    votes: Map<string, VoteType | string>;
    requiredVotes: number;
    deadline: Date;
    status: 'open' | 'closed' | 'passed' | 'rejected';
    result?: string;
}

export interface AgentCapability {
    id: string;
    name: string;
    description: string;
    tools: string[];
    specialties: string[];
    currentLoad: number;
    maxLoad: number;
    performance: {
        successRate: number;
        avgResponseTime: number;
        tasksCompleted: number;
    };
}

export interface AgentRegistry {
    agents: Map<string, AgentCapability>;
    subscriptions: Map<string, Set<string>>; // topic -> agent IDs
}

// ============================================
// Collaboration Protocol Class
// ============================================

export class CollaborationProtocol extends EventEmitter {
    private conversations: Map<string, Conversation>;
    private delegations: Map<string, TaskDelegation>;
    private votingSessions: Map<string, VotingSession>;
    private registry: AgentRegistry;
    private messageQueue: AgentMessage[];
    private responseTimeouts: Map<string, NodeJS.Timeout>;

    // Configuration
    private defaultTimeout: number;
    private maxMessagesPerConversation: number;

    constructor(options: {
        defaultTimeout?: number;
        maxMessagesPerConversation?: number;
    } = {}) {
        super();

        this.conversations = new Map();
        this.delegations = new Map();
        this.votingSessions = new Map();
        this.registry = {
            agents: new Map(),
            subscriptions: new Map()
        };
        this.messageQueue = [];
        this.responseTimeouts = new Map();

        this.defaultTimeout = options.defaultTimeout || 30000;
        this.maxMessagesPerConversation = options.maxMessagesPerConversation || 100;
    }

    // ============================================
    // Agent Registration
    // ============================================

    /**
     * Register an agent with its capabilities
     */
    registerAgent(agentId: string, capability: Omit<AgentCapability, 'id'>): void {
        this.registry.agents.set(agentId, {
            ...capability,
            id: agentId
        });
        this.emit("agent:registered", { agentId, capability });
    }

    /**
     * Unregister an agent
     */
    unregisterAgent(agentId: string): void {
        this.registry.agents.delete(agentId);

        // Remove from all subscriptions
        for (const [topic, subscribers] of this.registry.subscriptions) {
            subscribers.delete(agentId);
        }

        this.emit("agent:unregistered", { agentId });
    }

    /**
     * Get agent capability
     */
    getAgent(agentId: string): AgentCapability | undefined {
        return this.registry.agents.get(agentId);
    }

    /**
     * Find agents by capability
     */
    findAgentsByCapability(capability: string): AgentCapability[] {
        return Array.from(this.registry.agents.values())
            .filter(a =>
                a.tools.includes(capability) ||
                a.specialties.includes(capability) ||
                a.name.toLowerCase().includes(capability.toLowerCase())
            )
            .sort((a, b) => {
                // Sort by availability and performance
                const aScore = (1 - a.currentLoad / a.maxLoad) * a.performance.successRate;
                const bScore = (1 - b.currentLoad / b.maxLoad) * b.performance.successRate;
                return bScore - aScore;
            });
    }

    /**
     * Subscribe agent to a topic
     */
    subscribe(agentId: string, topic: string): void {
        if (!this.registry.subscriptions.has(topic)) {
            this.registry.subscriptions.set(topic, new Set());
        }
        this.registry.subscriptions.get(topic)!.add(agentId);
    }

    /**
     * Unsubscribe agent from a topic
     */
    unsubscribe(agentId: string, topic: string): void {
        this.registry.subscriptions.get(topic)?.delete(agentId);
    }

    // ============================================
    // Messaging
    // ============================================

    /**
     * Send a message to one or more agents
     */
    async sendMessage(
        from: string,
        to: string | string[],
        type: MessageType,
        content: any,
        options: {
            conversationId?: string;
            replyTo?: string;
            priority?: number;
            timeout?: number;
            requiresResponse?: boolean;
        } = {}
    ): Promise<AgentMessage> {
        const conversationId = options.conversationId || this.getOrCreateConversation(from, to);

        const message: AgentMessage = {
            id: randomUUID(),
            conversationId,
            type,
            from,
            to,
            content,
            replyTo: options.replyTo,
            timestamp: new Date(),
            metadata: {
                priority: options.priority || 5,
                ttl: options.timeout || this.defaultTimeout,
                requiresResponse: options.requiresResponse ?? (type === 'request' || type === 'query'),
                timeout: options.timeout
            }
        };

        // Add to conversation
        const conversation = this.conversations.get(conversationId);
        if (conversation) {
            conversation.messages.push(message);
            conversation.updatedAt = new Date();

            // Trim old messages if needed
            if (conversation.messages.length > this.maxMessagesPerConversation) {
                conversation.messages = conversation.messages.slice(-this.maxMessagesPerConversation);
            }
        }

        // Queue message for delivery
        this.messageQueue.push(message);

        // Set timeout for response if needed
        if (message.metadata.requiresResponse && message.metadata.timeout) {
            this.setResponseTimeout(message);
        }

        this.emit("message:sent", message);
        this.emit(`message:${type}`, message);

        // Deliver to recipients
        await this.deliverMessage(message);

        return message;
    }

    /**
     * Broadcast a message to all subscribers of a topic
     */
    async broadcast(from: string, topic: string, content: any): Promise<AgentMessage[]> {
        const subscribers = this.registry.subscriptions.get(topic);
        if (!subscribers || subscribers.size === 0) {
            return [];
        }

        const messages: AgentMessage[] = [];
        for (const agentId of subscribers) {
            if (agentId !== from) {
                const msg = await this.sendMessage(from, agentId, 'inform', content, {
                    requiresResponse: false
                });
                messages.push(msg);
            }
        }

        return messages;
    }

    /**
     * Reply to a message
     */
    async reply(
        originalMessage: AgentMessage,
        from: string,
        type: MessageType,
        content: any
    ): Promise<AgentMessage> {
        return this.sendMessage(
            from,
            originalMessage.from,
            type,
            content,
            {
                conversationId: originalMessage.conversationId,
                replyTo: originalMessage.id,
                requiresResponse: false
            }
        );
    }

    private async deliverMessage(message: AgentMessage): Promise<void> {
        const recipients = Array.isArray(message.to) ? message.to : [message.to];

        for (const recipientId of recipients) {
            this.emit(`agent:${recipientId}:message`, message);
        }
    }

    private setResponseTimeout(message: AgentMessage): void {
        const timeout = setTimeout(() => {
            this.emit("message:timeout", { messageId: message.id, conversationId: message.conversationId });

            const conversation = this.conversations.get(message.conversationId);
            if (conversation && conversation.status === 'active') {
                conversation.status = 'timeout';
            }
        }, message.metadata.timeout || this.defaultTimeout);

        this.responseTimeouts.set(message.id, timeout);
    }

    // ============================================
    // Conversations
    // ============================================

    private getOrCreateConversation(initiator: string, participants: string | string[]): string {
        const participantList = Array.isArray(participants) ? participants : [participants];
        const allParticipants = [initiator, ...participantList];

        // Check if conversation already exists
        for (const [id, conv] of this.conversations) {
            if (conv.status === 'active' &&
                conv.participants.length === allParticipants.length &&
                allParticipants.every(p => conv.participants.includes(p))) {
                return id;
            }
        }

        // Create new conversation
        const conversation: Conversation = {
            id: randomUUID(),
            topic: '',
            initiator,
            participants: allParticipants,
            messages: [],
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        this.conversations.set(conversation.id, conversation);
        this.emit("conversation:created", conversation);

        return conversation.id;
    }

    /**
     * Get conversation by ID
     */
    getConversation(conversationId: string): Conversation | undefined {
        return this.conversations.get(conversationId);
    }

    /**
     * Close a conversation
     */
    closeConversation(conversationId: string, result?: any): void {
        const conversation = this.conversations.get(conversationId);
        if (conversation) {
            conversation.status = 'completed';
            conversation.result = result;
            conversation.updatedAt = new Date();
            this.emit("conversation:closed", { conversationId, result });
        }
    }

    // ============================================
    // Task Delegation
    // ============================================

    /**
     * Delegate a task to another agent
     */
    async delegateTask(
        delegator: string,
        delegatee: string,
        task: any,
        options: {
            timeout?: number;
            onProgress?: (progress: number) => void;
        } = {}
    ): Promise<TaskDelegation> {
        const delegation: TaskDelegation = {
            id: randomUUID(),
            task,
            delegator,
            delegatee,
            status: 'pending',
            createdAt: new Date()
        };

        this.delegations.set(delegation.id, delegation);

        // Send delegation request
        await this.sendMessage(delegator, delegatee, 'request', {
            type: 'task_delegation',
            delegationId: delegation.id,
            task
        }, {
            timeout: options.timeout,
            requiresResponse: true
        });

        this.emit("delegation:created", delegation);

        return delegation;
    }

    /**
     * Accept a task delegation
     */
    async acceptDelegation(delegationId: string): Promise<void> {
        const delegation = this.delegations.get(delegationId);
        if (!delegation) throw new Error("Delegation not found");

        delegation.status = 'accepted';
        delegation.acceptedAt = new Date();

        await this.sendMessage(delegation.delegatee, delegation.delegator, 'confirm', {
            type: 'delegation_accepted',
            delegationId
        });

        this.emit("delegation:accepted", delegation);
    }

    /**
     * Reject a task delegation
     */
    async rejectDelegation(delegationId: string, reason: string): Promise<void> {
        const delegation = this.delegations.get(delegationId);
        if (!delegation) throw new Error("Delegation not found");

        delegation.status = 'rejected';
        delegation.feedback = reason;

        await this.sendMessage(delegation.delegatee, delegation.delegator, 'reject', {
            type: 'delegation_rejected',
            delegationId,
            reason
        });

        this.emit("delegation:rejected", delegation);
    }

    /**
     * Complete a task delegation
     */
    async completeDelegation(delegationId: string, result: any): Promise<void> {
        const delegation = this.delegations.get(delegationId);
        if (!delegation) throw new Error("Delegation not found");

        delegation.status = 'completed';
        delegation.completedAt = new Date();
        delegation.result = result;

        await this.sendMessage(delegation.delegatee, delegation.delegator, 'inform', {
            type: 'delegation_completed',
            delegationId,
            result
        });

        this.emit("delegation:completed", delegation);
    }

    /**
     * Find best agent for a task
     */
    findBestAgentForTask(task: any): AgentCapability | undefined {
        const requiredCapabilities = task.requiredCapabilities || [task.type];

        let bestAgent: AgentCapability | undefined;
        let bestScore = -1;

        for (const agent of this.registry.agents.values()) {
            // Check if agent has required capabilities
            const hasCapabilities = requiredCapabilities.every((cap: string) =>
                agent.tools.includes(cap) || agent.specialties.some(s => s.includes(cap))
            );

            if (!hasCapabilities) continue;

            // Calculate score based on availability and performance
            const availability = 1 - (agent.currentLoad / agent.maxLoad);
            const score = availability * agent.performance.successRate;

            if (score > bestScore) {
                bestScore = score;
                bestAgent = agent;
            }
        }

        return bestAgent;
    }

    // ============================================
    // Voting
    // ============================================

    /**
     * Start a voting session
     */
    startVoting(
        topic: string,
        options: string[],
        voters: string[],
        deadline: Date
    ): VotingSession {
        const session: VotingSession = {
            id: randomUUID(),
            topic,
            options,
            votes: new Map(),
            requiredVotes: Math.ceil(voters.length / 2), // Simple majority
            deadline,
            status: 'open'
        };

        this.votingSessions.set(session.id, session);

        // Notify voters
        for (const voter of voters) {
            this.sendMessage('system', voter, 'request', {
                type: 'vote_request',
                sessionId: session.id,
                topic,
                options,
                deadline: deadline.toISOString()
            }, { requiresResponse: true });
        }

        // Set deadline timeout
        setTimeout(() => {
            this.closeVoting(session.id);
        }, deadline.getTime() - Date.now());

        this.emit("voting:started", session);

        return session;
    }

    /**
     * Cast a vote
     */
    castVote(sessionId: string, agentId: string, vote: VoteType | string): boolean {
        const session = this.votingSessions.get(sessionId);
        if (!session || session.status !== 'open') return false;

        session.votes.set(agentId, vote);
        this.emit("voting:voteCast", { sessionId, agentId, vote });

        // Check if we have enough votes
        if (session.votes.size >= session.requiredVotes) {
            this.closeVoting(sessionId);
        }

        return true;
    }

    /**
     * Close voting and calculate result
     */
    closeVoting(sessionId: string): VotingSession | undefined {
        const session = this.votingSessions.get(sessionId);
        if (!session || session.status !== 'open') return undefined;

        // Count votes
        const voteCounts = new Map<string, number>();
        for (const vote of session.votes.values()) {
            if (vote !== 'abstain') {
                voteCounts.set(vote, (voteCounts.get(vote) || 0) + 1);
            }
        }

        // Find winner
        let maxVotes = 0;
        let winner: string | undefined;
        for (const [option, count] of voteCounts) {
            if (count > maxVotes) {
                maxVotes = count;
                winner = option;
            }
        }

        session.status = maxVotes >= session.requiredVotes ? 'passed' : 'rejected';
        session.result = winner;

        this.emit("voting:closed", session);

        return session;
    }

    // ============================================
    // Negotiation
    // ============================================

    /**
     * Start a negotiation between agents
     */
    async negotiate(
        initiator: string,
        participants: string[],
        proposal: any,
        options: {
            maxRounds?: number;
            timeout?: number;
        } = {}
    ): Promise<{ success: boolean; finalProposal: any; history: any[] }> {
        const maxRounds = options.maxRounds || 5;
        const conversationId = this.getOrCreateConversation(initiator, participants);
        const history: any[] = [];

        let currentProposal = proposal;
        let round = 0;

        while (round < maxRounds) {
            round++;

            // Send proposal to all participants
            const responses: { agent: string; accepted: boolean; counter?: any }[] = [];

            for (const participant of participants) {
                await this.sendMessage(initiator, participant, 'propose', {
                    round,
                    proposal: currentProposal
                }, { conversationId, timeout: options.timeout });

                // Simulated response - in real implementation, wait for actual responses
                responses.push({
                    agent: participant,
                    accepted: Math.random() > 0.3, // Simulated acceptance
                    counter: undefined
                });
            }

            history.push({ round, proposal: currentProposal, responses });

            // Check if all accepted
            if (responses.every(r => r.accepted)) {
                this.closeConversation(conversationId, { accepted: true, proposal: currentProposal });
                return { success: true, finalProposal: currentProposal, history };
            }

            // Merge counter-proposals
            const counterProposals = responses.filter(r => r.counter).map(r => r.counter);
            if (counterProposals.length > 0) {
                // Simple merge strategy - take first counter
                currentProposal = counterProposals[0];
            } else {
                break;
            }
        }

        this.closeConversation(conversationId, { accepted: false });
        return { success: false, finalProposal: currentProposal, history };
    }

    // ============================================
    // Statistics
    // ============================================

    getStats(): {
        registeredAgents: number;
        activeConversations: number;
        pendingDelegations: number;
        openVotingSessions: number;
        messageQueue: number;
    } {
        return {
            registeredAgents: this.registry.agents.size,
            activeConversations: Array.from(this.conversations.values()).filter(c => c.status === 'active').length,
            pendingDelegations: Array.from(this.delegations.values()).filter(d => d.status === 'pending' || d.status === 'in_progress').length,
            openVotingSessions: Array.from(this.votingSessions.values()).filter(v => v.status === 'open').length,
            messageQueue: this.messageQueue.length
        };
    }

    /**
     * Clean up old data
     */
    cleanup(maxAge: number = 3600000): void {
        const now = Date.now();

        // Clean old conversations
        for (const [id, conv] of this.conversations) {
            if (conv.status !== 'active' && now - conv.updatedAt.getTime() > maxAge) {
                this.conversations.delete(id);
            }
        }

        // Clean old delegations
        for (const [id, del] of this.delegations) {
            if ((del.status === 'completed' || del.status === 'failed' || del.status === 'rejected') &&
                del.createdAt && now - del.createdAt.getTime() > maxAge) {
                this.delegations.delete(id);
            }
        }

        // Clean old voting sessions
        for (const [id, session] of this.votingSessions) {
            if (session.status !== 'open' && now - session.deadline.getTime() > maxAge) {
                this.votingSessions.delete(id);
            }
        }
    }
}

// Singleton instance
let collaborationInstance: CollaborationProtocol | null = null;

export function getCollaborationProtocol(): CollaborationProtocol {
    if (!collaborationInstance) {
        collaborationInstance = new CollaborationProtocol();
    }
    return collaborationInstance;
}

export default CollaborationProtocol;
