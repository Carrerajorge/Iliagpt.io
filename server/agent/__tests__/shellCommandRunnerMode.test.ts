import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";

describe("shell_command runner mode", () => {
  const token = "test-token";
  const baseUrl = "http://runner.local";

  it(
    "should stream via runner when SHELL_COMMAND_SANDBOX_MODE=runner",
    async () => {
      const prevMode = process.env.SHELL_COMMAND_SANDBOX_MODE;
      const prevUrl = process.env.SHELL_COMMAND_RUNNER_URL;
      const prevTok = process.env.SHELL_COMMAND_RUNNER_TOKEN;
      const prevFetch = globalThis.fetch;

      process.env.SHELL_COMMAND_SANDBOX_MODE = "runner";
      process.env.SHELL_COMMAND_RUNNER_URL = baseUrl;
      process.env.SHELL_COMMAND_RUNNER_TOKEN = token;

      const encoder = new TextEncoder();
      const ssePayload = [
        `event: shell\n`,
        `data: ${JSON.stringify({ type: "stdout", chunk: "hello" })}\n\n`,
        `event: shell\n`,
        `data: ${JSON.stringify({ type: "exit", exitCode: 0, signal: null, wasKilled: false, durationMs: 5 })}\n\n`,
        `event: done\n`,
        `data: {}\n\n`,
      ].join("");

      const fetchMock: Mock = vi.fn(async (input: any, init?: any) => {
        const url = typeof input === "string" ? input : String(input?.url || input?.toString?.() || input);
        const method = String(init?.method || "GET").toUpperCase();
        const auth = String(init?.headers?.Authorization || init?.headers?.authorization || "");
        if (auth !== `Bearer ${token}`) {
          return new Response(JSON.stringify({ error: "FORBIDDEN" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (method === "POST" && url === `${baseUrl}/v1/shell/run`) {
          const body = init?.body ? JSON.parse(String(init.body)) : {};
          const runId = String(body?.runId || "unknown");
          return new Response(
            JSON.stringify({ jobId: `job-${runId}`, streamUrl: `/v1/shell/stream/job-${runId}` }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        if (method === "GET" && url.startsWith(`${baseUrl}/v1/shell/stream/`)) {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(ssePayload));
              controller.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }

        return new Response(JSON.stringify({ error: "NOT_FOUND", url, method }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      });

      // Stub fetch without opening ports (some sandboxes block listen()).
      globalThis.fetch = fetchMock as any;

      try {
        // Force re-import so toolRegistry sees env
        vi.resetModules();
        const { toolRegistry } = await import("../toolRegistry");

        const chunks: any[] = [];
        let exit: any = null;

        const res = await toolRegistry.execute(
          "shell_command",
          // In CI/loaded environments this can take a bit longer than 5s.
          { command: "echo hello", timeout: 15000 },
          {
            userId: "u1",
            chatId: "c1",
            runId: "run-test-runner",
            userPlan: "admin",
            isConfirmed: true,
            onStream: (evt) => chunks.push(evt),
            onExit: (evt) => {
              exit = evt;
            },
          }
        );

        expect(res.success).toBe(true);
        expect(res.output?.stdout).toContain("hello");
        expect(chunks.length).toBeGreaterThan(0);
        expect(exit?.exitCode).toBe(0);
      } finally {
        globalThis.fetch = prevFetch;

        // Restore env (avoid leaking to other suites)
        if (prevMode === undefined) delete process.env.SHELL_COMMAND_SANDBOX_MODE;
        else process.env.SHELL_COMMAND_SANDBOX_MODE = prevMode;

        if (prevUrl === undefined) delete process.env.SHELL_COMMAND_RUNNER_URL;
        else process.env.SHELL_COMMAND_RUNNER_URL = prevUrl;

        if (prevTok === undefined) delete process.env.SHELL_COMMAND_RUNNER_TOKEN;
        else process.env.SHELL_COMMAND_RUNNER_TOKEN = prevTok;
      }
    },
    60000
  );
});

