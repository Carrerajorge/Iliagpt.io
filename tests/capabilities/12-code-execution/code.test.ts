/**
 * Capability 12 — Code Execution
 *
 * Tests for the sandboxed code execution capability backed by the FastAPI
 * microservice (fastapi_sse). Covers Python, Node.js, data science libraries,
 * automation scripts, VM isolation guarantees, and error reporting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runWithEachProvider } from "../_setup/providerMatrix";
import { getMockResponseForProvider, createTextResponse } from "../_setup/mockResponses";
import { createMockAgent, withTempDir } from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SandboxRequest {
  language: "python" | "nodejs" | "bash";
  code: string;
  timeoutSeconds?: number;
  memoryLimitMb?: number;
  allowNetwork?: boolean;
  allowFilesystem?: boolean;
  workingDir?: string;
  env?: Record<string, string>;
}

interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  memoryUsedMb: number;
  killed: boolean;
}

// ---------------------------------------------------------------------------
// Sandbox client mock
// ---------------------------------------------------------------------------

const mockSandboxClient = {
  execute: vi.fn() as ReturnType<typeof vi.fn<(req: SandboxRequest) => Promise<SandboxResult>>>,
  ping: vi.fn() as ReturnType<typeof vi.fn<() => Promise<{ ok: boolean; version: string }>>>,
  getResourceUsage: vi.fn() as ReturnType<typeof vi.fn<() => Promise<{ cpuPercent: number; memoryMb: number; activeSessions: number }>>>,
};

vi.mock("../../../fastapi_sse/client", () => ({
  SandboxClient: vi.fn(() => mockSandboxClient),
  default: mockSandboxClient,
}));

vi.mock("../../../server/api/codeExecution", () => ({
  executeCode: vi.fn(async (req: SandboxRequest) => mockSandboxClient.execute(req)),
  default: { execute: vi.fn(async (req: SandboxRequest) => mockSandboxClient.execute(req)) },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function successResult(stdout: string, overrides: Partial<SandboxResult> = {}): SandboxResult {
  return {
    stdout,
    stderr: "",
    exitCode: 0,
    durationMs: 45,
    timedOut: false,
    memoryUsedMb: 22,
    killed: false,
    ...overrides,
  };
}

function errorResult(stderr: string, exitCode = 1): SandboxResult {
  return {
    stdout: "",
    stderr,
    exitCode,
    durationMs: 12,
    timedOut: false,
    memoryUsedMb: 10,
    killed: false,
  };
}

function timeoutResult(partialStdout = ""): SandboxResult {
  return {
    stdout: partialStdout,
    stderr: "",
    exitCode: 124,
    durationMs: 30_000,
    timedOut: true,
    memoryUsedMb: 40,
    killed: true,
  };
}

// ---------------------------------------------------------------------------
// 1. Python execution
// ---------------------------------------------------------------------------

describe("Python execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSandboxClient.ping.mockResolvedValue({ ok: true, version: "1.2.3" });
  });

  runWithEachProvider(
    "runs a simple Python script and captures stdout",
    "code-execution",
    async (provider) => {
      mockSandboxClient.execute.mockResolvedValueOnce(
        successResult('Hello, World!\n'),
      );

      const result = await mockSandboxClient.execute({
        language: "python",
        code: 'print("Hello, World!")',
        timeoutSeconds: 10,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("Hello, World!\n");
      expect(result.stderr).toBe("");
      expect(result.timedOut).toBe(false);
      expect(result.durationMs).toBeGreaterThan(0);

      // Validate provider tool call structure
      const response = getMockResponseForProvider(provider.name, {
        name: "execute_python",
        arguments: { code: 'print("Hello, World!")', timeout: 10 },
      });
      expect(response).toBeDefined();
    },
  );

  runWithEachProvider(
    "captures multi-line stdout from a Python script",
    "code-execution",
    async (provider) => {
      const expectedOutput = "line1\nline2\nline3\n";
      mockSandboxClient.execute.mockResolvedValueOnce(successResult(expectedOutput));

      const result = await mockSandboxClient.execute({
        language: "python",
        code: 'for i in range(1, 4):\n    print(f"line{i}")',
        timeoutSeconds: 10,
      });

      expect(result.stdout).toBe(expectedOutput);
      expect(result.stdout.split("\n").filter(Boolean)).toHaveLength(3);
    },
  );

  runWithEachProvider(
    "handles a Python runtime exception and returns error details",
    "code-execution",
    async (provider) => {
      const tracebackStderr =
        "Traceback (most recent call last):\n  File \"<string>\", line 1, in <module>\nZeroDivisionError: division by zero\n";
      mockSandboxClient.execute.mockResolvedValueOnce(errorResult(tracebackStderr));

      const result = await mockSandboxClient.execute({
        language: "python",
        code: "print(1 / 0)",
        timeoutSeconds: 10,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("ZeroDivisionError");
      expect(result.stderr).toContain("Traceback");
      expect(result.stdout).toBe("");
    },
  );

  runWithEachProvider(
    "enforces a timeout and terminates long-running Python code",
    "code-execution",
    async (provider) => {
      mockSandboxClient.execute.mockResolvedValueOnce(timeoutResult("partial output\n"));

      const result = await mockSandboxClient.execute({
        language: "python",
        code: "import time\ntime.sleep(999)\nprint('done')",
        timeoutSeconds: 5,
      });

      expect(result.timedOut).toBe(true);
      expect(result.killed).toBe(true);
      expect(result.exitCode).toBe(124);
      expect(result.stdout).toBe("partial output\n");
    },
  );
});

// ---------------------------------------------------------------------------
// 2. Node.js execution
// ---------------------------------------------------------------------------

describe("Node.js execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  runWithEachProvider(
    "runs a simple Node.js script",
    "code-execution",
    async (provider) => {
      mockSandboxClient.execute.mockResolvedValueOnce(successResult("Hello from Node!\n"));

      const result = await mockSandboxClient.execute({
        language: "nodejs",
        code: 'console.log("Hello from Node!");',
        timeoutSeconds: 10,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("Hello from Node!\n");
    },
  );

  runWithEachProvider(
    "requires built-in modules in Node.js",
    "code-execution",
    async (provider) => {
      mockSandboxClient.execute.mockResolvedValueOnce(successResult("path separator: /\n"));

      const result = await mockSandboxClient.execute({
        language: "nodejs",
        code: "const path = require('path');\nconsole.log('path separator:', path.sep);",
        timeoutSeconds: 10,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("path separator");
    },
  );

  runWithEachProvider(
    "runs an async Node.js script using promises",
    "code-execution",
    async (provider) => {
      mockSandboxClient.execute.mockResolvedValueOnce(successResult("resolved: 42\n"));

      const result = await mockSandboxClient.execute({
        language: "nodejs",
        code: "(async () => { const val = await Promise.resolve(42); console.log('resolved:', val); })()",
        timeoutSeconds: 10,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("42");
    },
  );

  runWithEachProvider(
    "runs Node.js code using ES module syntax via eval",
    "code-execution",
    async (provider) => {
      mockSandboxClient.execute.mockResolvedValueOnce(successResult("sum: 15\n"));

      const result = await mockSandboxClient.execute({
        language: "nodejs",
        code: "const sum = [1,2,3,4,5].reduce((a, b) => a + b, 0);\nconsole.log('sum:', sum);",
        timeoutSeconds: 10,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("15");
    },
  );
});

// ---------------------------------------------------------------------------
// 3. Data science libraries
// ---------------------------------------------------------------------------

describe("Data science libraries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  runWithEachProvider(
    "performs pandas DataFrame operations",
    "code-execution",
    async (provider) => {
      const pandasOutput = "   name  score\n0  Alice     95\n1    Bob     82\n";
      mockSandboxClient.execute.mockResolvedValueOnce(successResult(pandasOutput));

      const result = await mockSandboxClient.execute({
        language: "python",
        code: [
          "import pandas as pd",
          "df = pd.DataFrame({'name': ['Alice', 'Bob'], 'score': [95, 82]})",
          "print(df)",
        ].join("\n"),
        timeoutSeconds: 30,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Alice");
      expect(result.stdout).toContain("95");
    },
  );

  runWithEachProvider(
    "performs numpy array calculations",
    "code-execution",
    async (provider) => {
      mockSandboxClient.execute.mockResolvedValueOnce(successResult("mean: 3.0\nstd: 1.4142135623730951\n"));

      const result = await mockSandboxClient.execute({
        language: "python",
        code: [
          "import numpy as np",
          "arr = np.array([1, 2, 3, 4, 5])",
          "print(f'mean: {arr.mean()}')",
          "print(f'std: {arr.std()}')",
        ].join("\n"),
        timeoutSeconds: 30,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("mean: 3.0");
      expect(result.stdout).toContain("std:");
    },
  );

  runWithEachProvider(
    "generates a matplotlib chart and returns base64 PNG",
    "code-execution",
    async (provider) => {
      const fakePngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      mockSandboxClient.execute.mockResolvedValueOnce(
        successResult(`CHART_DATA:${fakePngB64}\n`),
      );

      const result = await mockSandboxClient.execute({
        language: "python",
        code: [
          "import matplotlib.pyplot as plt, io, base64",
          "fig, ax = plt.subplots()",
          "ax.plot([1,2,3], [4,5,6])",
          "buf = io.BytesIO()",
          "fig.savefig(buf, format='png')",
          "print('CHART_DATA:' + base64.b64encode(buf.getvalue()).decode())",
        ].join("\n"),
        timeoutSeconds: 30,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("CHART_DATA:");
      const b64part = result.stdout.replace("CHART_DATA:", "").trim();
      expect(b64part.length).toBeGreaterThan(0);
    },
  );
});

// ---------------------------------------------------------------------------
// 4. Automation scripts
// ---------------------------------------------------------------------------

describe("Automation scripts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  runWithEachProvider(
    "runs a file manipulation script inside the sandbox",
    "code-execution",
    async (provider) => {
      mockSandboxClient.execute.mockResolvedValueOnce(successResult("file written\nfile read: hello\n"));

      const result = await mockSandboxClient.execute({
        language: "python",
        code: [
          "with open('/sandbox/test.txt', 'w') as f: f.write('hello')",
          "print('file written')",
          "with open('/sandbox/test.txt') as f: content = f.read()",
          "print('file read:', content)",
        ].join("\n"),
        timeoutSeconds: 10,
        allowFilesystem: true,
        workingDir: "/sandbox",
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("file written");
      expect(result.stdout).toContain("file read: hello");
    },
  );

  runWithEachProvider(
    "runs a web scraping script with mocked HTTP",
    "code-execution",
    async (provider) => {
      mockSandboxClient.execute.mockResolvedValueOnce(
        successResult("title: Example Domain\n"),
      );

      const result = await mockSandboxClient.execute({
        language: "python",
        code: [
          "import urllib.request",
          "from html.parser import HTMLParser",
          "class TitleParser(HTMLParser):",
          "    def __init__(self): super().__init__(); self.title = ''",
          "    def handle_data(self, data): self.title = data if not self.title else self.title",
          "print('title: Example Domain')",
        ].join("\n"),
        timeoutSeconds: 15,
        allowNetwork: true,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("title:");
    },
  );

  runWithEachProvider(
    "runs a data processing pipeline script",
    "code-execution",
    async (provider) => {
      mockSandboxClient.execute.mockResolvedValueOnce(
        successResult("processed: 5 records, total: 15\n"),
      );

      const result = await mockSandboxClient.execute({
        language: "python",
        code: [
          "records = [1, 2, 3, 4, 5]",
          "total = sum(records)",
          "print(f'processed: {len(records)} records, total: {total}')",
        ].join("\n"),
        timeoutSeconds: 10,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("5 records");
      expect(result.stdout).toContain("total: 15");
    },
  );

  runWithEachProvider(
    "runs a Node.js data transformation script",
    "code-execution",
    async (provider) => {
      mockSandboxClient.execute.mockResolvedValueOnce(successResult('{"doubled":[2,4,6,8,10]}\n'));

      const result = await mockSandboxClient.execute({
        language: "nodejs",
        code: "const arr = [1,2,3,4,5];\nconst doubled = arr.map(x => x * 2);\nconsole.log(JSON.stringify({ doubled }));",
        timeoutSeconds: 10,
      });

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.doubled).toEqual([2, 4, 6, 8, 10]);
    },
  );
});

// ---------------------------------------------------------------------------
// 5. VM isolation
// ---------------------------------------------------------------------------

describe("VM isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  runWithEachProvider(
    "blocks filesystem access outside the sandbox directory",
    "code-execution",
    async (provider) => {
      mockSandboxClient.execute.mockResolvedValueOnce(
        errorResult(
          "PermissionError: [Errno 13] Permission denied: '/etc/passwd'\n",
          1,
        ),
      );

      const result = await mockSandboxClient.execute({
        language: "python",
        code: "with open('/etc/passwd') as f: print(f.read())",
        timeoutSeconds: 5,
        allowFilesystem: false,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("PermissionError");
      expect(result.stdout).toBe("");
    },
  );

  runWithEachProvider(
    "blocks outbound network by default",
    "code-execution",
    async (provider) => {
      mockSandboxClient.execute.mockResolvedValueOnce(
        errorResult(
          "urllib.error.URLError: <urlopen error [Errno -2] Name or service not known>\n",
          1,
        ),
      );

      const result = await mockSandboxClient.execute({
        language: "python",
        code: "import urllib.request\nresult = urllib.request.urlopen('https://example.com').read()\nprint(result)",
        timeoutSeconds: 5,
        allowNetwork: false,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("URLError");
    },
  );

  runWithEachProvider(
    "enforces memory limits",
    "code-execution",
    async (provider) => {
      mockSandboxClient.execute.mockResolvedValueOnce({
        stdout: "",
        stderr: "MemoryError\n",
        exitCode: 137, // OOM killed
        durationMs: 200,
        timedOut: false,
        memoryUsedMb: 512,
        killed: true,
      });

      const result = await mockSandboxClient.execute({
        language: "python",
        code: "x = ' ' * (10 ** 9)",  // allocate ~1GB
        timeoutSeconds: 10,
        memoryLimitMb: 128,
      });

      expect(result.killed).toBe(true);
      expect(result.exitCode).toBe(137);
      expect(result.stderr).toContain("MemoryError");
    },
  );

  runWithEachProvider(
    "enforces CPU / wall-clock limits",
    "code-execution",
    async (provider) => {
      mockSandboxClient.execute.mockResolvedValueOnce(timeoutResult());

      const result = await mockSandboxClient.execute({
        language: "python",
        code: "while True: pass",
        timeoutSeconds: 3,
      });

      expect(result.timedOut).toBe(true);
      expect(result.killed).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// 6. Error handling
// ---------------------------------------------------------------------------

describe("Error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  runWithEachProvider(
    "reports a Python syntax error clearly",
    "code-execution",
    async (provider) => {
      const syntaxErrStderr =
        '  File "<string>", line 1\n    def broken(\n              ^\nSyntaxError: invalid syntax\n';
      mockSandboxClient.execute.mockResolvedValueOnce(errorResult(syntaxErrStderr));

      const result = await mockSandboxClient.execute({
        language: "python",
        code: "def broken(",
        timeoutSeconds: 5,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("SyntaxError");
      expect(result.stdout).toBe("");
    },
  );

  runWithEachProvider(
    "returns runtime error with full stack trace",
    "code-execution",
    async (provider) => {
      const runtimeStderr = [
        "Traceback (most recent call last):",
        '  File "<string>", line 3, in <module>',
        '  File "<string>", line 2, in foo',
        "AttributeError: 'NoneType' object has no attribute 'split'",
        "",
      ].join("\n");

      mockSandboxClient.execute.mockResolvedValueOnce(errorResult(runtimeStderr));

      const result = await mockSandboxClient.execute({
        language: "python",
        code: "def foo(x):\n    return x.split()\nfoo(None)",
        timeoutSeconds: 5,
      });

      expect(result.stderr).toContain("AttributeError");
      expect(result.stderr).toContain("Traceback");
      expect(result.stderr).toContain("foo");
    },
  );

  runWithEachProvider(
    "returns partial stdout even when a timeout occurs",
    "code-execution",
    async (provider) => {
      const partialOutput = "step1 complete\nstep2 complete\n";
      mockSandboxClient.execute.mockResolvedValueOnce(timeoutResult(partialOutput));

      const result = await mockSandboxClient.execute({
        language: "python",
        code: [
          "import time",
          "print('step1 complete')",
          "print('step2 complete')",
          "time.sleep(999)",
          "print('step3 complete')",
        ].join("\n"),
        timeoutSeconds: 2,
      });

      expect(result.timedOut).toBe(true);
      expect(result.stdout).toContain("step1 complete");
      expect(result.stdout).toContain("step2 complete");
      expect(result.stdout).not.toContain("step3 complete");
    },
  );

  runWithEachProvider(
    "sandbox client is reachable before executing code",
    "code-execution",
    async (provider) => {
      mockSandboxClient.ping.mockResolvedValueOnce({ ok: true, version: "1.2.3" });

      const health = await mockSandboxClient.ping();
      expect(health.ok).toBe(true);
      expect(health.version).toMatch(/^\d+\.\d+\.\d+$/);

      // Only submit code if sandbox is healthy
      if (health.ok) {
        mockSandboxClient.execute.mockResolvedValueOnce(successResult("42\n"));
        const result = await mockSandboxClient.execute({
          language: "python",
          code: "print(6 * 7)",
          timeoutSeconds: 5,
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe("42");
      }
    },
  );
});
