/**
 * Knowledge Graph Engine for ILIAGPT PRO 3.0
 * 
 * Almacena conocimiento estructurado con relaciones semánticas,
 * permite razonamiento causal y actualización continua.
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";

// ============================================
// Types and Interfaces
// ============================================

export type NodeType = 'concept' | 'entity' | 'fact' | 'relation' | 'event' | 'preference' | 'decision';
export type RelationType =
    | 'is_a'
    | 'has_property'
    | 'causes'
    | 'requires'
    | 'contradicts'
    | 'supports'
    | 'precedes'
    | 'follows'
    | 'similar_to'
    | 'part_of'
    | 'created_by'
    | 'used_in';

export interface KnowledgeNode {
    id: string;
    type: NodeType;
    label: string;
    content: any;
    embedding?: number[];
    metadata: {
        source: string;
        confidence: number;
        createdAt: Date;
        updatedAt: Date;
        accessCount: number;
        lastAccessed: Date;
        importance: number;
        decay: number;
    };
    properties: Record<string, any>;
}

export interface KnowledgeEdge {
    id: string;
    source: string;
    target: string;
    type: RelationType;
    weight: number;
    properties: Record<string, any>;
    metadata: {
        createdAt: Date;
        confidence: number;
        source: string;
    };
}

export interface QueryResult {
    nodes: KnowledgeNode[];
    edges: KnowledgeEdge[];
    paths: Path[];
    relevanceScores: Map<string, number>;
}

export interface Path {
    nodes: string[];
    edges: string[];
    weight: number;
    description: string;
}

export interface InferenceResult {
    inferred: KnowledgeNode[];
    reasoning: string[];
    confidence: number;
}

export interface GraphStats {
    nodeCount: number;
    edgeCount: number;
    nodesByType: Record<NodeType, number>;
    edgesByType: Record<RelationType, number>;
    avgDegree: number;
    density: number;
}

// ============================================
// Knowledge Graph Class
// ============================================

export class KnowledgeGraph extends EventEmitter {
    private nodes: Map<string, KnowledgeNode>;
    private edges: Map<string, KnowledgeEdge>;
    private adjacencyList: Map<string, Set<string>>;
    private reverseAdjacency: Map<string, Set<string>>;
    private labelIndex: Map<string, Set<string>>;
    private typeIndex: Map<NodeType, Set<string>>;

    // Configuration
    private maxNodes: number;
    private decayRate: number;
    private importanceThreshold: number;

    constructor(options: {
        maxNodes?: number;
        decayRate?: number;
        importanceThreshold?: number;
    } = {}) {
        super();
        this.nodes = new Map();
        this.edges = new Map();
        this.adjacencyList = new Map();
        this.reverseAdjacency = new Map();
        this.labelIndex = new Map();
        this.typeIndex = new Map();

        this.maxNodes = options.maxNodes || 10000;
        this.decayRate = options.decayRate || 0.01;
        this.importanceThreshold = options.importanceThreshold || 0.1;
    }

    // ============================================
    // Node Operations
    // ============================================

    /**
     * Add a node to the knowledge graph
     */
    addNode(
        type: NodeType,
        label: string,
        content: any,
        options: {
            source?: string;
            confidence?: number;
            importance?: number;
            embedding?: number[];
            properties?: Record<string, any>;
        } = {}
    ): KnowledgeNode {
        const id = randomUUID();
        const now = new Date();

        const node: KnowledgeNode = {
            id,
            type,
            label,
            content,
            embedding: options.embedding,
            properties: options.properties || {},
            metadata: {
                source: options.source || 'user',
                confidence: options.confidence || 0.8,
                importance: options.importance || 0.5,
                decay: 1.0,
                createdAt: now,
                updatedAt: now,
                accessCount: 0,
                lastAccessed: now
            }
        };

        // Check capacity and evict if needed
        if (this.nodes.size >= this.maxNodes) {
            this.evictLeastImportant();
        }

        this.nodes.set(id, node);
        this.adjacencyList.set(id, new Set());
        this.reverseAdjacency.set(id, new Set());

        // Update indexes
        this.indexNode(node);

        this.emit("node:added", node);
        return node;
    }

    /**
     * Get a node by ID
     */
    getNode(id: string): KnowledgeNode | undefined {
        const node = this.nodes.get(id);
        if (node) {
            node.metadata.accessCount++;
            node.metadata.lastAccessed = new Date();
            // Boost importance on access
            node.metadata.importance = Math.min(1, node.metadata.importance + 0.01);
        }
        return node;
    }

    /**
     * Update a node
     */
    updateNode(id: string, updates: Partial<Pick<KnowledgeNode, 'content' | 'properties'>>): boolean {
        const node = this.nodes.get(id);
        if (!node) return false;

        if (updates.content !== undefined) node.content = updates.content;
        if (updates.properties) Object.assign(node.properties, updates.properties);
        node.metadata.updatedAt = new Date();

        this.emit("node:updated", node);
        return true;
    }

    /**
     * Remove a node and its edges
     */
    removeNode(id: string): boolean {
        const node = this.nodes.get(id);
        if (!node) return false;

        // Remove all edges connected to this node
        const connected = new Set([
            ...(this.adjacencyList.get(id) || []),
            ...(this.reverseAdjacency.get(id) || [])
        ]);

        for (const edgeId of connected) {
            this.edges.delete(edgeId);
        }

        // Remove from indexes
        this.deindexNode(node);

        this.nodes.delete(id);
        this.adjacencyList.delete(id);
        this.reverseAdjacency.delete(id);

        this.emit("node:removed", { id });
        return true;
    }

    // ============================================
    // Edge Operations
    // ============================================

    /**
     * Add an edge between nodes
     */
    addEdge(
        sourceId: string,
        targetId: string,
        type: RelationType,
        options: {
            weight?: number;
            properties?: Record<string, any>;
            source?: string;
            confidence?: number;
        } = {}
    ): KnowledgeEdge | null {
        const sourceNode = this.nodes.get(sourceId);
        const targetNode = this.nodes.get(targetId);

        if (!sourceNode || !targetNode) return null;

        const id = randomUUID();
        const edge: KnowledgeEdge = {
            id,
            source: sourceId,
            target: targetId,
            type,
            weight: options.weight || 1.0,
            properties: options.properties || {},
            metadata: {
                createdAt: new Date(),
                confidence: options.confidence || 0.8,
                source: options.source || 'inferred'
            }
        };

        this.edges.set(id, edge);
        this.adjacencyList.get(sourceId)?.add(id);
        this.reverseAdjacency.get(targetId)?.add(id);

        this.emit("edge:added", edge);
        return edge;
    }

    /**
     * Get outgoing edges from a node
     */
    getOutgoingEdges(nodeId: string): KnowledgeEdge[] {
        const edgeIds = this.adjacencyList.get(nodeId);
        if (!edgeIds) return [];
        return Array.from(edgeIds).map(id => this.edges.get(id)!).filter(Boolean);
    }

    /**
     * Get incoming edges to a node
     */
    getIncomingEdges(nodeId: string): KnowledgeEdge[] {
        const edgeIds = this.reverseAdjacency.get(nodeId);
        if (!edgeIds) return [];
        return Array.from(edgeIds).map(id => this.edges.get(id)!).filter(Boolean);
    }

    /**
     * Get neighbors of a node
     */
    getNeighbors(nodeId: string, direction: 'both' | 'outgoing' | 'incoming' = 'both'): KnowledgeNode[] {
        const neighbors: Set<string> = new Set();

        if (direction === 'outgoing' || direction === 'both') {
            for (const edge of this.getOutgoingEdges(nodeId)) {
                neighbors.add(edge.target);
            }
        }

        if (direction === 'incoming' || direction === 'both') {
            for (const edge of this.getIncomingEdges(nodeId)) {
                neighbors.add(edge.source);
            }
        }

        return Array.from(neighbors).map(id => this.nodes.get(id)!).filter(Boolean);
    }

    // ============================================
    // Query Operations
    // ============================================

    /**
     * Find nodes by label (fuzzy match)
     */
    findByLabel(label: string, threshold: number = 0.7): KnowledgeNode[] {
        const results: Array<{ node: KnowledgeNode; score: number }> = [];
        const lowerLabel = label.toLowerCase();

        for (const node of this.nodes.values()) {
            const nodeLabel = node.label.toLowerCase();
            const score = this.calculateSimilarity(lowerLabel, nodeLabel);

            if (score >= threshold) {
                results.push({ node, score });
            }
        }

        return results.sort((a, b) => b.score - a.score).map(r => r.node);
    }

    /**
     * Find nodes by type
     */
    findByType(type: NodeType): KnowledgeNode[] {
        const nodeIds = this.typeIndex.get(type);
        if (!nodeIds) return [];
        return Array.from(nodeIds).map(id => this.nodes.get(id)!).filter(Boolean);
    }

    /**
     * Semantic search using embeddings
     */
    semanticSearch(embedding: number[], limit: number = 10): Array<{ node: KnowledgeNode; similarity: number }> {
        const results: Array<{ node: KnowledgeNode; similarity: number }> = [];

        for (const node of this.nodes.values()) {
            if (!node.embedding) continue;

            const similarity = this.cosineSimilarity(embedding, node.embedding);
            results.push({ node, similarity });
        }

        return results
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
    }

    /**
     * Find paths between two nodes
     */
    findPaths(
        startId: string,
        endId: string,
        options: { maxDepth?: number; maxPaths?: number } = {}
    ): Path[] {
        const { maxDepth = 5, maxPaths = 10 } = options;
        const paths: Path[] = [];

        const dfs = (
            currentId: string,
            visited: Set<string>,
            currentPath: string[],
            edgePath: string[],
            depth: number
        ) => {
            if (paths.length >= maxPaths) return;
            if (depth > maxDepth) return;

            if (currentId === endId) {
                paths.push({
                    nodes: [...currentPath],
                    edges: [...edgePath],
                    weight: this.calculatePathWeight(edgePath),
                    description: this.describePathPath(currentPath)
                });
                return;
            }

            const outgoing = this.getOutgoingEdges(currentId);
            for (const edge of outgoing) {
                if (visited.has(edge.target)) continue;

                visited.add(edge.target);
                currentPath.push(edge.target);
                edgePath.push(edge.id);

                dfs(edge.target, visited, currentPath, edgePath, depth + 1);

                visited.delete(edge.target);
                currentPath.pop();
                edgePath.pop();
            }
        };

        const visited = new Set([startId]);
        dfs(startId, visited, [startId], [], 0);

        return paths.sort((a, b) => a.weight - b.weight);
    }

    // ============================================
    // Reasoning & Inference
    // ============================================

    /**
     * Infer new facts based on existing knowledge
     */
    infer(query: string): InferenceResult {
        const inferred: KnowledgeNode[] = [];
        const reasoning: string[] = [];
        let confidence = 0;

        // Find related concepts
        const related = this.findByLabel(query, 0.5);

        if (related.length === 0) {
            return { inferred: [], reasoning: ["No related concepts found"], confidence: 0 };
        }

        // Transitivity inference (A -> B -> C implies A -> C)
        for (const node of related.slice(0, 5)) {
            const neighbors = this.getNeighbors(node.id, 'outgoing');

            for (const neighbor of neighbors) {
                const secondHop = this.getNeighbors(neighbor.id, 'outgoing');

                for (const secondNeighbor of secondHop) {
                    // Check if direct edge already exists
                    const directEdge = this.getOutgoingEdges(node.id)
                        .find(e => e.target === secondNeighbor.id);

                    if (!directEdge) {
                        inferred.push(secondNeighbor);
                        reasoning.push(
                            `${node.label} → ${neighbor.label} → ${secondNeighbor.label} (transitivity)`
                        );
                    }
                }
            }
        }

        // Calculate confidence based on evidence
        confidence = Math.min(0.9, 0.5 + (related.length * 0.1));

        return { inferred: inferred.slice(0, 10), reasoning, confidence };
    }

    /**
     * Find contradictions in knowledge
     */
    findContradictions(nodeId: string): Array<{ node: KnowledgeNode; reason: string }> {
        const contradictions: Array<{ node: KnowledgeNode; reason: string }> = [];
        const node = this.nodes.get(nodeId);
        if (!node) return contradictions;

        // Find nodes with 'contradicts' relation
        const outgoing = this.getOutgoingEdges(nodeId);
        const incoming = this.getIncomingEdges(nodeId);

        for (const edge of [...outgoing, ...incoming]) {
            if (edge.type === 'contradicts') {
                const otherNodeId = edge.source === nodeId ? edge.target : edge.source;
                const otherNode = this.nodes.get(otherNodeId);
                if (otherNode) {
                    contradictions.push({
                        node: otherNode,
                        reason: `Direct contradiction: ${node.label} contradicts ${otherNode.label}`
                    });
                }
            }
        }

        return contradictions;
    }

    /**
     * Get causal chain from node
     */
    getCausalChain(nodeId: string, maxDepth: number = 5): KnowledgeNode[] {
        const chain: KnowledgeNode[] = [];
        const visited = new Set<string>();

        const followCauses = (currentId: string, depth: number) => {
            if (depth > maxDepth || visited.has(currentId)) return;
            visited.add(currentId);

            const node = this.nodes.get(currentId);
            if (node) chain.push(node);

            const outgoing = this.getOutgoingEdges(currentId);
            for (const edge of outgoing) {
                if (edge.type === 'causes') {
                    followCauses(edge.target, depth + 1);
                }
            }
        };

        followCauses(nodeId, 0);
        return chain;
    }

    // ============================================
    // Maintenance Operations
    // ============================================

    /**
     * Apply decay to all nodes (call periodically)
     */
    applyDecay(): void {
        const now = Date.now();

        for (const node of this.nodes.values()) {
            const hoursSinceAccess = (now - node.metadata.lastAccessed.getTime()) / 3600000;
            const decay = Math.exp(-this.decayRate * hoursSinceAccess);
            node.metadata.decay = decay;

            // Calculate effective importance
            const effectiveImportance = node.metadata.importance * decay;

            // Mark for eviction if below threshold
            if (effectiveImportance < this.importanceThreshold) {
                node.properties._markedForEviction = true;
            }
        }
    }

    /**
     * Evict least important nodes
     */
    evictLeastImportant(count: number = 100): number {
        const nodes = Array.from(this.nodes.values())
            .map(n => ({
                node: n,
                score: n.metadata.importance * n.metadata.decay
            }))
            .sort((a, b) => a.score - b.score);

        let evicted = 0;
        for (let i = 0; i < Math.min(count, nodes.length); i++) {
            if (this.removeNode(nodes[i].node.id)) {
                evicted++;
            }
        }

        this.emit("eviction", { count: evicted });
        return evicted;
    }

    /**
     * Merge duplicate nodes
     */
    mergeDuplicates(): number {
        const labelGroups = new Map<string, KnowledgeNode[]>();

        for (const node of this.nodes.values()) {
            const key = `${node.type}:${node.label.toLowerCase()}`;
            if (!labelGroups.has(key)) labelGroups.set(key, []);
            labelGroups.get(key)!.push(node);
        }

        let merged = 0;
        for (const [, group] of labelGroups) {
            if (group.length <= 1) continue;

            // Keep the most important one
            group.sort((a, b) => b.metadata.importance - a.metadata.importance);
            const keeper = group[0];

            for (let i = 1; i < group.length; i++) {
                const duplicate = group[i];

                // Transfer edges to keeper
                for (const edge of this.getOutgoingEdges(duplicate.id)) {
                    this.addEdge(keeper.id, edge.target, edge.type, {
                        weight: edge.weight,
                        properties: edge.properties
                    });
                }

                for (const edge of this.getIncomingEdges(duplicate.id)) {
                    this.addEdge(edge.source, keeper.id, edge.type, {
                        weight: edge.weight,
                        properties: edge.properties
                    });
                }

                // Merge properties
                Object.assign(keeper.properties, duplicate.properties);

                this.removeNode(duplicate.id);
                merged++;
            }
        }

        return merged;
    }

    // ============================================
    // Serialization
    // ============================================

    /**
     * Export graph to JSON
     */
    toJSON(): { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] } {
        return {
            nodes: Array.from(this.nodes.values()),
            edges: Array.from(this.edges.values())
        };
    }

    /**
     * Import graph from JSON
     */
    fromJSON(data: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }): void {
        this.clear();

        for (const node of data.nodes) {
            this.nodes.set(node.id, node);
            this.adjacencyList.set(node.id, new Set());
            this.reverseAdjacency.set(node.id, new Set());
            this.indexNode(node);
        }

        for (const edge of data.edges) {
            this.edges.set(edge.id, edge);
            this.adjacencyList.get(edge.source)?.add(edge.id);
            this.reverseAdjacency.get(edge.target)?.add(edge.id);
        }
    }

    /**
     * Clear all data
     */
    clear(): void {
        this.nodes.clear();
        this.edges.clear();
        this.adjacencyList.clear();
        this.reverseAdjacency.clear();
        this.labelIndex.clear();
        this.typeIndex.clear();
    }

    /**
     * Get statistics
     */
    getStats(): GraphStats {
        const nodesByType: Record<string, number> = {};
        const edgesByType: Record<string, number> = {};

        for (const node of this.nodes.values()) {
            nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
        }

        for (const edge of this.edges.values()) {
            edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1;
        }

        const nodeCount = this.nodes.size;
        const edgeCount = this.edges.size;

        return {
            nodeCount,
            edgeCount,
            nodesByType: nodesByType as Record<NodeType, number>,
            edgesByType: edgesByType as Record<RelationType, number>,
            avgDegree: nodeCount > 0 ? (edgeCount * 2) / nodeCount : 0,
            density: nodeCount > 1 ? edgeCount / (nodeCount * (nodeCount - 1)) : 0
        };
    }

    // ============================================
    // Private Helper Methods
    // ============================================

    private indexNode(node: KnowledgeNode): void {
        // Label index
        const labelKey = node.label.toLowerCase();
        if (!this.labelIndex.has(labelKey)) {
            this.labelIndex.set(labelKey, new Set());
        }
        this.labelIndex.get(labelKey)!.add(node.id);

        // Type index
        if (!this.typeIndex.has(node.type)) {
            this.typeIndex.set(node.type, new Set());
        }
        this.typeIndex.get(node.type)!.add(node.id);
    }

    private deindexNode(node: KnowledgeNode): void {
        const labelKey = node.label.toLowerCase();
        this.labelIndex.get(labelKey)?.delete(node.id);
        this.typeIndex.get(node.type)?.delete(node.id);
    }

    private calculateSimilarity(a: string, b: string): number {
        if (a === b) return 1;
        if (a.includes(b) || b.includes(a)) return 0.8;

        // Levenshtein similarity
        const matrix: number[][] = [];
        for (let i = 0; i <= a.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= b.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= a.length; i++) {
            for (let j = 1; j <= b.length; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j - 1] + cost
                );
            }
        }

        const maxLen = Math.max(a.length, b.length);
        return maxLen > 0 ? 1 - matrix[a.length][b.length] / maxLen : 1;
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator > 0 ? dotProduct / denominator : 0;
    }

    private calculatePathWeight(edgeIds: string[]): number {
        return edgeIds.reduce((sum, id) => {
            const edge = this.edges.get(id);
            return sum + (edge ? 1 / edge.weight : 1);
        }, 0);
    }

    private describePathPath(nodeIds: string[]): string {
        return nodeIds
            .map(id => this.nodes.get(id)?.label || 'unknown')
            .join(' → ');
    }
}

// Singleton instance
let knowledgeGraphInstance: KnowledgeGraph | null = null;

export function getKnowledgeGraph(): KnowledgeGraph {
    if (!knowledgeGraphInstance) {
        knowledgeGraphInstance = new KnowledgeGraph();
    }
    return knowledgeGraphInstance;
}

export default KnowledgeGraph;
