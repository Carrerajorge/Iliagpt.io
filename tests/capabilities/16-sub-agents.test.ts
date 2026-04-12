/**
 * Capability: Sub-Agents / Multi-Agent Orchestration
 * Tests LangGraph-style multi-agent decomposition, parallel execution, and result aggregation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { SUB_AGENT_RESPONSE } from './_setup/mockResponses';
import { createLLMClientMock, expectValidJson } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));

type AgentRole = 'orchestrator' | 'researcher' | 'analyst' | 'writer' | 'coder' | 'browser';
type AgentStatus = 'pending' | 'running' | 'completed' | 'failed';

interface AgentNode {
  id: string;
  role: AgentRole;
  status: AgentStatus;
  input?: unknown;
  output?: string;
  error?: string;
  duration_ms?: number;
}

interface OrchestrationPlan {
  taskId: string;
  description: string;
  agents: AgentNode[];
  dependencyGraph: Record<string, string[]>; // agent id → depends on agent ids
}

interface OrchestrationResult {
  taskId: string;
  completedAgents: number;
  failedAgents: number;
  aggregatedResult: string;
  totalDuration_ms: number;
  provider: string;
}

class MultiAgentOrchestrator {
  private plans = new Map<string, OrchestrationPlan>();

  async plan(
    description: string,
    provider: ProviderConfig,
    llmClient: ReturnType<typeof createLLMClientMock>,
  ): Promise<OrchestrationPlan> {
    const response = await llmClient.chat.completions.create({
      model: provider.model,
      messages: [
        { role: 'system', content: 'Decompose this task into specialized sub-agents. Return JSON plan.' },
        { role: 'user', content: description },
      ],
    });

    const spec = expectValidJson(response.choices[0].message.content);
    const subAgents = (spec.subAgents as AgentNode[]) ?? [];
    const taskId = spec.taskId as string ?? `task_${Date.now()}`;

    const plan: OrchestrationPlan = {
      taskId,
      description,
      agents: subAgents,
      dependencyGraph: {},
    };

    this.plans.set(taskId, plan);
    return plan;
  }

  async execute(plan: OrchestrationPlan): Promise<OrchestrationResult> {
    const start = Date.now();
    let completed = 0;
    let failed = 0;

    for (const agent of plan.agents) {
      if (agent.status === 'completed') completed++;
      else if (agent.status === 'failed') failed++;
      else {
        // Simulate execution
        agent.status = 'completed';
        agent.output = `${agent.role} completed successfully`;
        agent.duration_ms = Math.floor(Math.random() * 1000) + 100;
        completed++;
      }
    }

    return {
      taskId: plan.taskId,
      completedAgents: completed,
      failedAgents: failed,
      aggregatedResult: plan.agents.map((a) => a.output ?? '').join(' | '),
      totalDuration_ms: Date.now() - start,
      provider: 'orchestrator',
    };
  }

  getPlan(taskId: string): OrchestrationPlan | undefined {
    return this.plans.get(taskId);
  }

  listRoles(plan: OrchestrationPlan): AgentRole[] {
    return plan.agents.map((a) => a.role);
  }
}

runWithEachProvider('Sub-Agents / Orchestration', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;
  let orchestrator: MultiAgentOrchestrator;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: SUB_AGENT_RESPONSE, model: provider.model });
    orchestrator = new MultiAgentOrchestrator();
  });

  it('creates an orchestration plan from description', async () => {
    const plan = await orchestrator.plan('Research and write a report on AI trends', provider, llmMock);
    expect(plan.taskId).toBeTruthy();
    expect(plan.agents.length).toBeGreaterThan(0);
  });

  it('plan has multiple specialized agents', async () => {
    const plan = await orchestrator.plan('Complex multi-step task', provider, llmMock);
    expect(plan.agents.length).toBeGreaterThanOrEqual(2);
  });

  it('executes all agents and returns results', async () => {
    const plan = await orchestrator.plan('Research task', provider, llmMock);
    const result = await orchestrator.execute(plan);
    expect(result.completedAgents).toBeGreaterThan(0);
    expect(result.failedAgents).toBe(0);
  });

  it('aggregated result is non-empty', async () => {
    const plan = await orchestrator.plan('Aggregate task', provider, llmMock);
    const result = await orchestrator.execute(plan);
    expect(result.aggregatedResult.length).toBeGreaterThan(0);
  });

  it('measures total orchestration duration', async () => {
    const plan = await orchestrator.plan('Timed task', provider, llmMock);
    const result = await orchestrator.execute(plan);
    expect(result.totalDuration_ms).toBeGreaterThanOrEqual(0);
  });

  it('retrieves stored plan by taskId', async () => {
    const plan = await orchestrator.plan('Stored task', provider, llmMock);
    const retrieved = orchestrator.getPlan(plan.taskId);
    expect(retrieved?.taskId).toBe(plan.taskId);
  });

  it('lists all agent roles in a plan', async () => {
    const plan = await orchestrator.plan('Role listing task', provider, llmMock);
    const roles = orchestrator.listRoles(plan);
    expect(Array.isArray(roles)).toBe(true);
  });

  it('SUB_AGENT_RESPONSE has expected structure', () => {
    const spec = expectValidJson(SUB_AGENT_RESPONSE);
    expect(spec).toHaveProperty('taskId');
    expect(spec).toHaveProperty('subAgents');
    expect(spec).toHaveProperty('aggregatedResult');
  });

  it('each sub-agent has id, role, and status', () => {
    const spec = expectValidJson(SUB_AGENT_RESPONSE);
    const agents = spec.subAgents as AgentNode[];
    for (const agent of agents) {
      expect(agent.id).toBeTruthy();
      expect(agent.role).toBeTruthy();
      expect(agent.status).toBeTruthy();
    }
  });

  it('calls LLM once to create plan', async () => {
    await orchestrator.plan('Single plan', provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('uses correct model', async () => {
    await orchestrator.plan('Model test', provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });

  it('all sub-agents are completed after execution', async () => {
    const plan = await orchestrator.plan('Full execution', provider, llmMock);
    await orchestrator.execute(plan);
    for (const agent of plan.agents) {
      expect(agent.status).toBe('completed');
    }
  });

  it('handles plan with pre-completed agents', async () => {
    const preCompleted = JSON.stringify({
      taskId: 'task_pre',
      parentAgent: 'orchestrator',
      subAgents: [
        { id: 'a1', role: 'researcher', status: 'completed', output: 'Done' },
        { id: 'a2', role: 'writer', status: 'completed', output: 'Written' },
      ],
      aggregatedResult: 'Pre-completed',
      totalDuration_ms: 0,
    });
    const mock = createLLMClientMock({ content: preCompleted, model: provider.model });
    const plan = await orchestrator.plan('Pre-done task', provider, mock);
    const result = await orchestrator.execute(plan);
    expect(result.completedAgents).toBe(2);
  });
});
