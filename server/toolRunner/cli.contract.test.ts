import path from "node:path";
import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): Promise<ExecResult> {
  const cliPath = path.join(process.cwd(), "server", "toolRunner", "cli.ts");

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", cliPath, ...args],
      {
        env: { ...process.env, NODE_ENV: "test" },
        timeout: 40_000,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code = (error as { code?: number } | null)?.code ?? 0;
        resolve({ code, stdout, stderr });
      }
    );
  });
}

function parseJsonLine(output: string): any {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const jsonLine = lines.find((line) => line.startsWith("{"));
  if (!jsonLine) {
    throw new Error(`Expected JSON line in output, got: ${output}`);
  }

  return JSON.parse(jsonLine);
}

function parseErrorLine(output: string): any {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const jsonLine = lines.find((line) => line.startsWith("{"));
  if (!jsonLine) {
    throw new Error(`Expected JSON line in output, got: ${output}`);
  }

  return JSON.parse(jsonLine);
}

describe("tool-runner CLI contract", () => {
  it("exposes global capabilities", async () => {
    const result = await runCli(["--capabilities"]);

    expect(result.code).toBe(0);
    const payload = parseJsonLine(result.stdout);

    expect(payload.protocolVersion).toBe("tool-runner-cli/1.0");
    expect(Array.isArray(payload.tools)).toBe(true);

    const names = payload.tools.map((tool: any) => tool.name).sort();
    expect(names).toEqual([
      "docgen",
      "mso-validate",
      "pptxgen",
      "render-preview",
      "theme-apply",
      "xlsxgen",
    ]);
  });

  it("exposes command-scoped capabilities", async () => {
    const result = await runCli(["docgen", "--capabilities"]);

    expect(result.code).toBe(0);
    const payload = parseJsonLine(result.stdout);

    expect(payload.name).toBe("docgen");
    expect(payload.version).toBe("1.0.0");
    expect(payload.stateless).toBe(true);
  });

  it("rejects unknown command capabilities", async () => {
    const result = await runCli(["does-not-exist", "--capabilities"]);

    expect(result.code).toBe(12);
    const payload = parseErrorLine(result.stderr);
    expect(payload.code).toBe("TR_0004_TOOL_NOT_FOUND");
  });

  it("returns healthcheck snapshot", async () => {
    const result = await runCli(["--healthcheck"]);

    expect(result.code).toBe(0);
    const payload = parseJsonLine(result.stdout);

    expect(payload.status).toBe("healthy");
    expect(Array.isArray(payload.tools)).toBe(true);
    expect(payload.tools.length).toBeGreaterThan(0);
  });

  it("rejects unknown command healthcheck", async () => {
    const result = await runCli(["does-not-exist", "--healthcheck"]);

    expect(result.code).toBe(12);
    const payload = parseErrorLine(result.stderr);
    expect(payload.code).toBe("TR_0004_TOOL_NOT_FOUND");
  });

  it("returns stable exit code for invalid args", async () => {
    const result = await runCli(["unknown-command"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("TR_0001_INVALID_ARGS");
  });
});
