
import { describe, it, expect, vi, beforeEach } from 'vitest';

let SuperAgentOrchestrator: typeof import('../orchestrator').SuperAgentOrchestrator;

// Mock PromptUnderstanding
vi.mock('../../promptUnderstanding', () => {
    return {
        PromptUnderstanding: class {
            processFullPrompt = vi.fn().mockResolvedValue({
                spec: {
                    intent: 'research',
                    constraints: [],
                    tasks: [
                        { id: '1', verb: 'SEARCH', dependencies: [], params: [], tool_hints: ['google'] }
                    ]
                },
                entities: []
            });
        }
    };
});

// Mock RequestUnderstanding gate so unit tests don't hit real LLM providers.
vi.mock('../../requestUnderstanding', () => ({
    requestUnderstandingAgent: {
        buildBrief: vi.fn().mockResolvedValue({
            intent: 'research',
            subtasks: ['search', 'summarize'],
            deliverable: { type: 'answer', format: 'text' },
            audience: { who: 'internal', tone: 'neutral' },
            restrictions: [],
            data_provided: [],
            assumptions: [],
            success_criteria: ['returns brief'],
            risks: [],
            ambiguities: [],
            blocker: { is_blocked: false, question: null }
        })
    }
}));

// Mock dependencies that might be imported
vi.mock('../../../lib/openai', () => ({
    // llmGateway imports both `openai` and `MODELS` from this module.
    MODELS: {
        TEXT: 'test-text-model',
        VISION: 'test-vision-model'
    },
    openai: {
        chat: {
            completions: {
                create: vi.fn().mockResolvedValue({
                    choices: [{ message: { content: '{}' } }]
                })
            }
        }
    }
}));

// Mock internal pipelines to prevent external calls/hanging
// Mock internal pipelines to prevent external calls/hanging
vi.mock('../signalsPipeline', () => ({
    collectSignals: vi.fn().mockResolvedValue({
        signals: [],
        totalCollected: 0,
        queriesExecuted: 0,
        durationMs: 0
    })
}));

vi.mock('../deepDivePipeline', () => ({
    deepDiveSources: vi.fn().mockResolvedValue([])
}));

vi.mock('../academicPipeline', () => ({
    runAcademicPipeline: vi.fn().mockResolvedValue({
        articles: [],
        stats: { finalCount: 0, sourcesUsed: [], verifiedCount: 0, durationMs: 0 },
        criticResult: { passed: true },
        warnings: []
    })
}));

vi.mock('../scopusClient', () => ({
    isScopusConfigured: vi.fn().mockReturnValue(false),
    searchScopus: vi.fn().mockResolvedValue([])
}));

vi.mock('../wosClient', () => ({
    searchWos: vi.fn().mockResolvedValue([])
}));

describe('SuperAgentOrchestrator', () => {
    let orchestrator: InstanceType<typeof SuperAgentOrchestrator>;

    beforeEach(async () => {
        vi.clearAllMocks();
        ({ SuperAgentOrchestrator } = await import('../orchestrator'));

        orchestrator = new SuperAgentOrchestrator('test-session-id', {
            maxIterations: 1,
            emitHeartbeat: false,
            enforceContract: false
        });
    }, 30000);

    it('should verify thought emission flow during execution', async () => {
        const sseSpy = vi.fn();
        orchestrator.on('sse', sseSpy);

        // Mock successful execution flow
        // We are mocking processFullPrompt above to return a basic spec

        await orchestrator.execute('Research quantum computing');

        // Check if "thought" events were emitted
        const calls = sseSpy.mock.calls.map(c => c[0]); // Get first arg of each call
        const thoughts = calls.filter(e => e.event_type === 'thought');

        expect(thoughts.length).toBeGreaterThan(0);
        expect(thoughts[0].data).toHaveProperty('content');
        expect(thoughts[0].data.content).toContain('Analizando solicitud');

        // Verify contract emission
        const contract = calls.find(e => e.event_type === 'contract');
        expect(contract).toBeDefined();
        expect(contract?.data.intent).toBe('research');
    });

    it('should handle user cancellation', async () => {
        const abortController = new AbortController();
        abortController.abort();

        await expect(orchestrator.execute('Test prompt', abortController.signal))
            .rejects.toThrow('Ejecución cancelada por el usuario');
    });
});
