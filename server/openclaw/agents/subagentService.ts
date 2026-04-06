export type SubagentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type SubagentPermissionProfile = 'read_only' | 'safe_coding' | 'full_agent';

export interface SubagentRunRecord {
  id: string;
  requesterUserId: string;
  chatId: string;
  objective: string;
  planHint: string[];
  parentRunId?: string;
  status: SubagentRunStatus;
  permissionProfile: SubagentPermissionProfile;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  progress?: number;
  stepCount: number;
  lastStepSummary?: string;
  outputExcerpt?: string;
  result?: unknown;
  error?: string;
}

type SpawnSubagentParams = {
  requesterUserId: string;
  objective: string;
  planHint?: string[];
  parentRunId?: string;
  chatId?: string;
  permissionProfile?: SubagentPermissionProfile;
};

type ListRunsParams = {
  requesterUserId?: string;
  chatId?: string;
  parentRunId?: string;
  status?: SubagentRunStatus;
  limit?: number;
};

type TaskRecordLike = {
  id: string;
  userId: string;
  chatId: string;
  parentRunId?: string;
  objective: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  createdAt: number;
  updatedAt?: number;
  startedAt?: number;
  endedAt?: number;
  output?: string;
  progress?: number;
  steps?: Array<{
    summary?: string;
    timestamp?: number;
  }>;
  result?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
};

type BackgroundTaskManagerLike = {
  spawn: (params: {
    userId: string;
    chatId: string;
    objective: string;
    instructions?: string;
    allowedTools?: string[];
    parentRunId?: string;
    priority?: 'low' | 'normal' | 'high' | 'critical';
    timeoutMs?: number;
    metadata?: Record<string, unknown>;
  }) => Promise<TaskRecordLike>;
  getOrFetch: (id: string) => Promise<TaskRecordLike | undefined>;
  list: (params: {
    userId?: string;
    chatId?: string;
    status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
    parentRunId?: string;
    limit?: number;
    offset?: number;
  }) => TaskRecordLike[];
  cancel: (id: string) => boolean;
};

const OPENCLAW_SUBAGENT_SOURCE = 'openclaw_subagent';
const DEFAULT_PERMISSION_PROFILE: SubagentPermissionProfile = 'full_agent';

async function getBackgroundTaskManager(): Promise<BackgroundTaskManagerLike> {
  const { backgroundTaskManager } = await import('../../tasks/BackgroundTaskManager');
  return backgroundTaskManager as unknown as BackgroundTaskManagerLike;
}

function buildInstructions(planHint: string[]): string | undefined {
  const normalized = planHint.map((step) => String(step).trim()).filter(Boolean);
  if (normalized.length === 0) {
    return undefined;
  }

  return [
    'Execution hints:',
    ...normalized.map((step, index) => `${index + 1}. ${step}`),
  ].join('\n');
}

function normalizePermissionProfile(raw: unknown): SubagentPermissionProfile {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  switch (value) {
    case 'read_only':
    case 'readonly':
    case 'read-only':
      return 'read_only';
    case 'safe':
    case 'safe_coding':
    case 'coding':
      return 'safe_coding';
    case 'full':
    case 'agent_full':
    case 'full_agent':
    default:
      return DEFAULT_PERMISSION_PROFILE;
  }
}

function mapStatus(
  status: TaskRecordLike['status'],
): SubagentRunStatus {
  switch (status) {
    case 'queued':
    case 'running':
    case 'completed':
    case 'cancelled':
      return status;
    case 'timeout':
    case 'failed':
    default:
      return 'failed';
  }
}

function isOpenClawSubagent(task: TaskRecordLike | undefined): task is TaskRecordLike {
  return Boolean(task?.metadata?.['source'] === OPENCLAW_SUBAGENT_SOURCE);
}

function buildOutputExcerpt(output: unknown): string | undefined {
  if (typeof output !== 'string') {
    return undefined;
  }

  const normalized = output.trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length > 280
    ? `...${normalized.slice(-277)}`
    : normalized;
}

function toRunRecord(task: TaskRecordLike): SubagentRunRecord {
  const metadata = task.metadata || {};
  const rawPlanHint = Array.isArray(metadata['planHint']) ? metadata['planHint'] : [];
  const planHint = rawPlanHint.map((step) => String(step).trim()).filter(Boolean);
  const steps = Array.isArray(task.steps) ? task.steps : [];
  const lastStep = steps.length > 0 ? steps[steps.length - 1] : undefined;
  const updatedAt = Number.isFinite(task.updatedAt)
    ? Number(task.updatedAt)
    : task.endedAt ?? lastStep?.timestamp ?? task.startedAt ?? task.createdAt;

  return {
    id: task.id,
    requesterUserId: task.userId,
    chatId: task.chatId,
    objective: task.objective,
    planHint,
    parentRunId: task.parentRunId,
    status: mapStatus(task.status),
    permissionProfile: normalizePermissionProfile(metadata['permissionProfile']),
    createdAt: task.createdAt,
    updatedAt,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    progress: typeof task.progress === 'number' ? task.progress : undefined,
    stepCount: steps.length,
    lastStepSummary: typeof lastStep?.summary === 'string' ? lastStep.summary : undefined,
    outputExcerpt: buildOutputExcerpt(task.output),
    result: task.result,
    error: task.error,
  };
}

class OpenClawSubagentService {
  async spawn(params: SpawnSubagentParams): Promise<SubagentRunRecord> {
    const manager = await getBackgroundTaskManager();
    const planHint = params.planHint?.map((step) => String(step).trim()).filter(Boolean) || [];
    const permissionProfile = normalizePermissionProfile(params.permissionProfile);
    const task = await manager.spawn({
      userId: params.requesterUserId,
      chatId: params.chatId || params.parentRunId || 'openclaw',
      objective: params.objective,
      instructions: buildInstructions(planHint),
      parentRunId: params.parentRunId,
      priority: 'normal',
      metadata: {
        source: OPENCLAW_SUBAGENT_SOURCE,
        permissionProfile,
        planHint,
      },
    });

    return toRunRecord(task);
  }

  async get(runId: string): Promise<SubagentRunRecord | undefined> {
    const manager = await getBackgroundTaskManager();
    const task = await manager.getOrFetch(runId);
    if (!isOpenClawSubagent(task)) {
      return undefined;
    }
    return toRunRecord(task);
  }

  async list(params: ListRunsParams = {}): Promise<SubagentRunRecord[]> {
    const manager = await getBackgroundTaskManager();
    const tasks = manager.list({
      userId: params.requesterUserId,
      chatId: params.chatId,
      parentRunId: params.parentRunId,
      limit: params.limit ? Math.max(1, params.limit) : 100,
    });

    return tasks
      .filter(isOpenClawSubagent)
      .map(toRunRecord)
      .filter((run) => !params.status || run.status === params.status)
      .slice(0, Math.max(1, params.limit || 100));
  }

  async cancel(runId: string): Promise<boolean> {
    const manager = await getBackgroundTaskManager();
    const task = await manager.getOrFetch(runId);
    if (!isOpenClawSubagent(task)) {
      return false;
    }
    return manager.cancel(runId);
  }
}

export const openclawSubagentService = new OpenClawSubagentService();
