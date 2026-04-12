/**
 * Capability: Operations Vertical Use Case
 * Tests process documentation, SOP generation, incident management, and KPI tracking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { createLLMClientMock, expectValidJson } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));

interface ProcessStep {
  stepNumber: number;
  title: string;
  description: string;
  owner: string;
  durationMinutes?: number;
  tools?: string[];
  checkpoints?: string[];
}

interface SopDocument {
  id: string;
  title: string;
  version: string;
  department: string;
  steps: ProcessStep[];
  estimatedTotalMinutes: number;
  lastReviewDate: string;
  nextReviewDate: string;
  provider: string;
}

interface Incident {
  id: string;
  title: string;
  severity: 'P1' | 'P2' | 'P3' | 'P4';
  status: 'open' | 'investigating' | 'resolved' | 'postmortem';
  timeline: Array<{ timestamp: string; event: string }>;
  assignee?: string;
  resolution?: string;
  rca?: string;
}

async function generateSop(
  processDescription: string,
  department: string,
  provider: ProviderConfig,
  llmClient: ReturnType<typeof createLLMClientMock>,
): Promise<SopDocument> {
  const response = await llmClient.chat.completions.create({
    model: provider.model,
    messages: [
      { role: 'system', content: 'Generate a Standard Operating Procedure (SOP) document as JSON with steps array.' },
      { role: 'user', content: `Department: ${department}\nProcess: ${processDescription}` },
    ],
  });

  const spec = expectValidJson(response.choices[0].message.content);
  const steps = (spec.steps as ProcessStep[]) ?? [];
  const totalMinutes = steps.reduce((sum, s) => sum + (s.durationMinutes ?? 10), 0);

  const now = new Date();
  const reviewDate = new Date(now);
  reviewDate.setFullYear(reviewDate.getFullYear() + 1);

  return {
    id: `sop_${Date.now()}`,
    title: spec.title as string ?? `${department} Process SOP`,
    version: '1.0',
    department,
    steps,
    estimatedTotalMinutes: totalMinutes,
    lastReviewDate: now.toISOString().split('T')[0],
    nextReviewDate: reviewDate.toISOString().split('T')[0],
    provider: provider.name,
  };
}

const SOP_RESPONSE = JSON.stringify({
  title: 'Customer Onboarding SOP',
  version: '1.0',
  steps: [
    { stepNumber: 1, title: 'Account Setup', description: 'Create account in CRM system', owner: 'Account Manager', durationMinutes: 30, tools: ['Salesforce', 'HubSpot'] },
    { stepNumber: 2, title: 'Welcome Email', description: 'Send personalized welcome email', owner: 'CS Team', durationMinutes: 15, tools: ['Gmail'] },
    { stepNumber: 3, title: 'Kickoff Call', description: 'Schedule and conduct kickoff meeting', owner: 'Account Manager', durationMinutes: 60 },
    { stepNumber: 4, title: 'Training', description: 'Complete onboarding training', owner: 'Training Team', durationMinutes: 120 },
    { stepNumber: 5, title: 'Go Live', description: 'Enable account and confirm production access', owner: 'Engineering', durationMinutes: 15 },
  ],
});

runWithEachProvider('Operations Vertical', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: SOP_RESPONSE, model: provider.model });
  });

  it('generates an SOP with steps', async () => {
    const sop = await generateSop('Customer onboarding process', 'Customer Success', provider, llmMock);
    expect(sop.steps.length).toBeGreaterThan(0);
  });

  it('each step has a title and description', async () => {
    const sop = await generateSop('Invoice processing', 'Finance', provider, llmMock);
    for (const step of sop.steps) {
      expect(step.title).toBeTruthy();
      expect(step.description).toBeTruthy();
    }
  });

  it('each step has an owner', async () => {
    const sop = await generateSop('Support escalation', 'Support', provider, llmMock);
    for (const step of sop.steps) {
      expect(step.owner).toBeTruthy();
    }
  });

  it('steps are in sequential order', async () => {
    const sop = await generateSop('Sequential process', 'Ops', provider, llmMock);
    for (let i = 0; i < sop.steps.length; i++) {
      expect(sop.steps[i].stepNumber).toBe(i + 1);
    }
  });

  it('calculates total estimated time', async () => {
    const sop = await generateSop('Timed process', 'HR', provider, llmMock);
    expect(sop.estimatedTotalMinutes).toBeGreaterThan(0);
  });

  it('includes next review date', async () => {
    const sop = await generateSop('Review process', 'Ops', provider, llmMock);
    expect(sop.nextReviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('next review date is in the future', async () => {
    const sop = await generateSop('Future review', 'Ops', provider, llmMock);
    const nextReview = new Date(sop.nextReviewDate);
    expect(nextReview.getTime()).toBeGreaterThan(Date.now());
  });

  it('SOP has department set', async () => {
    const sop = await generateSop('HR process', 'Human Resources', provider, llmMock);
    expect(sop.department).toBe('Human Resources');
  });

  it('version defaults to 1.0', async () => {
    const sop = await generateSop('Initial process', 'Ops', provider, llmMock);
    expect(sop.version).toBe('1.0');
  });

  it('calls LLM once per SOP generation', async () => {
    await generateSop('Simple process', 'IT', provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('uses correct model', async () => {
    await generateSop('Model test', 'Ops', provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });

  it('sets provider name', async () => {
    const sop = await generateSop('Provider test', 'Ops', provider, llmMock);
    expect(sop.provider).toBe(provider.name);
  });

  it('SOP_RESPONSE has 5 steps', () => {
    const spec = expectValidJson(SOP_RESPONSE);
    const steps = spec.steps as ProcessStep[];
    expect(steps.length).toBe(5);
  });

  it('first step has tools defined', () => {
    const spec = expectValidJson(SOP_RESPONSE);
    const steps = spec.steps as ProcessStep[];
    expect(Array.isArray(steps[0].tools)).toBe(true);
  });

  it('total onboarding process time is 4 hours (240 min)', () => {
    const spec = expectValidJson(SOP_RESPONSE);
    const steps = spec.steps as ProcessStep[];
    const total = steps.reduce((s, step) => s + (step.durationMinutes ?? 0), 0);
    expect(total).toBe(240);
  });
});
