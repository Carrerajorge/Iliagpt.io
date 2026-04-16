/**
 * Capability: Cowork Projects
 * Tests collaborative AI workspaces: project creation, member management, shared context, tasks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { createLLMClientMock, expectValidJson, createDbMock } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));

interface CoworkMember {
  userId: number;
  role: 'owner' | 'editor' | 'viewer';
  joinedAt: Date;
}

interface CoworkTask {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'done';
  assignee?: number;
  priority: 'low' | 'medium' | 'high';
  createdAt: Date;
}

interface CoworkProject {
  id: string;
  name: string;
  description: string;
  members: CoworkMember[];
  tasks: CoworkTask[];
  sharedContext: string;
  createdAt: Date;
  updatedAt: Date;
}

class CoworkProjectService {
  private projects = new Map<string, CoworkProject>();
  private counter = 0;
  private taskCounter = 0;

  async createProject(
    name: string,
    description: string,
    ownerId: number,
    provider: ProviderConfig,
    llmClient: ReturnType<typeof createLLMClientMock>,
  ): Promise<CoworkProject> {
    // LLM generates initial project context and suggested tasks
    const response = await llmClient.chat.completions.create({
      model: provider.model,
      messages: [
        { role: 'system', content: 'Generate a project brief and initial tasks as JSON.' },
        { role: 'user', content: `Project: ${name}\n${description}` },
      ],
    });

    const spec = expectValidJson(response.choices[0].message.content);
    const now = new Date();

    const project: CoworkProject = {
      id: `proj_${++this.counter}`,
      name,
      description,
      members: [{ userId: ownerId, role: 'owner', joinedAt: now }],
      tasks: [],
      sharedContext: spec.synthesis as string ?? description,
      createdAt: now,
      updatedAt: now,
    };

    this.projects.set(project.id, project);
    return project;
  }

  getProject(id: string): CoworkProject | undefined {
    return this.projects.get(id);
  }

  addMember(projectId: string, userId: number, role: 'editor' | 'viewer'): boolean {
    const p = this.projects.get(projectId);
    if (!p) return false;
    if (p.members.some((m) => m.userId === userId)) return false;
    p.members.push({ userId, role, joinedAt: new Date() });
    return true;
  }

  removeMember(projectId: string, userId: number): boolean {
    const p = this.projects.get(projectId);
    if (!p) return false;
    const before = p.members.length;
    p.members = p.members.filter((m) => m.userId !== userId);
    return p.members.length < before;
  }

  addTask(projectId: string, title: string, priority: CoworkTask['priority'] = 'medium', assignee?: number): CoworkTask | null {
    const p = this.projects.get(projectId);
    if (!p) return null;
    const task: CoworkTask = {
      id: `task_${++this.taskCounter}`,
      title,
      status: 'todo',
      priority,
      assignee,
      createdAt: new Date(),
    };
    p.tasks.push(task);
    return task;
  }

  updateTaskStatus(projectId: string, taskId: string, status: CoworkTask['status']): boolean {
    const p = this.projects.get(projectId);
    if (!p) return false;
    const task = p.tasks.find((t) => t.id === taskId);
    if (!task) return false;
    task.status = status;
    return true;
  }

  getTasksByStatus(projectId: string, status: CoworkTask['status']): CoworkTask[] {
    return this.projects.get(projectId)?.tasks.filter((t) => t.status === status) ?? [];
  }

  getMemberRole(projectId: string, userId: number): CoworkMember['role'] | null {
    const p = this.projects.get(projectId);
    return p?.members.find((m) => m.userId === userId)?.role ?? null;
  }

  updateSharedContext(projectId: string, context: string): boolean {
    const p = this.projects.get(projectId);
    if (!p) return false;
    p.sharedContext = context;
    p.updatedAt = new Date();
    return true;
  }
}

const COWORK_RESPONSE = JSON.stringify({
  synthesis: 'This project focuses on building an AI-powered document analysis tool for enterprise clients.',
  suggestedTasks: ['Research competitors', 'Define MVP scope', 'Create wireframes', 'Write technical spec'],
  confidence: 0.9,
});

runWithEachProvider('Cowork Projects', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;
  let service: CoworkProjectService;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: COWORK_RESPONSE, model: provider.model });
    service = new CoworkProjectService();
  });

  it('creates a project with owner', async () => {
    const project = await service.createProject('AI Analyzer', 'Build enterprise AI tool', 1, provider, llmMock);
    expect(project.id).toBeTruthy();
    expect(project.members[0].userId).toBe(1);
    expect(project.members[0].role).toBe('owner');
  });

  it('generates shared context via LLM', async () => {
    const project = await service.createProject('Test Project', 'Description', 1, provider, llmMock);
    expect(project.sharedContext.length).toBeGreaterThan(0);
  });

  it('retrieves project by ID', async () => {
    const created = await service.createProject('P1', 'Desc', 1, provider, llmMock);
    const found = service.getProject(created.id);
    expect(found?.name).toBe('P1');
  });

  it('adds a new member as editor', async () => {
    const project = await service.createProject('Team Project', 'Collaborative', 1, provider, llmMock);
    const added = service.addMember(project.id, 2, 'editor');
    expect(added).toBe(true);
    expect(service.getMemberRole(project.id, 2)).toBe('editor');
  });

  it('prevents duplicate member addition', async () => {
    const project = await service.createProject('Dup Test', 'Test', 1, provider, llmMock);
    const first = service.addMember(project.id, 2, 'viewer');
    const second = service.addMember(project.id, 2, 'editor');
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('removes a member', async () => {
    const project = await service.createProject('Member Test', 'Test', 1, provider, llmMock);
    service.addMember(project.id, 5, 'viewer');
    const removed = service.removeMember(project.id, 5);
    expect(removed).toBe(true);
    expect(service.getMemberRole(project.id, 5)).toBeNull();
  });

  it('adds tasks to a project', async () => {
    const project = await service.createProject('Task Test', 'Tasks', 1, provider, llmMock);
    const task = service.addTask(project.id, 'Write tests', 'high');
    expect(task?.id).toBeTruthy();
    expect(task?.status).toBe('todo');
  });

  it('updates task status', async () => {
    const project = await service.createProject('Status Test', 'Test', 1, provider, llmMock);
    const task = service.addTask(project.id, 'Implement feature', 'medium')!;
    service.updateTaskStatus(project.id, task.id, 'in_progress');
    const inProgress = service.getTasksByStatus(project.id, 'in_progress');
    expect(inProgress.length).toBe(1);
  });

  it('filters tasks by status', async () => {
    const project = await service.createProject('Filter Test', 'Test', 1, provider, llmMock);
    service.addTask(project.id, 'Task A', 'high');
    service.addTask(project.id, 'Task B', 'low');
    const task = service.addTask(project.id, 'Task C', 'medium')!;
    service.updateTaskStatus(project.id, task.id, 'done');
    expect(service.getTasksByStatus(project.id, 'todo')).toHaveLength(2);
    expect(service.getTasksByStatus(project.id, 'done')).toHaveLength(1);
  });

  it('updates shared context', async () => {
    const project = await service.createProject('Context Test', 'Test', 1, provider, llmMock);
    const updated = service.updateSharedContext(project.id, 'New shared context');
    expect(updated).toBe(true);
    expect(service.getProject(project.id)?.sharedContext).toBe('New shared context');
  });

  it('calls LLM once on project creation', async () => {
    await service.createProject('LLM Test', 'Test', 1, provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('uses correct model', async () => {
    await service.createProject('Model Test', 'Test', 1, provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });
});
