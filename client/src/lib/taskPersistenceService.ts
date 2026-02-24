export interface BackgroundTask {
  id?: number;
  action: string;
  attempts?: number;
  row?: number;
  col?: number;
  value?: any;
  formula?: string;
  format?: Record<string, any>;
  cells?: Array<{ row: number; col: number; value: any }>;
  sheetId?: string;
  name?: string;
  chartType?: string;
  dataRange?: string;
  options?: Record<string, any>;
  range?: string;
  context?: Record<string, any>;
  priority?: number;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface TaskResult {
  id?: number;
  taskId: number;
  result: any;
  completedAt: number;
}

export interface ProcessingState {
  key: string;
  value: any;
  updatedAt: number;
}

export class TaskPersistenceService {
  private readonly dbName = 'ExcelBackgroundProcessing';
  private readonly dbVersion = 2;
  private readonly maxPendingTasks = 1000;
  private readonly maxCompletedResults = 1000;
  private readonly retentionDays = 14;
  private db: IDBDatabase | null = null;

  private readonly stores = {
    tasks: 'pendingTasks',
    results: 'completedResults',
    state: 'processingState'
  };

  async initialize(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(new Error('Failed to open IndexedDB'));

      request.onsuccess = async (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        try {
          await this.pruneOldData();
          console.log('IndexedDB listo');
          resolve(this.db);
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Failed to initialize database'));
        }
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(this.stores.tasks)) {
          const taskStore = db.createObjectStore(this.stores.tasks, {
            keyPath: 'id',
            autoIncrement: true
          });
          taskStore.createIndex('status', 'status', { unique: false });
          taskStore.createIndex('priority', 'priority', { unique: false });
          taskStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(this.stores.results)) {
          const resultStore = db.createObjectStore(this.stores.results, {
            keyPath: 'id',
            autoIncrement: true
          });
          resultStore.createIndex('taskId', 'taskId', { unique: false });
          resultStore.createIndex('completedAt', 'completedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(this.stores.state)) {
          db.createObjectStore(this.stores.state, { keyPath: 'key' });
        }
      };
    });
  }

  private assertInitialized(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
  }

  private sanitizeTask(task: BackgroundTask): BackgroundTask {
    return {
      ...task,
      action: typeof task.action === 'string' ? task.action.slice(0, 128) : '',
      attempts: Number.isFinite(task.attempts) && task.attempts >= 0 ? Math.min(1000, Math.floor(task.attempts)) : 0,
      priority: Number.isFinite(task.priority) ? Math.max(0, Math.min(1000, task.priority || 0)) : 0,
      status: task.status === 'running' || task.status === 'failed' || task.status === 'done' || task.status === 'pending' ? task.status : 'pending',
      row: typeof task.row === 'number' ? task.row : undefined,
      col: typeof task.col === 'number' ? task.col : undefined,
      createdAt: typeof task.createdAt === 'number' ? task.createdAt : Date.now(),
      updatedAt: typeof task.updatedAt === 'number' ? task.updatedAt : Date.now(),
      value: typeof task.value === 'string' || typeof task.value === 'number' || typeof task.value === 'boolean' || task.value === null || typeof task.value === 'object'
        ? task.value
        : undefined,
    };
  }

  private async pruneOldData(): Promise<void> {
    this.assertInitialized();

    const retentionMs = this.retentionDays * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - retentionMs;

    const tasks = await this._promisifyRequest<BackgroundTask[]>(
      this.db!.transaction(this.stores.tasks, 'readonly').objectStore(this.stores.tasks).getAll()
    );

    const oldTasks = tasks.filter(t => (t.createdAt || 0) < cutoff);
    if (oldTasks.length > 0) {
      const tx = this.db!.transaction(this.stores.tasks, 'readwrite');
      const store = tx.objectStore(this.stores.tasks);
      await Promise.all(oldTasks.map(t => this._promisifyRequest(store.delete(t.id as number))));
    }

    const results = await this._promisifyRequest<TaskResult[]>(
      this.db!.transaction(this.stores.results, 'readonly').objectStore(this.stores.results).getAll()
    );

    const oldResults = results.filter(r => (r.completedAt || 0) < cutoff);
    if (oldResults.length > 0) {
      const tx = this.db!.transaction(this.stores.results, 'readwrite');
      const store = tx.objectStore(this.stores.results);
      await Promise.all(oldResults.map(r => this._promisifyRequest(store.delete(r.id as number))));
    }

    await this.enforceTaskLimits();
    await this.enforceResultLimits();
  }

  private async enforceTaskLimits(): Promise<void> {
    this.assertInitialized();

    const allTasks = await this.getPendingTasksRaw();
    const pending = allTasks
      .filter(task => task.status !== 'done')
      .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.createdAt || 0) - (a.createdAt || 0));

    if (pending.length <= this.maxPendingTasks) {
      return;
    }

    const toDelete = pending
      .slice(this.maxPendingTasks)
      .map(task => task.id)
      .filter((id): id is number => typeof id === 'number');

    if (toDelete.length === 0) return;

    const tx = this.db!.transaction(this.stores.tasks, 'readwrite');
    const store = tx.objectStore(this.stores.tasks);
    await Promise.all(toDelete.map(id => this._promisifyRequest(store.delete(id))));
  }

  private async enforceResultLimits(): Promise<void> {
    this.assertInitialized();

    const results = await this._promisifyRequest<TaskResult[]>(
      this.db!.transaction(this.stores.results, 'readonly').objectStore(this.stores.results).getAll()
    );

    const ordered = results.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    if (ordered.length <= this.maxCompletedResults) {
      return;
    }

    const toDelete = ordered.slice(this.maxCompletedResults).map(r => r.id).filter((id): id is number => typeof id === 'number');
    if (toDelete.length === 0) return;

    const tx = this.db!.transaction(this.stores.results, 'readwrite');
    const store = tx.objectStore(this.stores.results);
    await Promise.all(toDelete.map(id => this._promisifyRequest(store.delete(id))));
  }

  async saveTasks(tasks: BackgroundTask[]): Promise<number[]> {
    this.assertInitialized();

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return [];
    }

    const tx = this.db!.transaction(this.stores.tasks, 'readwrite');
    const store = tx.objectStore(this.stores.tasks);

    const ids: number[] = [];
    for (const task of tasks) {
      const sanitizedTask = this.sanitizeTask(task);
      const id = await this._promisifyRequest<number>(store.add({
        ...sanitizedTask,
        status: 'pending',
        priority: sanitizedTask.priority || 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: sanitizedTask.attempts || 0,
      }));
      ids.push(id);
    }

    await this.enforceTaskLimits();
    return ids;
  }

  async getPendingTasks(): Promise<BackgroundTask[]> {
    this.assertInitialized();

    const tx = this.db!.transaction(this.stores.tasks, 'readonly');
    const store = tx.objectStore(this.stores.tasks);
    const index = store.index('status');
    return this._promisifyRequest<BackgroundTask[]>(index.getAll('pending'));
  }

  async updateTaskStatus(taskId: number, status: string): Promise<void> {
    this.assertInitialized();

    const tx = this.db!.transaction(this.stores.tasks, 'readwrite');
    const store = tx.objectStore(this.stores.tasks);

    const task = await this._promisifyRequest<BackgroundTask>(store.get(taskId));
    if (task) {
      task.status = status;
      task.updatedAt = Date.now();
      await this._promisifyRequest(store.put(task));
      await this.pruneOldData();
    }
  }

  async removeCompletedTasks(): Promise<void> {
    this.assertInitialized();

    const tx = this.db!.transaction(this.stores.tasks, 'readwrite');
    const store = tx.objectStore(this.stores.tasks);
    const index = store.index('status');

    const completed = await this._promisifyRequest<IDBValidKey[]>(index.getAllKeys('completed'));
    for (const key of completed) {
      await this._promisifyRequest(store.delete(key));
    }

    await this.enforceTaskLimits();
  }

  async clearAllTasks(): Promise<void> {
    this.assertInitialized();

    const tx = this.db!.transaction(this.stores.tasks, 'readwrite');
    const store = tx.objectStore(this.stores.tasks);
    await this._promisifyRequest(store.clear());
  }

  async saveResult(taskId: number, result: any): Promise<number> {
    this.assertInitialized();

    const tx = this.db!.transaction(this.stores.results, 'readwrite');
    const store = tx.objectStore(this.stores.results);

    const resultWithMeta = {
      taskId,
      result,
      completedAt: Date.now()
    };

    const id = await this._promisifyRequest<number>(store.add(resultWithMeta));
    await this.enforceResultLimits();
    return id;
  }

  async getResults(since = 0): Promise<TaskResult[]> {
    this.assertInitialized();

    const tx = this.db!.transaction(this.stores.results, 'readonly');
    const store = tx.objectStore(this.stores.results);
    const index = store.index('completedAt');
    const range = IDBKeyRange.lowerBound(since);
    return this._promisifyRequest<TaskResult[]>(index.getAll(range));
  }

  async clearResults(): Promise<void> {
    this.assertInitialized();

    const tx = this.db!.transaction(this.stores.results, 'readwrite');
    const store = tx.objectStore(this.stores.results);
    await this._promisifyRequest(store.clear());
  }

  async saveState(key: string, value: any): Promise<void> {
    this.assertInitialized();

    const tx = this.db!.transaction(this.stores.state, 'readwrite');
    const store = tx.objectStore(this.stores.state);
    await this._promisifyRequest(store.put({ key, value, updatedAt: Date.now() }));
  }

  async getState(key: string): Promise<any> {
    this.assertInitialized();

    const tx = this.db!.transaction(this.stores.state, 'readonly');
    const store = tx.objectStore(this.stores.state);
    const result = await this._promisifyRequest<ProcessingState>(store.get(key));
    return result?.value;
  }

  private getPendingTasksRaw(): Promise<BackgroundTask[]> {
    this.assertInitialized();
    return this._promisifyRequest<BackgroundTask[]>(
      this.db!.transaction(this.stores.tasks, 'readonly').objectStore(this.stores.tasks).getAll()
    );
  }

  private _promisifyRequest<T>(request: IDBRequest): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  }
}
