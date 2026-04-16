import { describe, expect, it, afterEach, vi, beforeEach } from "vitest";
import * as fs from "fs/promises";

/**
 * Codex Engine Tests — sandbox, file operations, templates, command validation,
 * session management, iteration limits, and auto-correction flow.
 */

describe("Codex Sandbox", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const p of cleanupPaths) {
      await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    }
    cleanupPaths.length = 0;
  });

  it("creates a sandbox workspace", async () => {
    const { createSandbox } = await import("../codex/sandbox");
    const sandbox = await createSandbox("test-sandbox-1");
    cleanupPaths.push(sandbox.workspace);

    const stat = await fs.stat(sandbox.workspace);
    expect(stat.isDirectory()).toBe(true);
    expect(sandbox.workspace).toContain("codex-test-sandbox-1");
  });

  it("writes and reads files within sandbox", async () => {
    const { createSandbox } = await import("../codex/sandbox");
    const sandbox = await createSandbox("test-rw-1");
    cleanupPaths.push(sandbox.workspace);

    await sandbox.writeFile("hello.txt", "Hello World");
    const content = await sandbox.readFile("hello.txt");
    expect(content).toBe("Hello World");
  });

  it("creates nested directories automatically", async () => {
    const { createSandbox } = await import("../codex/sandbox");
    const sandbox = await createSandbox("test-nested-1");
    cleanupPaths.push(sandbox.workspace);

    await sandbox.writeFile("src/components/App.tsx", "export default function App() {}");
    const content = await sandbox.readFile("src/components/App.tsx");
    expect(content).toContain("App");
  });

  it("lists files recursively", async () => {
    const { createSandbox } = await import("../codex/sandbox");
    const sandbox = await createSandbox("test-list-1");
    cleanupPaths.push(sandbox.workspace);

    await sandbox.writeFile("package.json", "{}");
    await sandbox.writeFile("src/index.ts", "console.log('hi')");

    const files = await sandbox.listFiles();
    const names = files.map(f => f.name);
    expect(names).toContain("package.json");
    expect(files.find(f => f.name === "src" && f.type === "directory")).toBeDefined();
    expect(files.find(f => f.name === "index.ts" && f.type === "file")).toBeDefined();
  });

  it("blocks path traversal attacks", async () => {
    const { createSandbox } = await import("../codex/sandbox");
    const sandbox = await createSandbox("test-escape-1");
    cleanupPaths.push(sandbox.workspace);

    await expect(sandbox.readFile("../../etc/passwd")).rejects.toThrow(/escapes workspace/i);
    await expect(sandbox.writeFile("../../../tmp/evil.txt", "hacked")).rejects.toThrow(/escapes workspace/i);
  });

  it("validates command safety (blocks rm -rf /)", async () => {
    const { createSandbox } = await import("../codex/sandbox");
    const sandbox = await createSandbox("test-block-1");
    cleanupPaths.push(sandbox.workspace);

    await expect(sandbox.exec("rm -rf /")).rejects.toThrow(/blocked/i);
  });

  it("validates command safety (blocks sudo)", async () => {
    const { createSandbox } = await import("../codex/sandbox");
    const sandbox = await createSandbox("test-block-2");
    cleanupPaths.push(sandbox.workspace);

    await expect(sandbox.exec("sudo apt install something")).rejects.toThrow(/blocked/i);
  });

  it("validates command safety (blocks fork bomb)", async () => {
    const { createSandbox } = await import("../codex/sandbox");
    const sandbox = await createSandbox("test-block-3");
    cleanupPaths.push(sandbox.workspace);

    await expect(sandbox.exec(":(){ :|:& };:")).rejects.toThrow(/blocked/i);
  });

  it("validates command safety (blocks chmod 777)", async () => {
    const { createSandbox } = await import("../codex/sandbox");
    const sandbox = await createSandbox("test-block-4");
    cleanupPaths.push(sandbox.workspace);

    await expect(sandbox.exec("chmod 777 /etc/passwd")).rejects.toThrow(/blocked/i);
  });

  it("runs simple commands successfully", async () => {
    const { createSandbox } = await import("../codex/sandbox");
    const sandbox = await createSandbox("test-exec-1");
    cleanupPaths.push(sandbox.workspace);

    const result = await sandbox.exec("echo 'hello world'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello world");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("respects command timeout", async () => {
    const { createSandbox } = await import("../codex/sandbox");
    const sandbox = await createSandbox("test-timeout-1");
    cleanupPaths.push(sandbox.workspace);

    const result = await sandbox.exec("sleep 10", 500);
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toContain("timeout");
  });

  it("reports non-zero exit codes", async () => {
    const { createSandbox } = await import("../codex/sandbox");
    const sandbox = await createSandbox("test-exitcode-1");
    cleanupPaths.push(sandbox.workspace);

    const result = await sandbox.exec("exit 42");
    expect(result.exitCode).toBe(42);
  });

  it("cleans up workspace on cleanup()", async () => {
    const { createSandbox } = await import("../codex/sandbox");
    const sandbox = await createSandbox("test-cleanup-1");

    await sandbox.writeFile("test.txt", "data");
    const ws = sandbox.workspace;
    await sandbox.cleanup();

    const exists = await fs.access(ws).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it("tracks active process count", async () => {
    const { createSandbox } = await import("../codex/sandbox");
    const sandbox = await createSandbox("test-proccount-1");
    cleanupPaths.push(sandbox.workspace);

    expect(sandbox.activeProcesses).toBe(0);

    // Start a short command and verify count returns to 0 after
    await sandbox.exec("echo hi");
    expect(sandbox.activeProcesses).toBe(0);
  });

  it("rejects when process limit is exceeded", async () => {
    const { createSandbox } = await import("../codex/sandbox");
    const sandbox = await createSandbox("test-proclimit-1");
    cleanupPaths.push(sandbox.workspace);

    // Launch 10 long-running processes (fills the limit)
    const procs: Promise<any>[] = [];
    for (let i = 0; i < 10; i++) {
      procs.push(sandbox.exec("sleep 5", 10_000));
    }

    // 11th should be rejected
    await expect(sandbox.exec("echo overflow")).rejects.toThrow(/process limit/i);

    // Clean up the sleeping processes by killing them via timeout
    // (they'll resolve on their own via the 10s timeout, but let's not wait)
    await sandbox.cleanup();
  });

  it("tracks idle time and resets on activity", async () => {
    const { createSandbox } = await import("../codex/sandbox");
    const sandbox = await createSandbox("test-idle-1");
    cleanupPaths.push(sandbox.workspace);

    // idleMs should be very small right after creation
    expect(sandbox.idleMs).toBeLessThan(500);

    // After a small delay, idleMs increases
    await new Promise(r => setTimeout(r, 50));
    const idle1 = sandbox.idleMs;
    expect(idle1).toBeGreaterThanOrEqual(40);

    // Activity resets the timer
    await sandbox.writeFile("x.txt", "data");
    expect(sandbox.idleMs).toBeLessThan(idle1);

    await sandbox.cleanup();
  });
});

describe("Codex Templates", () => {
  it("lists all templates (at least 7)", async () => {
    const { listTemplates } = await import("../codex/templates");
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(7);
    expect(templates.find(t => t.id === "react-ts-tailwind")).toBeDefined();
    expect(templates.find(t => t.id === "express-ts-api")).toBeDefined();
    expect(templates.find(t => t.id === "nextjs-prisma")).toBeDefined();
    expect(templates.find(t => t.id === "landing-page")).toBeDefined();
    expect(templates.find(t => t.id === "python-flask")).toBeDefined();
    expect(templates.find(t => t.id === "cli-nodejs")).toBeDefined();
    expect(templates.find(t => t.id === "vue3-vite")).toBeDefined();
  });

  it("gets template by ID with files", async () => {
    const { getTemplate } = await import("../codex/templates");
    const t = getTemplate("react-ts-tailwind");
    expect(t).toBeDefined();
    expect(t!.files["package.json"]).toContain("react");
    expect(t!.files["src/App.tsx"]).toContain("function App");
    expect(t!.files["src/main.tsx"]).toContain("ReactDOM");
  });

  it("gets Vue 3 template with proper files", async () => {
    const { getTemplate } = await import("../codex/templates");
    const t = getTemplate("vue3-vite");
    expect(t).toBeDefined();
    expect(t!.framework).toBe("vue");
    expect(t!.files["package.json"]).toContain("vue");
    expect(t!.files["src/App.vue"]).toContain("template");
  });

  it("returns undefined for unknown template", async () => {
    const { getTemplate } = await import("../codex/templates");
    expect(getTemplate("nonexistent")).toBeUndefined();
  });
});

describe("Codex Engine", () => {
  it("imports without errors", async () => {
    const mod = await import("../codex/codexEngine");
    expect(mod.createSession).toBeDefined();
    expect(mod.getSession).toBeDefined();
    expect(mod.closeSession).toBeDefined();
    expect(mod.listSessions).toBeDefined();
    expect(mod.executeInstruction).toBeDefined();
    expect(mod.listFiles).toBeDefined();
    expect(mod.readFile).toBeDefined();
    expect(mod.writeFile).toBeDefined();
    expect(mod.runCommand).toBeDefined();
    expect(mod.installDeps).toBeDefined();
    expect(mod.startPreview).toBeDefined();
    expect(mod.stopPreview).toBeDefined();
    expect(mod.getPreviewPort).toBeDefined();
    expect(mod.createProject).toBeDefined();
    expect(mod.editProject).toBeDefined();
  });
});

describe("Codex Engine - Session management", () => {
  // Mock llmGateway to avoid real LLM calls
  vi.mock("../lib/llmGateway", () => ({
    llmGateway: {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify([
          { type: "file_write", path: "index.js", content: "console.log('hello')", description: "Create entry file" },
        ]),
      }),
    },
  }));

  // Mock previewServer to avoid real process spawns
  vi.mock("../codex/previewServer", () => ({
    PreviewManager: {
      instance: () => ({
        start: vi.fn().mockResolvedValue(3001),
        stop: vi.fn(),
        getPort: vi.fn().mockReturnValue(3001),
        isRunning: vi.fn().mockReturnValue(false),
        proxyPath: vi.fn(),
      }),
    },
  }));

  const cleanupPaths: string[] = [];

  afterEach(async () => {
    // Clean up sessions
    const engine = await import("../codex/codexEngine");
    for (const p of cleanupPaths) {
      await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    }
    cleanupPaths.length = 0;
  });

  it("creates a project from template with files on disk", async () => {
    const engine = await import("../codex/codexEngine");
    const session = await engine.createSession("user1", "my-app", "Create a react app", "react-ts-tailwind");
    cleanupPaths.push(session.workspace);

    expect(session.id).toBeTruthy();
    expect(session.projectName).toBe("my-app");
    expect(session.framework).toBe("react");
    expect(session.status).toBe("idle");

    // Check template files were written
    const files = await engine.listFiles(session.id);
    const names = files.map(f => f.name);
    expect(names).toContain("package.json");

    // Read a file
    const pkg = await engine.readFile(session.id, "package.json");
    expect(pkg).toContain("react");

    await engine.closeSession(session.id);
  });

  it("creates a blank project when no template", async () => {
    const engine = await import("../codex/codexEngine");
    const session = await engine.createSession("user1", "blank-app", "Build something");
    cleanupPaths.push(session.workspace);

    expect(session.framework).toBe("blank");
    const files = await engine.listFiles(session.id);
    expect(files.length).toBe(0);

    await engine.closeSession(session.id);
  });

  it("writes and reads files through engine helpers", async () => {
    const engine = await import("../codex/codexEngine");
    const session = await engine.createSession("user1", "test-rw", "Test");
    cleanupPaths.push(session.workspace);

    await engine.writeFile(session.id, "hello.txt", "Hello!");
    const content = await engine.readFile(session.id, "hello.txt");
    expect(content).toBe("Hello!");

    await engine.closeSession(session.id);
  });

  it("runs commands through engine helper", async () => {
    const engine = await import("../codex/codexEngine");
    const session = await engine.createSession("user1", "test-cmd", "Test");
    cleanupPaths.push(session.workspace);

    const result = await engine.runCommand(session.id, "echo 'works'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("works");

    await engine.closeSession(session.id);
  });

  it("lists file tree through engine helper", async () => {
    const engine = await import("../codex/codexEngine");
    const session = await engine.createSession("user1", "test-tree", "Test", "landing-page");
    cleanupPaths.push(session.workspace);

    const files = await engine.listFiles(session.id);
    const names = files.map(f => f.name);
    expect(names).toContain("index.html");
    expect(names).toContain("style.css");

    await engine.closeSession(session.id);
  });

  it("lists sessions for a user", async () => {
    const engine = await import("../codex/codexEngine");
    const s1 = await engine.createSession("user-list", "proj1", "test1");
    const s2 = await engine.createSession("user-list", "proj2", "test2");
    const s3 = await engine.createSession("other-user", "proj3", "test3");
    cleanupPaths.push(s1.workspace, s2.workspace, s3.workspace);

    const userSessions = engine.listSessions("user-list");
    expect(userSessions.length).toBeGreaterThanOrEqual(2);
    expect(userSessions.find(s => s.projectName === "proj1")).toBeDefined();
    expect(userSessions.find(s => s.projectName === "proj2")).toBeDefined();

    await engine.closeSession(s1.id);
    await engine.closeSession(s2.id);
    await engine.closeSession(s3.id);
  });

  it("cleans up session on close", async () => {
    const engine = await import("../codex/codexEngine");
    const session = await engine.createSession("user1", "cleanup-test", "test");
    const ws = session.workspace;
    const sid = session.id;

    await engine.closeSession(sid);

    expect(engine.getSession(sid)).toBeUndefined();
    const exists = await fs.access(ws).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it("executes instruction and yields steps (mocked LLM)", async () => {
    const engine = await import("../codex/codexEngine");
    const session = await engine.createSession("user1", "exec-test", "Build something");
    cleanupPaths.push(session.workspace);

    const steps: any[] = [];
    for await (const step of engine.executeInstruction(session.id, "Create a hello world file")) {
      steps.push(step);
    }

    // Should have at least a plan step and the file_write step
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps[0].type).toBe("plan");
    expect(steps[0].status).toBe("done");

    // The file should have been written
    const content = await engine.readFile(session.id, "index.js");
    expect(content).toContain("hello");

    await engine.closeSession(session.id);
  });

  it("throws for non-existent session", async () => {
    const engine = await import("../codex/codexEngine");
    await expect(engine.listFiles("nonexistent")).rejects.toThrow(/not found/i);
    await expect(engine.readFile("nonexistent", "a.txt")).rejects.toThrow(/not found/i);
    await expect(engine.runCommand("nonexistent", "echo")).rejects.toThrow(/not found/i);
  });

  it("createProject wrapper returns projectId and workspace", async () => {
    const engine = await import("../codex/codexEngine");
    const proj = await engine.createProject("user-proj", "wrapper-test", "landing-page");
    cleanupPaths.push(proj.workspace);

    expect(proj.projectId).toBeTruthy();
    expect(proj.workspace).toContain("codex-");
    expect(proj.framework).toBe("html");

    // Session should be accessible via the returned projectId
    const session = engine.getSession(proj.projectId);
    expect(session).toBeDefined();
    expect(session!.userId).toBe("user-proj");

    await engine.closeSession(proj.projectId);
  });
});

describe("Codex Router", () => {
  it("imports without errors", async () => {
    const mod = await import("../routes/codexRouter");
    expect(mod.createCodexRouter).toBeDefined();
  });
});

describe("Codex Preview Server", () => {
  it("imports without errors", async () => {
    const mod = await import("../codex/previewServer");
    expect(mod.PreviewManager).toBeDefined();
    expect(mod.PreviewManager.instance()).toBeDefined();
  });

  it("proxyPath method exists on PreviewManager instance", async () => {
    const mod = await import("../codex/previewServer");
    const pm = mod.PreviewManager.instance();
    expect(typeof pm.proxyPath).toBe("function");
  });
});
