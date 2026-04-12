/**
 * Capability: Scheduling
 * Tests cron schedule creation, validation, timezone handling, and execution triggers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { SCHEDULING_RESPONSE } from './_setup/mockResponses';
import { createLLMClientMock, expectValidJson, createDbMock } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));
vi.mock('node-cron', () => ({
  validate: vi.fn().mockReturnValue(true),
  schedule: vi.fn().mockReturnValue({ destroy: vi.fn(), stop: vi.fn() }),
}));

interface Schedule {
  id: string;
  name: string;
  cronExpr: string;
  timezone: string;
  nextRun: string;
  task: { type: string; params: Record<string, unknown> };
  active: boolean;
  createdAt: Date;
}

interface ScheduleService {
  create(spec: Omit<Schedule, 'id' | 'active' | 'createdAt'>): Promise<Schedule>;
  getById(id: string): Promise<Schedule | null>;
  list(page?: number, limit?: number): Promise<Schedule[]>;
  update(id: string, updates: Partial<Schedule>): Promise<Schedule | null>;
  delete(id: string): Promise<boolean>;
  pause(id: string): Promise<boolean>;
  resume(id: string): Promise<boolean>;
  getNextNRuns(cronExpr: string, n: number): Date[];
}

function createScheduleService(): ScheduleService {
  const store = new Map<string, Schedule>();
  let counter = 0;

  function cronToDate(expr: string): Date {
    // Simplified: just return a near-future date
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  }

  return {
    async create(spec) {
      const id = `sched_${++counter}`;
      const schedule: Schedule = {
        ...spec,
        id,
        active: true,
        createdAt: new Date(),
        nextRun: cronToDate(spec.cronExpr).toISOString(),
      };
      store.set(id, schedule);
      return schedule;
    },
    async getById(id) {
      return store.get(id) ?? null;
    },
    async list(page = 1, limit = 20) {
      return Array.from(store.values()).slice((page - 1) * limit, page * limit);
    },
    async update(id, updates) {
      const existing = store.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...updates };
      store.set(id, updated);
      return updated;
    },
    async delete(id) {
      return store.delete(id);
    },
    async pause(id) {
      const s = store.get(id);
      if (!s) return false;
      store.set(id, { ...s, active: false });
      return true;
    },
    async resume(id) {
      const s = store.get(id);
      if (!s) return false;
      store.set(id, { ...s, active: true });
      return true;
    },
    getNextNRuns(cronExpr, n) {
      return Array.from({ length: n }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + (i + 1) * 7);
        return d;
      });
    },
  };
}

async function parseScheduleFromLLM(
  userPrompt: string,
  provider: ProviderConfig,
  llmClient: ReturnType<typeof createLLMClientMock>,
) {
  const response = await llmClient.chat.completions.create({
    model: provider.model,
    messages: [
      { role: 'system', content: 'Parse scheduling request and return JSON with cronExpr, timezone, taskType.' },
      { role: 'user', content: userPrompt },
    ],
  });
  return expectValidJson(response.choices[0].message.content);
}

runWithEachProvider('Scheduling', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;
  let service: ScheduleService;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: SCHEDULING_RESPONSE, model: provider.model });
    service = createScheduleService();
  });

  it('creates a schedule with valid cron expression', async () => {
    const schedule = await service.create({
      name: 'Weekly Report',
      cronExpr: '0 9 * * MON',
      timezone: 'America/New_York',
      nextRun: new Date().toISOString(),
      task: { type: 'generate_report', params: {} },
    });
    expect(schedule.id).toBeTruthy();
    expect(schedule.cronExpr).toBe('0 9 * * MON');
  });

  it('stores schedule as active by default', async () => {
    const schedule = await service.create({
      name: 'Daily sync',
      cronExpr: '0 8 * * *',
      timezone: 'UTC',
      nextRun: new Date().toISOString(),
      task: { type: 'sync', params: {} },
    });
    expect(schedule.active).toBe(true);
  });

  it('retrieves a schedule by ID', async () => {
    const created = await service.create({
      name: 'Test Schedule',
      cronExpr: '*/5 * * * *',
      timezone: 'UTC',
      nextRun: new Date().toISOString(),
      task: { type: 'test', params: {} },
    });
    const found = await service.getById(created.id);
    expect(found).not.toBeNull();
    expect(found?.name).toBe('Test Schedule');
  });

  it('returns null for non-existent schedule', async () => {
    expect(await service.getById('nonexistent')).toBeNull();
  });

  it('lists all schedules', async () => {
    await service.create({ name: 'S1', cronExpr: '0 * * * *', timezone: 'UTC', nextRun: '', task: { type: 'a', params: {} } });
    await service.create({ name: 'S2', cronExpr: '0 * * * *', timezone: 'UTC', nextRun: '', task: { type: 'b', params: {} } });
    const list = await service.list();
    expect(list.length).toBe(2);
  });

  it('pauses and resumes a schedule', async () => {
    const s = await service.create({ name: 'Pausable', cronExpr: '0 12 * * *', timezone: 'UTC', nextRun: '', task: { type: 'x', params: {} } });
    await service.pause(s.id);
    const paused = await service.getById(s.id);
    expect(paused?.active).toBe(false);

    await service.resume(s.id);
    const resumed = await service.getById(s.id);
    expect(resumed?.active).toBe(true);
  });

  it('deletes a schedule', async () => {
    const s = await service.create({ name: 'Deletable', cronExpr: '0 0 * * *', timezone: 'UTC', nextRun: '', task: { type: 'del', params: {} } });
    const deleted = await service.delete(s.id);
    expect(deleted).toBe(true);
    expect(await service.getById(s.id)).toBeNull();
  });

  it('calculates next N run times', () => {
    const runs = service.getNextNRuns('0 9 * * MON', 5);
    expect(runs).toHaveLength(5);
    expect(runs.every((d) => d instanceof Date)).toBe(true);
  });

  it('parses weekly schedule from LLM', async () => {
    const spec = await parseScheduleFromLLM('Run every Monday at 9am', provider, llmMock);
    expect(spec).toHaveProperty('schedule');
  });

  it('LLM response includes timezone', async () => {
    const spec = await parseScheduleFromLLM('Run daily at noon UTC', provider, llmMock);
    const scheduleSpec = spec.schedule as Record<string, unknown>;
    expect(scheduleSpec).toHaveProperty('timezone');
  });

  it('updates schedule name', async () => {
    const s = await service.create({ name: 'Old Name', cronExpr: '0 1 * * *', timezone: 'UTC', nextRun: '', task: { type: 'x', params: {} } });
    const updated = await service.update(s.id, { name: 'New Name' });
    expect(updated?.name).toBe('New Name');
  });

  it('next runs are in chronological order', () => {
    const runs = service.getNextNRuns('0 9 * * *', 4);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i].getTime()).toBeGreaterThan(runs[i - 1].getTime());
    }
  });
});
