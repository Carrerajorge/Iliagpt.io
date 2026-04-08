import { describe, expect, it, afterEach } from "vitest";
import * as fs from "fs/promises";

/**
 * Codex Engine Tests — sandbox, file operations, templates, command validation.
 *
 * Note: sandbox.exec() uses spawn() internally (not exec) with safety validation.
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
    // Check by name or relativePath depending on sandbox implementation
    const names = files.map(f => f.name);
    const paths = files.map(f => (f as any).relativePath || (f as any).path || f.name);
    expect(names).toContain("package.json");
    expect(files.find(f => f.name === "src" && f.type === "directory")).toBeDefined();
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

  it("cleans up workspace on cleanup()", async () => {
    const { createSandbox } = await import("../codex/sandbox");
    const sandbox = await createSandbox("test-cleanup-1");

    await sandbox.writeFile("test.txt", "data");
    const ws = sandbox.workspace;
    await sandbox.cleanup();

    const exists = await fs.access(ws).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });
});

describe("Codex Templates", () => {
  it("lists all templates", async () => {
    const { listTemplates } = await import("../codex/templates");
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(6);
    expect(templates.find(t => t.id === "react-ts-tailwind")).toBeDefined();
    expect(templates.find(t => t.id === "express-ts-api")).toBeDefined();
    expect(templates.find(t => t.id === "landing-page")).toBeDefined();
    expect(templates.find(t => t.id === "python-flask")).toBeDefined();
    expect(templates.find(t => t.id === "cli-nodejs")).toBeDefined();
  });

  it("gets template by ID with files", async () => {
    const { getTemplate } = await import("../codex/templates");
    const t = getTemplate("react-ts-tailwind");
    expect(t).toBeDefined();
    expect(t!.files["package.json"]).toContain("react");
    expect(t!.files["src/App.tsx"]).toContain("function App");
    expect(t!.files["src/main.tsx"]).toContain("ReactDOM");
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
  });
});

describe("Codex Router", () => {
  it("imports without errors", async () => {
    const mod = await import("../routes/codexRouter");
    expect(mod.createCodexRouter).toBeDefined();
  });
});
