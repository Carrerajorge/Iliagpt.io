import * as fs from 'fs';
import * as path from 'path';
import { EntityExtractor } from './pare/entityExtractor';
import { Entity } from './pare/types';
import { AsyncLock } from '../utils/asyncLock';

interface GraphNode {
    id: string; // "react"
    type: string; // "technology", "person", "file", "concept"
    label: string; // "React"
    metadata: Record<string, any>;
    lastSeen: Date;
    frequency: number;
}

interface GraphEdge {
    source: string;
    target: string;
    relation: string; // "uses", "author_of", "related_to"
    weight: number;
}

interface GraphData {
    nodes: Record<string, GraphNode>;
    edges: GraphEdge[];
}

export class KnowledgeGraphService {
    private data: GraphData = { nodes: {}, edges: [] };
    private filePath: string;
    private entityExtractor: EntityExtractor;
    private lock = new AsyncLock();

    constructor(storagePath: string) {
        this.filePath = path.join(storagePath, 'knowledge_graph.json');
        this.entityExtractor = new EntityExtractor();
        this.load();
    }

    private load() {
        if (fs.existsSync(this.filePath)) {
            try {
                this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
                // Hydrate dates
                Object.values(this.data.nodes).forEach(n => n.lastSeen = new Date(n.lastSeen));
            } catch (e) {
                console.error("Failed to load knowledge graph", e);
            }
        }
    }

    private save() {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
        } catch (e) {
            console.error("Failed to save knowledge graph", e);
        }
    }

    async ingest(text: string, contextId?: string) {
        return this.lock.withLock(async () => {
            // Extract entities using our enhanced extractor
            const entities = await this.entityExtractor.extract(text, ["technology", "library", "person", "file_path", "project_name"]);

            const timestamp = new Date();
            const detectedNodeIds: string[] = [];

            // 1. Create/Update Nodes
            for (const entity of entities) {
                const id = entity.value.toLowerCase();
                detectedNodeIds.push(id);

                if (!this.data.nodes[id]) {
                    this.data.nodes[id] = {
                        id,
                        type: entity.type,
                        label: entity.value,
                        metadata: { ...entity.metadata, contextId },
                        lastSeen: timestamp,
                        frequency: 1
                    };
                } else {
                    const node = this.data.nodes[id];
                    node.lastSeen = timestamp;
                    node.frequency++;
                    // Merge metadata if needed
                    if (entity.metadata) {
                        node.metadata = { ...node.metadata, ...entity.metadata };
                    }
                }
            }

            // 2. Create Implicit Edges (Co-occurrence)
            // If "React" and "TypeScript" appear in same prompt, link them.
            for (let i = 0; i < detectedNodeIds.length; i++) {
                for (let j = i + 1; j < detectedNodeIds.length; j++) {
                    this.addEdge(detectedNodeIds[i], detectedNodeIds[j], "co_occurred");
                }
            }

            this.save();
            return entities;
        });
    }

    private addEdge(source: string, target: string, relation: string) {
        // Check if edge exists
        const existing = this.data.edges.find(e =>
            (e.source === source && e.target === target && e.relation === relation) ||
            (e.source === target && e.target === source && e.relation === relation) // Undirected for co-occurrence
        );

        if (existing) {
            existing.weight += 1;
        } else {
            this.data.edges.push({
                source,
                target,
                relation,
                weight: 1
            });
        }
    }

    getRelatedEntities(entityId: string): GraphNode[] {
        const id = entityId.toLowerCase();
        const relatedIds = new Set<string>();

        this.data.edges.forEach(e => {
            if (e.source === id) relatedIds.add(e.target);
            if (e.target === id) relatedIds.add(e.source);
        });

        return Array.from(relatedIds)
            .map(rid => this.data.nodes[rid])
            .filter(Boolean)
            .sort((a, b) => b.frequency - a.frequency); // Return most frequent first
    }

    getSnapshotSummary(): string {
        const topNodes = Object.values(this.data.nodes)
            .sort((a, b) => b.frequency - a.frequency)
            .slice(0, 10);

        if (topNodes.length === 0) return "";

        return `Top Knowledge Entities: ${topNodes.map(n => n.label).join(", ")}`;
    }
}

// Singleton for simplicity, pointing to a default location
export const knowledgeGraph = new KnowledgeGraphService(path.join(process.cwd(), '.gemini/data'));
