/**
 * Unit Tests - ILIAGPT PRO 3.0 Components
 * Tests for Knowledge Graph, HTN Planner, Tool Composer
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { KnowledgeGraph } from "../knowledgeGraph";
import { HTNPlanner } from "../htnPlanner";
import { ToolComposer } from "../toolComposer";

// ============================================================================
// Knowledge Graph Tests
// ============================================================================

describe("KnowledgeGraph", () => {
    let graph: KnowledgeGraph;

    beforeEach(() => {
        graph = new KnowledgeGraph();
    });

    describe("Node Operations", () => {
        it("should add a node", () => {
            const node = graph.addNode("concept", "JavaScript", { info: "A programming language" }, {
                source: "user",
                confidence: 0.9,
            });

            expect(node.id).toBeTruthy();
            expect(node.label).toBe("JavaScript");
            expect(node.type).toBe("concept");
        });

        it("should get a node by ID", () => {
            const created = graph.addNode("entity", "OpenAI", { type: "company" });
            const retrieved = graph.getNode(created.id);

            expect(retrieved).toBeDefined();
            expect(retrieved?.label).toBe("OpenAI");
        });

        it("should update a node", () => {
            const node = graph.addNode("concept", "Python", { version: "3.10" });
            const updated = graph.updateNode(node.id, { properties: { version: "3.11" } });

            expect(updated).toBe(true);
            expect(graph.getNode(node.id)?.properties.version).toBe("3.11");
        });

        it("should remove a node", () => {
            const node = graph.addNode("fact", "Test fact", "content");
            expect(graph.removeNode(node.id)).toBe(true);
            expect(graph.getNode(node.id)).toBeUndefined();
        });
    });

    describe("Edge Operations", () => {
        it("should add an edge between nodes", () => {
            const node1 = graph.addNode("concept", "AI", {});
            const node2 = graph.addNode("concept", "Machine Learning", {});

            const edge = graph.addEdge(node1.id, node2.id, "is_a", { weight: 0.9 });

            expect(edge).toBeTruthy();
            expect(edge?.source).toBe(node1.id);
            expect(edge?.target).toBe(node2.id);
        });

        it("should get outgoing edges", () => {
            const node1 = graph.addNode("concept", "A", {});
            const node2 = graph.addNode("concept", "B", {});
            graph.addEdge(node1.id, node2.id, "similar_to");

            const edges = graph.getOutgoingEdges(node1.id);
            expect(edges.length).toBe(1);
            expect(edges[0].target).toBe(node2.id);
        });

        it("should get neighbors", () => {
            const node1 = graph.addNode("concept", "Center", {});
            const node2 = graph.addNode("concept", "Neighbor", {});
            graph.addEdge(node1.id, node2.id, "supports");

            const neighbors = graph.getNeighbors(node1.id, "outgoing");
            expect(neighbors.length).toBe(1);
            expect(neighbors[0].label).toBe("Neighbor");
        });
    });

    describe("Search", () => {
        it("should find nodes by label", () => {
            graph.addNode("concept", "Database Systems", {});

            const results = graph.findByLabel("Database");
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].label).toContain("Database");
        });

        it("should find nodes by type", () => {
            graph.addNode("entity", "Entity 1", {});
            graph.addNode("entity", "Entity 2", {});
            graph.addNode("concept", "Concept 1", {});

            const entities = graph.findByType("entity");
            expect(entities.length).toBe(2);
        });
    });

    describe("Inference", () => {
        it("should infer related knowledge", () => {
            graph.addNode("concept", "Machine Learning", {});
            const result = graph.infer("Machine Learning");

            expect(result).toBeDefined();
            expect(result.reasoning).toBeDefined();
        });
    });

    describe("Statistics", () => {
        it("should return graph statistics", () => {
            graph.addNode("concept", "Test", {});
            const stats = graph.getStats();

            expect(stats.nodeCount).toBeGreaterThan(0);
            expect(stats.nodesByType).toBeDefined();
        });
    });
});

// ============================================================================
// HTN Planner Tests
// ============================================================================

describe("HTNPlanner", () => {
    let planner: HTNPlanner;

    beforeEach(() => {
        planner = new HTNPlanner();
    });

    describe("World State", () => {
        it("should set and get facts", () => {
            planner.setFact("user.authenticated", true);
            expect(planner.getFact("user.authenticated")).toBe(true);
        });

        it("should delete facts", () => {
            planner.setFact("temp.value", 42);
            planner.deleteFact("temp.value");
            expect(planner.getFact("temp.value")).toBeUndefined();
        });

        it("should manage resources", () => {
            planner.setResource("api.quota", 100);
            expect(planner.getResource("api.quota")).toBe(100);

            planner.modifyResource("api.quota", -10);
            expect(planner.getResource("api.quota")).toBe(90);
        });
    });

    describe("Condition Checking", () => {
        it("should check equality conditions", () => {
            planner.setFact("status", "active");

            const condition = {
                type: "fact" as const,
                key: "status",
                operator: "equals" as const,
                value: "active",
            };

            expect(planner.checkCondition(condition)).toBe(true);
        });

        it("should check resource conditions", () => {
            planner.setResource("tokens", 50);

            const condition = {
                type: "resource" as const,
                key: "tokens",
                operator: "greater" as const,
                value: 10,
            };

            expect(planner.checkCondition(condition)).toBe(true);
        });
    });

    describe("Planning", () => {
        it("should create a plan for a goal", async () => {
            const result = await planner.plan("Create a presentation about AI");

            expect(result.success).toBe(true);
            expect(result.plan).toBeDefined();
            expect(result.plan?.executionOrder.length).toBeGreaterThan(0);
        });

        it("should handle research goals", async () => {
            const result = await planner.plan("Search for information about climate change");

            expect(result.success).toBe(true);
            expect(result.planningTime).toBeDefined();
        });
    });

    describe("Task Templates", () => {
        it("should register custom templates", () => {
            planner.registerTemplate("custom_task", {
                name: "Custom Task",
                type: "primitive",
                description: "A custom task",
                preconditions: [],
                effects: [],
                cost: 1,
                estimatedDuration: 1000,
                priority: 5,
                dependencies: [],
                dependents: [],
                maxRetries: 2,
            });

            // Template registered successfully if no error
            expect(true).toBe(true);
        });
    });
});

// ============================================================================
// Tool Composer Tests
// ============================================================================

describe("ToolComposer", () => {
    let composer: ToolComposer;

    beforeEach(() => {
        composer = new ToolComposer();
    });

    describe("Tool Registration", () => {
        it("should register a tool", () => {
            composer.registerTool({
                id: "test-tool",
                name: "test_tool",
                description: "A test tool",
                category: "testing",
                inputSchema: { query: { type: "string" } },
                outputSchema: { result: { type: "string" } },
                execute: async (params) => ({ result: `Processed: ${params.query}` }),
                estimatedDuration: 1000,
                cost: 1,
                successRate: 0.95,
            });

            const tool = composer.getTool("test_tool");
            expect(tool).toBeDefined();
            expect(tool?.name).toBe("test_tool");
        });

        it("should find compatible tools", () => {
            composer.registerTool({
                id: "string-processor",
                name: "string_processor",
                description: "Processes strings",
                category: "text",
                inputSchema: { input: { type: "string" } },
                outputSchema: { output: { type: "string" } },
                execute: async (params) => ({ output: params.input.toUpperCase() }),
                estimatedDuration: 500,
                cost: 1,
                successRate: 0.99,
            });

            const compatible = composer.findCompatibleTools("string");
            expect(compatible.length).toBeGreaterThan(0);
        });
    });

    describe("Pipeline Creation", () => {
        it("should create a pipeline", () => {
            const pipeline = composer.createPipeline("Test Pipeline", [], {
                description: "A test pipeline",
            });

            expect(pipeline.id).toBeTruthy();
            expect(pipeline.name).toBe("Test Pipeline");
        });

        it("should create pipeline with steps", () => {
            composer.registerTool({
                id: "step-1",
                name: "step_one",
                description: "Step 1",
                category: "test",
                inputSchema: {},
                outputSchema: {},
                execute: async () => ({ done: true }),
                estimatedDuration: 100,
                cost: 1,
                successRate: 1,
            });

            const pipeline = composer.createPipeline("Multi-step", [
                {
                    toolName: "step_one",
                    inputMapping: [],
                    outputKey: "result1",
                    retries: 2,
                    timeout: 5000,
                },
            ]);

            expect(pipeline.steps.length).toBe(1);
        });

        it("should create pipeline from description", () => {
            const pipeline = composer.createPipelineFromDescription(
                "Research and create a presentation"
            );

            expect(pipeline).toBeDefined();
            expect(pipeline.steps.length).toBeGreaterThan(0);
        });
    });

    describe("Pipeline Execution", () => {
        it("should execute an empty pipeline", async () => {
            const pipeline = composer.createPipeline("Empty", []);

            const result = await composer.executePipeline(pipeline.id, {});

            expect(result.success).toBe(true);
            expect(result.stepsExecuted).toBeGreaterThanOrEqual(0);
        });

        it("should execute pipeline with working tool", async () => {
            composer.registerTool({
                id: "echo",
                name: "echo",
                description: "Echo",
                category: "util",
                inputSchema: { message: { type: "string" } },
                outputSchema: { echoed: { type: "string" } },
                execute: async (params) => ({ echoed: params.message }),
                estimatedDuration: 100,
                cost: 1,
                successRate: 1,
            });

            const pipeline = composer.createPipeline("Echo Pipeline", [
                {
                    toolName: "echo",
                    inputMapping: [
                        { paramName: "message", source: "context", sourceKey: "msg" },
                    ],
                    outputKey: "result",
                    retries: 0,
                    timeout: 1000,
                },
            ]);

            const result = await composer.executePipeline(pipeline.id, { msg: "Hello" });

            expect(result.success).toBe(true);
            expect(result.outputs.result?.echoed).toBe("Hello");
        });
    });

    describe("Statistics", () => {
        it("should return composer stats", () => {
            composer.registerTool({
                id: "t1",
                name: "t1",
                description: "Tool 1",
                category: "test",
                inputSchema: {},
                outputSchema: {},
                execute: async () => ({}),
                estimatedDuration: 100,
                cost: 1,
                successRate: 1,
            });

            const stats = composer.getStats();

            expect(stats.totalTools).toBe(1);
            expect(stats.avgSuccessRate).toBeDefined();
        });
    });
});
