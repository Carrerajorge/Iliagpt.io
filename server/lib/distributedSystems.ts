/**
 * Distributed Systems Infrastructure
 * Tasks 31-45: Microservices, Service Discovery, Load Balancing
 * 
 * Provides the foundation for horizontal scalability
 */

import { EventEmitter } from 'events';
import { Logger } from './logger';
import crypto from 'crypto';

// ============================================================================
// Task 31-32: Service Discovery & Registry
// ============================================================================

interface ServiceInstance {
    id: string;
    name: string;
    host: string;
    port: number;
    metadata: Record<string, string>;
    healthEndpoint?: string;
    weight: number;
    status: 'healthy' | 'unhealthy' | 'draining';
    lastHeartbeat: Date;
    version?: string;
}

interface ServiceRegistration {
    name: string;
    host: string;
    port: number;
    metadata?: Record<string, string>;
    healthEndpoint?: string;
    weight?: number;
    version?: string;
    ttlSeconds?: number;
}

class ServiceDiscovery extends EventEmitter {
    private services: Map<string, Map<string, ServiceInstance>> = new Map();
    private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
    private cleanupInterval: NodeJS.Timeout | null = null;
    private ttlMs = 30000;

    constructor() {
        super();
        this.startCleanup();
    }

    /**
     * Register a service instance
     */
    register(registration: ServiceRegistration): string {
        const instanceId = `${registration.name}-${crypto.randomUUID().slice(0, 8)}`;

        const instance: ServiceInstance = {
            id: instanceId,
            name: registration.name,
            host: registration.host,
            port: registration.port,
            metadata: registration.metadata ?? {},
            healthEndpoint: registration.healthEndpoint,
            weight: registration.weight ?? 1,
            status: 'healthy',
            lastHeartbeat: new Date(),
            version: registration.version,
        };

        if (!this.services.has(registration.name)) {
            this.services.set(registration.name, new Map());
        }

        this.services.get(registration.name)!.set(instanceId, instance);
        Logger.info(`[ServiceDiscovery] Registered ${registration.name}@${registration.host}:${registration.port} (${instanceId})`);

        this.emit('registered', instance);
        return instanceId;
    }

    /**
     * Deregister a service instance
     */
    deregister(serviceName: string, instanceId: string): boolean {
        const instances = this.services.get(serviceName);
        if (!instances) return false;

        const instance = instances.get(instanceId);
        if (!instance) return false;

        instances.delete(instanceId);
        Logger.info(`[ServiceDiscovery] Deregistered ${serviceName} (${instanceId})`);

        this.emit('deregistered', instance);
        return true;
    }

    /**
     * Update heartbeat for an instance
     */
    heartbeat(serviceName: string, instanceId: string): boolean {
        const instances = this.services.get(serviceName);
        const instance = instances?.get(instanceId);

        if (instance) {
            instance.lastHeartbeat = new Date();
            instance.status = 'healthy';
            return true;
        }
        return false;
    }

    /**
     * Get all healthy instances of a service
     */
    getInstances(serviceName: string): ServiceInstance[] {
        const instances = this.services.get(serviceName);
        if (!instances) return [];

        return Array.from(instances.values())
            .filter(i => i.status === 'healthy');
    }

    /**
     * Get a single instance using load balancing strategy
     */
    getInstance(serviceName: string, strategy: 'round-robin' | 'random' | 'weighted' = 'round-robin'): ServiceInstance | null {
        const instances = this.getInstances(serviceName);
        if (instances.length === 0) return null;

        switch (strategy) {
            case 'random':
                return instances[Math.floor(Math.random() * instances.length)];

            case 'weighted':
                return this.weightedSelect(instances);

            case 'round-robin':
            default:
                // Simple round-robin using timestamp
                const index = Date.now() % instances.length;
                return instances[index];
        }
    }

    private weightedSelect(instances: ServiceInstance[]): ServiceInstance {
        const totalWeight = instances.reduce((sum, i) => sum + i.weight, 0);
        let random = Math.random() * totalWeight;

        for (const instance of instances) {
            random -= instance.weight;
            if (random <= 0) return instance;
        }

        return instances[instances.length - 1];
    }

    /**
     * Mark instance as draining (preparing for shutdown)
     */
    drain(serviceName: string, instanceId: string): boolean {
        const instances = this.services.get(serviceName);
        const instance = instances?.get(instanceId);

        if (instance) {
            instance.status = 'draining';
            this.emit('draining', instance);
            return true;
        }
        return false;
    }

    private startCleanup(): void {
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();

            for (const [serviceName, instances] of this.services) {
                for (const [instanceId, instance] of instances) {
                    const age = now - instance.lastHeartbeat.getTime();

                    if (age > this.ttlMs && instance.status !== 'draining') {
                        instance.status = 'unhealthy';
                        this.emit('unhealthy', instance);

                        // Remove after 3x TTL
                        if (age > this.ttlMs * 3) {
                            instances.delete(instanceId);
                            Logger.warn(`[ServiceDiscovery] Removed stale instance ${serviceName} (${instanceId})`);
                            this.emit('removed', instance);
                        }
                    }
                }
            }
        }, 10000);

        this.cleanupInterval.unref();
    }

    getAllServices(): Record<string, ServiceInstance[]> {
        const result: Record<string, ServiceInstance[]> = {};
        for (const [name, instances] of this.services) {
            result[name] = Array.from(instances.values());
        }
        return result;
    }

    shutdown(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        for (const interval of this.heartbeatIntervals.values()) {
            clearInterval(interval);
        }
    }
}

export const serviceDiscovery = new ServiceDiscovery();

// ============================================================================
// Task 33: Intelligent Load Balancer
// ============================================================================

interface LoadBalancerConfig {
    algorithm: 'round-robin' | 'least-connections' | 'weighted' | 'ip-hash' | 'adaptive';
    healthCheckInterval: number;
    unhealthyThreshold: number;
    healthyThreshold: number;
}

interface BackendStats {
    activeConnections: number;
    totalRequests: number;
    failedRequests: number;
    avgResponseTime: number;
    lastResponseTimes: number[];
}

class LoadBalancer extends EventEmitter {
    private config: LoadBalancerConfig;
    private backendStats: Map<string, BackendStats> = new Map();
    private rrIndex = 0;

    constructor(config: Partial<LoadBalancerConfig> = {}) {
        super();
        this.config = {
            algorithm: config.algorithm ?? 'adaptive',
            healthCheckInterval: config.healthCheckInterval ?? 10000,
            unhealthyThreshold: config.unhealthyThreshold ?? 3,
            healthyThreshold: config.healthyThreshold ?? 2,
        };
    }

    /**
     * Select a backend instance for a request
     */
    select(serviceName: string, clientInfo?: { ip?: string }): ServiceInstance | null {
        const instances = serviceDiscovery.getInstances(serviceName);
        if (instances.length === 0) return null;

        switch (this.config.algorithm) {
            case 'round-robin':
                return this.roundRobin(instances);

            case 'least-connections':
                return this.leastConnections(instances);

            case 'weighted':
                return this.weighted(instances);

            case 'ip-hash':
                return this.ipHash(instances, clientInfo?.ip ?? 'default');

            case 'adaptive':
            default:
                return this.adaptive(instances);
        }
    }

    private roundRobin(instances: ServiceInstance[]): ServiceInstance {
        this.rrIndex = (this.rrIndex + 1) % instances.length;
        return instances[this.rrIndex];
    }

    private leastConnections(instances: ServiceInstance[]): ServiceInstance {
        return instances.reduce((min, instance) => {
            const stats = this.getStats(instance.id);
            const minStats = this.getStats(min.id);
            return stats.activeConnections < minStats.activeConnections ? instance : min;
        });
    }

    private weighted(instances: ServiceInstance[]): ServiceInstance {
        const totalWeight = instances.reduce((sum, i) => sum + i.weight, 0);
        let random = Math.random() * totalWeight;

        for (const instance of instances) {
            random -= instance.weight;
            if (random <= 0) return instance;
        }

        return instances[instances.length - 1];
    }

    private ipHash(instances: ServiceInstance[], ip: string): ServiceInstance {
        const hash = crypto.createHash('md5').update(ip).digest('hex');
        const index = parseInt(hash.slice(0, 8), 16) % instances.length;
        return instances[index];
    }

    private adaptive(instances: ServiceInstance[]): ServiceInstance {
        // Score each instance based on response time and connections
        const scored = instances.map(instance => {
            const stats = this.getStats(instance.id);
            const responseScore = stats.avgResponseTime > 0 ? 1000 / stats.avgResponseTime : 100;
            const connectionScore = 10 / (stats.activeConnections + 1);
            const errorPenalty = stats.failedRequests > 0 ? 0.5 : 1;

            return {
                instance,
                score: (responseScore + connectionScore) * errorPenalty * instance.weight,
            };
        }).sort((a, b) => b.score - a.score);

        // Probabilistic selection favoring higher scores
        const topCandidates = scored.slice(0, Math.ceil(scored.length / 2));
        return topCandidates[Math.floor(Math.random() * topCandidates.length)].instance;
    }

    /**
     * Record the start of a request
     */
    recordRequestStart(instanceId: string): void {
        const stats = this.getStats(instanceId);
        stats.activeConnections++;
        stats.totalRequests++;
    }

    /**
     * Record the completion of a request
     */
    recordRequestEnd(instanceId: string, responseTimeMs: number, success: boolean): void {
        const stats = this.getStats(instanceId);
        stats.activeConnections = Math.max(0, stats.activeConnections - 1);

        if (!success) {
            stats.failedRequests++;
        }

        // Update response time (moving average)
        stats.lastResponseTimes.push(responseTimeMs);
        if (stats.lastResponseTimes.length > 100) {
            stats.lastResponseTimes.shift();
        }
        stats.avgResponseTime = stats.lastResponseTimes.reduce((a, b) => a + b, 0) / stats.lastResponseTimes.length;
    }

    private getStats(instanceId: string): BackendStats {
        if (!this.backendStats.has(instanceId)) {
            this.backendStats.set(instanceId, {
                activeConnections: 0,
                totalRequests: 0,
                failedRequests: 0,
                avgResponseTime: 0,
                lastResponseTimes: [],
            });
        }
        return this.backendStats.get(instanceId)!;
    }

    getBackendStats(): Record<string, BackendStats> {
        return Object.fromEntries(this.backendStats);
    }
}

export const loadBalancer = new LoadBalancer();

// ============================================================================
// Task 34: Sticky Sessions for WebSocket
// ============================================================================

class StickySessionManager {
    private sessions: Map<string, string> = new Map(); // sessionId -> instanceId
    private instanceSessions: Map<string, Set<string>> = new Map(); // instanceId -> sessionIds
    private ttlMs = 3600000; // 1 hour
    private cleanupInterval: NodeJS.Timeout;

    constructor() {
        this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
        this.cleanupInterval.unref();
    }

    /**
     * Get or assign an instance for a session
     */
    getOrAssign(sessionId: string, serviceName: string): ServiceInstance | null {
        // Check for existing assignment
        const existingInstanceId = this.sessions.get(sessionId);
        if (existingInstanceId) {
            const instances = serviceDiscovery.getInstances(serviceName);
            const instance = instances.find(i => i.id === existingInstanceId);
            if (instance) return instance;

            // Instance no longer available, reassign
            this.remove(sessionId);
        }

        // Assign new instance
        const instance = loadBalancer.select(serviceName);
        if (instance) {
            this.assign(sessionId, instance.id);
        }
        return instance;
    }

    private assign(sessionId: string, instanceId: string): void {
        this.sessions.set(sessionId, instanceId);

        if (!this.instanceSessions.has(instanceId)) {
            this.instanceSessions.set(instanceId, new Set());
        }
        this.instanceSessions.get(instanceId)!.add(sessionId);
    }

    remove(sessionId: string): void {
        const instanceId = this.sessions.get(sessionId);
        if (instanceId) {
            this.instanceSessions.get(instanceId)?.delete(sessionId);
            this.sessions.delete(sessionId);
        }
    }

    /**
     * Get all sessions for an instance (useful for draining)
     */
    getSessionsForInstance(instanceId: string): string[] {
        return Array.from(this.instanceSessions.get(instanceId) ?? []);
    }

    /**
     * Migrate sessions from one instance to another
     */
    migrateSessions(fromInstanceId: string, toInstanceId: string): number {
        const sessions = this.instanceSessions.get(fromInstanceId);
        if (!sessions) return 0;

        let migrated = 0;
        for (const sessionId of sessions) {
            this.sessions.set(sessionId, toInstanceId);
            migrated++;
        }

        if (!this.instanceSessions.has(toInstanceId)) {
            this.instanceSessions.set(toInstanceId, new Set());
        }

        for (const sessionId of sessions) {
            this.instanceSessions.get(toInstanceId)!.add(sessionId);
        }

        this.instanceSessions.delete(fromInstanceId);

        Logger.info(`[StickySession] Migrated ${migrated} sessions from ${fromInstanceId} to ${toInstanceId}`);
        return migrated;
    }

    private cleanup(): void {
        // In a real implementation, you'd track session timestamps
        // For now, just clean up sessions for non-existent instances
        const allServices = serviceDiscovery.getAllServices();
        const activeInstanceIds = new Set<string>();

        for (const instances of Object.values(allServices)) {
            for (const instance of instances) {
                activeInstanceIds.add(instance.id);
            }
        }

        for (const [sessionId, instanceId] of this.sessions) {
            if (!activeInstanceIds.has(instanceId)) {
                this.remove(sessionId);
            }
        }
    }

    getStats(): { totalSessions: number; sessionsByInstance: Record<string, number> } {
        const sessionsByInstance: Record<string, number> = {};
        for (const [instanceId, sessions] of this.instanceSessions) {
            sessionsByInstance[instanceId] = sessions.size;
        }

        return {
            totalSessions: this.sessions.size,
            sessionsByInstance,
        };
    }
}

export const stickySessionManager = new StickySessionManager();

// ============================================================================
// Task 35: Data Partitioning by Workspace
// ============================================================================

interface PartitionConfig {
    strategy: 'hash' | 'range' | 'list' | 'composite';
    partitionCount: number;
    keyExtractor: (data: any) => string;
}

class DataPartitioner {
    private config: PartitionConfig;

    constructor(config: PartitionConfig) {
        this.config = config;
    }

    /**
     * Get the partition ID for a given data item
     */
    getPartition(data: any): number {
        const key = this.config.keyExtractor(data);
        return this.hashToPartition(key);
    }

    /**
     * Get the partition ID for a given key
     */
    getPartitionForKey(key: string): number {
        return this.hashToPartition(key);
    }

    private hashToPartition(key: string): number {
        const hash = crypto.createHash('md5').update(key).digest('hex');
        const numericHash = parseInt(hash.slice(0, 8), 16);
        return numericHash % this.config.partitionCount;
    }

    /**
     * Get all partitions that might contain data matching a query
     */
    getPartitionsForQuery(query: { workspaceId?: string; userId?: string }): number[] {
        if (query.workspaceId) {
            return [this.hashToPartition(query.workspaceId)];
        }
        if (query.userId) {
            return [this.hashToPartition(query.userId)];
        }
        // No filter - need to query all partitions
        return Array.from({ length: this.config.partitionCount }, (_, i) => i);
    }
}

// Default partitioner for workspace-based partitioning
export const workspacePartitioner = new DataPartitioner({
    strategy: 'hash',
    partitionCount: 16,
    keyExtractor: (data) => data.workspaceId ?? data.workspace_id ?? 'default',
});

// ============================================================================
// Task 36: Sharding for High-Volume Chats
// ============================================================================

interface ShardConfig {
    shardCount: number;
    replicationFactor: number;
    virtualNodes: number;
}

class ConsistentHashRing {
    private ring: Map<number, string> = new Map();
    private sortedHashes: number[] = [];
    private virtualNodes: number;

    constructor(virtualNodes: number = 150) {
        this.virtualNodes = virtualNodes;
    }

    /**
     * Add a shard to the ring
     */
    addShard(shardId: string): void {
        for (let i = 0; i < this.virtualNodes; i++) {
            const virtualKey = `${shardId}:${i}`;
            const hash = this.hash(virtualKey);
            this.ring.set(hash, shardId);
            this.sortedHashes.push(hash);
        }
        this.sortedHashes.sort((a, b) => a - b);
    }

    /**
     * Remove a shard from the ring
     */
    removeShard(shardId: string): void {
        const hashesToRemove: number[] = [];

        for (const [hash, shard] of this.ring) {
            if (shard === shardId) {
                hashesToRemove.push(hash);
            }
        }

        for (const hash of hashesToRemove) {
            this.ring.delete(hash);
        }

        this.sortedHashes = this.sortedHashes.filter(h => !hashesToRemove.includes(h));
    }

    /**
     * Get the shard for a given key
     */
    getShard(key: string): string | null {
        if (this.ring.size === 0) return null;

        const hash = this.hash(key);

        // Binary search for the first hash >= key hash
        let left = 0;
        let right = this.sortedHashes.length;

        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (this.sortedHashes[mid] < hash) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        // Wrap around if needed
        const index = left < this.sortedHashes.length ? left : 0;
        return this.ring.get(this.sortedHashes[index]) ?? null;
    }

    /**
     * Get the N shards for a key (for replication)
     */
    getNShards(key: string, n: number): string[] {
        if (this.ring.size === 0) return [];

        const shards: string[] = [];
        const seen = new Set<string>();
        const hash = this.hash(key);

        let left = 0;
        let right = this.sortedHashes.length;

        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (this.sortedHashes[mid] < hash) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        let index = left < this.sortedHashes.length ? left : 0;

        while (shards.length < n && seen.size < this.ring.size) {
            const shard = this.ring.get(this.sortedHashes[index])!;
            if (!seen.has(shard)) {
                shards.push(shard);
                seen.add(shard);
            }
            index = (index + 1) % this.sortedHashes.length;
        }

        return shards;
    }

    private hash(key: string): number {
        const hash = crypto.createHash('md5').update(key).digest('hex');
        return parseInt(hash.slice(0, 8), 16);
    }
}

export const chatShardRing = new ConsistentHashRing(100);

// Initialize with default shards
['shard-0', 'shard-1', 'shard-2', 'shard-3'].forEach(s => chatShardRing.addShard(s));

// ============================================================================
// Exports
// ============================================================================

export {
    ServiceDiscovery,
    LoadBalancer,
    StickySessionManager,
    DataPartitioner,
    ConsistentHashRing,
};

export type {
    ServiceInstance,
    ServiceRegistration,
    LoadBalancerConfig,
    BackendStats,
    PartitionConfig,
    ShardConfig,
};
