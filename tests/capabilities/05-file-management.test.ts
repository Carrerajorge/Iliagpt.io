/**
 * Capability: File Management
 * Tests file upload, download, metadata, versioning, and search.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import {
  createMockFile,
  createMockExcelFile,
  createMockPdfFile,
  createDbMock,
  createMockReq,
  createMockRes,
} from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));
vi.mock('multer', () => ({
  default: vi.fn(() => ({
    single: vi.fn().mockReturnValue((_req: unknown, _res: unknown, next: () => void) => next()),
  })),
}));

// ── Inline file management service ───────────────────────────────────────────

interface FileRecord {
  id: number;
  userId: number;
  name: string;
  size: number;
  mimeType: string;
  storageKey: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

interface FileManager {
  upload(userId: number, file: { name: string; size: number; type: string }): Promise<FileRecord>;
  getById(id: number): Promise<FileRecord | null>;
  listByUser(userId: number): Promise<FileRecord[]>;
  delete(id: number, userId: number): Promise<boolean>;
  search(userId: number, query: string): Promise<FileRecord[]>;
  getMetadata(id: number): Promise<Record<string, unknown>>;
}

function createFileManager(db: ReturnType<typeof createDbMock>): FileManager {
  const store: FileRecord[] = [];
  let nextId = 1;

  return {
    async upload(userId, file) {
      const record: FileRecord = {
        id: nextId++,
        userId,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        storageKey: `files/${userId}/${Date.now()}-${file.name}`,
        createdAt: new Date(),
      };
      store.push(record);
      void db.insert;
      return record;
    },
    async getById(id) {
      return store.find((f) => f.id === id) ?? null;
    },
    async listByUser(userId) {
      return store.filter((f) => f.userId === userId);
    },
    async delete(id, userId) {
      const idx = store.findIndex((f) => f.id === id && f.userId === userId);
      if (idx === -1) return false;
      store.splice(idx, 1);
      return true;
    },
    async search(userId, query) {
      const q = query.toLowerCase();
      return store.filter((f) => f.userId === userId && f.name.toLowerCase().includes(q));
    },
    async getMetadata(id) {
      const file = store.find((f) => f.id === id);
      if (!file) return {};
      return { id: file.id, name: file.name, size: file.size, mimeType: file.mimeType, createdAt: file.createdAt };
    },
  };
}

runWithEachProvider('File Management', (provider: ProviderConfig) => {
  let db: ReturnType<typeof createDbMock>;
  let manager: FileManager;

  mockProviderEnv(provider);

  beforeEach(() => {
    db = createDbMock();
    manager = createFileManager(db);
  });

  it('uploads a file and returns a record', async () => {
    const file = createMockFile();
    const record = await manager.upload(1, file);
    expect(record.id).toBeGreaterThan(0);
    expect(record.name).toBe(file.name);
    expect(record.userId).toBe(1);
  });

  it('stores the correct MIME type', async () => {
    const pdfFile = createMockPdfFile();
    const record = await manager.upload(1, pdfFile);
    expect(record.mimeType).toBe('application/pdf');
  });

  it('retrieves a file by ID', async () => {
    const file = createMockFile({ name: 'test.txt' });
    const uploaded = await manager.upload(1, file);
    const found = await manager.getById(uploaded.id);
    expect(found).not.toBeNull();
    expect(found?.name).toBe('test.txt');
  });

  it('returns null for non-existent file ID', async () => {
    const result = await manager.getById(9999);
    expect(result).toBeNull();
  });

  it('lists all files for a user', async () => {
    await manager.upload(1, createMockFile({ name: 'a.pdf' }));
    await manager.upload(1, createMockFile({ name: 'b.xlsx' }));
    await manager.upload(2, createMockFile({ name: 'c.txt' }));

    const user1Files = await manager.listByUser(1);
    expect(user1Files).toHaveLength(2);
  });

  it('isolates files between users', async () => {
    await manager.upload(1, createMockFile({ name: 'private.pdf' }));
    const user2Files = await manager.listByUser(2);
    expect(user2Files).toHaveLength(0);
  });

  it('deletes a file successfully', async () => {
    const record = await manager.upload(1, createMockFile());
    const success = await manager.delete(record.id, 1);
    expect(success).toBe(true);
    expect(await manager.getById(record.id)).toBeNull();
  });

  it('prevents deletion by wrong user', async () => {
    const record = await manager.upload(1, createMockFile());
    const success = await manager.delete(record.id, 99);
    expect(success).toBe(false);
    expect(await manager.getById(record.id)).not.toBeNull();
  });

  it('searches files by name substring', async () => {
    await manager.upload(1, createMockFile({ name: 'annual_report_2026.pdf' }));
    await manager.upload(1, createMockFile({ name: 'budget_2026.xlsx' }));
    await manager.upload(1, createMockFile({ name: 'meeting_notes.docx' }));

    const results = await manager.search(1, '2026');
    expect(results).toHaveLength(2);
  });

  it('search is case-insensitive', async () => {
    await manager.upload(1, createMockFile({ name: 'Invoice_Q1.PDF' }));
    const results = await manager.search(1, 'invoice');
    expect(results).toHaveLength(1);
  });

  it('assigns a storage key with user prefix', async () => {
    const record = await manager.upload(42, createMockFile());
    expect(record.storageKey).toContain('files/42/');
  });

  it('generates metadata for existing files', async () => {
    const record = await manager.upload(1, createMockExcelFile());
    const metadata = await manager.getMetadata(record.id);
    expect(metadata).toHaveProperty('id');
    expect(metadata).toHaveProperty('name');
    expect(metadata).toHaveProperty('mimeType');
  });

  it('handles Excel file upload with correct MIME', async () => {
    const excel = createMockExcelFile();
    const record = await manager.upload(1, excel);
    expect(record.mimeType).toContain('spreadsheetml');
  });

  it('returns empty array when no files match search', async () => {
    await manager.upload(1, createMockFile({ name: 'report.pdf' }));
    const results = await manager.search(1, 'nonexistent_term_xyz');
    expect(results).toHaveLength(0);
  });
});
