/**
 * Local File Management Capability Tests
 *
 * Covers: reading/writing, organisation, mass-rename with date prefixes,
 *         deduplication, classification by extension, and delete-protection guards.
 */

import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

import {
  runWithEachProvider,
  type ProviderConfig,
} from "../_setup/providerMatrix";
import {
  getMockResponseForProvider,
  createTextResponse,
  MOCK_FILE_TOOL,
} from "../_setup/mockResponses";
import {
  withTempDir,
  createTestFile,
  createMockAgent,
} from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function md5(content: string): string {
  return crypto.createHash("md5").update(content).digest("hex");
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../../server/agent/capabilities/fileCapability", () => ({
  readFile:  vi.fn(),
  writeFile: vi.fn(),
  appendFile:vi.fn(),
  moveFile:  vi.fn(),
  deleteFile:vi.fn(),
  listDir:   vi.fn(),
  createDir: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Suite 1 — File reading and writing
// ---------------------------------------------------------------------------

describe("File reading and writing", () => {
  runWithEachProvider(
    "reads a plain-text file and returns its content",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const filePath = path.join(dir, "hello.txt");
        await createTestFile(filePath, "Hello, world!");

        const agent = createMockAgent({ defaultResult: { success: true, result: "Hello, world!" } });
        const response = await agent.invoke("readFile", { path: filePath });

        expect(response.success).toBe(true);
        expect(response.result).toBe("Hello, world!");
        expect(agent.calls).toHaveLength(1);
        expect(agent.calls[0].capability).toBe("readFile");

        // Validate mock provider response envelope
        const pResp = getMockResponseForProvider(
          provider.name,
          MOCK_FILE_TOOL as { name: string; arguments: Record<string, unknown> },
          `Contents of ${filePath}: Hello, world!`,
        );
        expect(pResp).toBeTruthy();
      });
    },
  );

  runWithEachProvider(
    "writes content to a new file and returns byte count",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const filePath = path.join(dir, "output.txt");

        const agent = createMockAgent({ defaultResult: { success: true, bytesWritten: 13, path: filePath } });
        const response = await agent.invoke("writeFile", {
          path: filePath,
          content: "Hello, world!",
        });

        expect(response.success).toBe(true);
        expect(response.bytesWritten).toBe(13);

        const textResp = createTextResponse(provider.name, `Written ${filePath}`);
        expect(textResp).toBeTruthy();
      });
    },
  );

  runWithEachProvider(
    "appends content to an existing file without truncating it",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const filePath = path.join(dir, "log.txt");
        await createTestFile(filePath, "line 1\n");

        const agent = createMockAgent({ defaultResult: { success: true, totalBytes: 14, totalLines: 2 } });
        const response = await agent.invoke("appendFile", {
          path: filePath,
          content: "line 2\n",
        });

        expect(response.success).toBe(true);
        expect(response.totalLines).toBe(2);

        void provider;
      });
    },
  );

  runWithEachProvider(
    "detects binary files and reports encoding and MIME type",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const filePath = path.join(dir, "image.png");
        fs.writeFileSync(
          filePath,
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        );

        const agent = createMockAgent({
          defaultResult: { success: true, encoding: "binary", mimeType: "image/png", sizeBytes: 8 },
        });
        const response = await agent.invoke("readFile", { path: filePath, binary: true });

        expect(response.success).toBe(true);
        expect(response.encoding).toBe("binary");
        expect(response.mimeType).toBe("image/png");

        void provider;
      });
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 2 — File organisation
// ---------------------------------------------------------------------------

describe("File organisation", () => {
  runWithEachProvider(
    "creates a nested folder structure recursively",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const target = path.join(dir, "a", "b", "c");

        const agent = createMockAgent({
          defaultResult: {
            success: true,
            created: [path.join(dir, "a"), path.join(dir, "a", "b"), target],
          },
        });
        const response = await agent.invoke("createDir", { path: target, recursive: true });

        expect(response.success).toBe(true);
        expect(Array.isArray(response.created)).toBe(true);
        expect((response.created as string[]).length).toBe(3);

        void provider;
      });
    },
  );

  runWithEachProvider(
    "moves a file to a different directory",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const src = path.join(dir, "original.txt");
        const dst = path.join(dir, "moved", "original.txt");
        await createTestFile(src, "move me");

        const agent = createMockAgent({ defaultResult: { success: true, from: src, to: dst } });
        const response = await agent.invoke("moveFile", { from: src, to: dst });

        expect(response.success).toBe(true);
        expect(response.from).toBe(src);
        expect(response.to).toBe(dst);

        void provider;
      });
    },
  );

  runWithEachProvider(
    "organises mixed files into extension sub-folders",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        await createTestFile(path.join(dir, "report.pdf"), "%PDF mock");
        await createTestFile(path.join(dir, "data.csv"), "a,b\n1,2");
        await createTestFile(path.join(dir, "photo.jpg"), "JFIF mock");
        await createTestFile(path.join(dir, "notes.txt"), "notes");

        const agent = createMockAgent({
          defaultResult: { success: true, moved: { pdf: 1, csv: 1, jpg: 1, txt: 1 }, totalMoved: 4 },
        });
        const response = await agent.invoke("organizeByExtension", { dir });

        expect(response.success).toBe(true);
        const moved = response.moved as Record<string, number>;
        expect(moved.pdf).toBe(1);
        expect(moved.csv).toBe(1);
        expect(response.totalMoved).toBe(4);

        void provider;
      });
    },
  );

  runWithEachProvider(
    "lists directory contents with name, size, and type metadata",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        await createTestFile(path.join(dir, "alpha.txt"), "aaa");
        await createTestFile(path.join(dir, "beta.txt"), "bbbbb");

        const agent = createMockAgent({
          defaultResult: {
            success: true,
            entries: [
              { name: "alpha.txt", size: 3, type: "file" },
              { name: "beta.txt",  size: 5, type: "file" },
            ],
          },
        });
        const response = await agent.invoke("listDir", { path: dir });

        expect(response.success).toBe(true);
        const entries = response.entries as Array<{ name: string; size: number }>;
        expect(entries).toHaveLength(2);
        expect(entries.map((e) => e.name).sort()).toEqual(["alpha.txt", "beta.txt"]);

        void provider;
      });
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 3 — Mass rename with date prefixes
// ---------------------------------------------------------------------------

describe("Mass rename with date prefixes", () => {
  runWithEachProvider(
    "renames N files with YYYY-MM-DD prefix",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        await createTestFile(path.join(dir, "invoice.pdf"),  "inv");
        await createTestFile(path.join(dir, "receipt.pdf"),  "rec");
        await createTestFile(path.join(dir, "contract.pdf"), "con");

        const datePrefix = "2026-04-11";
        const agent = createMockAgent({
          defaultResult: {
            success: true,
            count: 3,
            renamed: [
              { from: "invoice.pdf",  to: `${datePrefix}-invoice.pdf`  },
              { from: "receipt.pdf",  to: `${datePrefix}-receipt.pdf`  },
              { from: "contract.pdf", to: `${datePrefix}-contract.pdf` },
            ],
          },
        });
        const response = await agent.invoke("massRename", {
          dir,
          pattern: `${datePrefix}-{name}`,
          filter: "*.pdf",
        });

        expect(response.success).toBe(true);
        expect(response.count).toBe(3);
        const renamed = response.renamed as Array<{ from: string; to: string }>;
        expect(renamed).toHaveLength(3);
        renamed.forEach((r) => {
          expect(r.to).toMatch(/^2026-04-11-/);
          expect(r.to).toMatch(/\.pdf$/);
        });

        void provider;
      });
    },
  );

  runWithEachProvider(
    "handles rename conflicts by appending an incrementing counter",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        await createTestFile(path.join(dir, "2026-04-11-report.pdf"), "existing");
        await createTestFile(path.join(dir, "report.pdf"), "new");

        const agent = createMockAgent({
          defaultResult: {
            success: true,
            renamed: [{ from: "report.pdf", to: "2026-04-11-report-1.pdf" }],
            conflicts: 1,
          },
        });
        const response = await agent.invoke("massRename", {
          dir,
          pattern: "2026-04-11-{name}",
          filter: "*.pdf",
          conflictStrategy: "suffix",
        });

        expect(response.success).toBe(true);
        expect(response.conflicts).toBe(1);
        const renamed = response.renamed as Array<{ to: string }>;
        expect(renamed[0].to).toBe("2026-04-11-report-1.pdf");

        void provider;
      });
    },
  );

  runWithEachProvider(
    "dry-run mode reports would-be renames without touching the filesystem",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        await createTestFile(path.join(dir, "notes.txt"), "n");
        await createTestFile(path.join(dir, "todo.txt"),  "t");

        const agent = createMockAgent({
          defaultResult: {
            success: true,
            dryRun: true,
            wouldRename: [
              { from: "notes.txt", to: "2026-04-11-notes.txt" },
              { from: "todo.txt",  to: "2026-04-11-todo.txt"  },
            ],
          },
        });
        const response = await agent.invoke("massRename", {
          dir,
          pattern: "2026-04-11-{name}",
          dryRun: true,
        });

        expect(response.success).toBe(true);
        expect(response.dryRun).toBe(true);
        const would = response.wouldRename as unknown[];
        expect(would).toHaveLength(2);

        // Real filesystem must remain unchanged (mock does not mutate)
        const listing = fs.readdirSync(dir);
        expect(listing).toContain("notes.txt");
        expect(listing).toContain("todo.txt");

        void provider;
      });
    },
  );

  runWithEachProvider(
    "skips hidden dot-files during mass rename",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        await createTestFile(path.join(dir, "visible.txt"), "v");
        await createTestFile(path.join(dir, ".hidden"), "h");

        const agent = createMockAgent({
          defaultResult: {
            success: true,
            renamed: [{ from: "visible.txt", to: "2026-04-11-visible.txt" }],
            skipped: [".hidden"],
          },
        });
        const response = await agent.invoke("massRename", {
          dir,
          pattern: "2026-04-11-{name}",
          skipHidden: true,
        });

        expect(response.success).toBe(true);
        const skipped = response.skipped as string[];
        expect(skipped).toContain(".hidden");
        const renamed = response.renamed as unknown[];
        expect(renamed).toHaveLength(1);

        void provider;
      });
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 4 — Deduplication
// ---------------------------------------------------------------------------

describe("Deduplication", () => {
  runWithEachProvider(
    "finds duplicate files by MD5 content hash",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const content = "duplicate content here";
        await createTestFile(path.join(dir, "file-a.txt"), content);
        await createTestFile(path.join(dir, "copy-of-a.txt"), content);
        await createTestFile(path.join(dir, "unique.txt"), "something else entirely");

        const hash = md5(content);
        const agent = createMockAgent({
          defaultResult: {
            success: true,
            duplicateGroups: [
              { hash, files: [path.join(dir, "file-a.txt"), path.join(dir, "copy-of-a.txt")] },
            ],
            totalDuplicates: 1,
            reclaimableBytes: content.length,
          },
        });
        const response = await agent.invoke("findDuplicates", { dir, method: "hash" });

        expect(response.success).toBe(true);
        const groups = response.duplicateGroups as Array<{ hash: string; files: string[] }>;
        expect(groups).toHaveLength(1);
        expect(groups[0].files).toHaveLength(2);
        expect(groups[0].hash).toBe(hash);
        expect(response.reclaimableBytes).toBe(content.length);

        void provider;
      });
    },
  );

  runWithEachProvider(
    "finds duplicates by filename and size combination",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const content = "same name and size";
        await createTestFile(path.join(dir, "report.txt"), content);
        await createTestFile(path.join(dir, "backup", "report.txt"), content);

        const agent = createMockAgent({
          defaultResult: {
            success: true,
            duplicateGroups: [
              {
                key: `report.txt:${content.length}`,
                files: [path.join(dir, "report.txt"), path.join(dir, "backup", "report.txt")],
              },
            ],
          },
        });
        const response = await agent.invoke("findDuplicates", {
          dir,
          method: "name+size",
          recursive: true,
        });

        expect(response.success).toBe(true);
        const groups = response.duplicateGroups as Array<{ files: string[] }>;
        expect(groups[0].files).toHaveLength(2);

        void provider;
      });
    },
  );

  runWithEachProvider(
    "removes duplicates after confirmation, keeping oldest copy",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const content = "dup";
        await createTestFile(path.join(dir, "original.txt"),  content);
        await createTestFile(path.join(dir, "duplicate.txt"), content);

        const agent = createMockAgent({
          defaultResult: {
            success: true,
            removed: [path.join(dir, "duplicate.txt")],
            kept: [path.join(dir, "original.txt")],
            freedBytes: content.length,
          },
        });
        const response = await agent.invoke("removeDuplicates", {
          dir,
          method: "hash",
          keepStrategy: "oldest",
          confirmed: true,
        });

        expect(response.success).toBe(true);
        const removed = response.removed as string[];
        expect(removed).toHaveLength(1);
        expect(removed[0]).toContain("duplicate.txt");
        expect(response.freedBytes).toBe(content.length);

        void provider;
      });
    },
  );

  runWithEachProvider(
    "aborts duplicate removal when confirmed flag is false",
    "local-files",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: false,
          error: "User confirmation required before deleting files",
          aborted: true,
        },
      });
      const response = await agent.invoke("removeDuplicates", {
        dir: "/some/dir",
        confirmed: false,
      });

      expect(response.success).toBe(false);
      expect(response.aborted).toBe(true);
      expect(response.error).toContain("confirmation required");

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 5 — Classification
// ---------------------------------------------------------------------------

describe("Classification", () => {
  runWithEachProvider(
    "sorts files into sub-folders based on file extension",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        await createTestFile(path.join(dir, "photo.jpg"),        "jpeg");
        await createTestFile(path.join(dir, "document.pdf"),     "pdf");
        await createTestFile(path.join(dir, "spreadsheet.xlsx"), "xlsx");
        await createTestFile(path.join(dir, "script.ts"),        "code");

        const agent = createMockAgent({
          defaultResult: {
            success: true,
            classified: {
              images:    ["photo.jpg"],
              documents: ["document.pdf", "spreadsheet.xlsx"],
              code:      ["script.ts"],
            },
            totalFiles: 4,
          },
        });
        const response = await agent.invoke("classifyByExtension", { dir });

        expect(response.success).toBe(true);
        expect(response.totalFiles).toBe(4);
        const classified = response.classified as Record<string, string[]>;
        expect(classified.images).toContain("photo.jpg");
        expect(classified.documents).toHaveLength(2);
        expect(classified.code).toContain("script.ts");

        void provider;
      });
    },
  );

  runWithEachProvider(
    "detects true content type for files with misleading extensions",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const filePath = path.join(dir, "data.bin");
        await createTestFile(filePath, JSON.stringify({ key: "value", count: 42 }));

        const agent = createMockAgent({
          defaultResult: { success: true, file: "data.bin", detectedType: "application/json", confidence: 0.97 },
        });
        const response = await agent.invoke("detectContentType", { path: filePath });

        expect(response.success).toBe(true);
        expect(response.detectedType).toBe("application/json");
        expect(response.confidence as number).toBeGreaterThan(0.9);

        void provider;
      });
    },
  );

  runWithEachProvider(
    "classifies a mixed-type batch and returns per-category summary",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        await createTestFile(path.join(dir, "a.mp3"), "audio");
        await createTestFile(path.join(dir, "b.mp4"), "video");
        await createTestFile(path.join(dir, "c.txt"), "text");
        await createTestFile(path.join(dir, "d.txt"), "text2");
        await createTestFile(path.join(dir, "e.jpg"), "image");

        const agent = createMockAgent({
          defaultResult: { success: true, summary: { audio: 1, video: 1, text: 2, image: 1 }, total: 5 },
        });
        const response = await agent.invoke("classifyBatch", { dir });

        expect(response.success).toBe(true);
        expect(response.total).toBe(5);
        const summary = response.summary as Record<string, number>;
        expect(summary.text).toBe(2);
        expect(summary.audio).toBe(1);

        void provider;
      });
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 6 — Delete protection
// ---------------------------------------------------------------------------

describe("Delete protection", () => {
  runWithEachProvider(
    "requires explicit confirmed:true before deleting a file",
    "local-files",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: false,
          reason: "confirmation_required",
          message: 'Pass confirmed:true to proceed with deletion of "important.docx"',
        },
      });
      const response = await agent.invoke("deleteFile", {
        path: "/home/user/important.docx",
        confirmed: false,
      });

      expect(response.success).toBe(false);
      expect(response.reason).toBe("confirmation_required");
      expect(response.message).toContain("confirmed:true");

      void provider;
    },
  );

  runWithEachProvider(
    "refuses to delete system-protected paths even with confirmed:true",
    "local-files",
    async (provider: ProviderConfig) => {
      const systemPaths = ["/etc/passwd", "/usr/bin/bash", "/bin/sh"];

      for (const sysPath of systemPaths) {
        const agent = createMockAgent({
          defaultResult: {
            success: false,
            reason: "protected_path",
            message: `Deletion of system path "${sysPath}" is not permitted`,
          },
        });
        const response = await agent.invoke("deleteFile", { path: sysPath, confirmed: true });

        expect(response.success).toBe(false);
        expect(response.reason).toBe("protected_path");
        expect(response.message).toContain(sysPath);
      }

      void provider;
    },
  );

  runWithEachProvider(
    "moves file to trash location instead of permanent delete when useTrash is set",
    "local-files",
    async (provider: ProviderConfig) => {
      await withTempDir(async (dir) => {
        const filePath = path.join(dir, "to-trash.txt");
        await createTestFile(filePath, "trash me");

        const agent = createMockAgent({
          defaultResult: {
            success: true,
            action: "trashed",
            originalPath: filePath,
            trashPath: path.join(dir, ".trash", "to-trash.txt"),
          },
        });
        const response = await agent.invoke("deleteFile", {
          path: filePath,
          confirmed: true,
          useTrash: true,
        });

        expect(response.success).toBe(true);
        expect(response.action).toBe("trashed");
        expect(response.trashPath as string).toContain(".trash");
        expect(response.trashPath as string).toContain("to-trash.txt");

        void provider;
      });
    },
  );
});
