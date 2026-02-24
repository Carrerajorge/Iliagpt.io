import { describe, it, expect } from "vitest";
import { toolRegistry } from "../toolRegistry";

// NOTE: streaming behavior is best-effort and event-based.

describe("shell_command tool", () => {
  it("should require confirmation for dangerous commands", async () => {
    const res = await toolRegistry.execute(
      "shell_command",
      { command: "rm -rf /tmp/agent-workspace/test", timeout: 2000 },
      {
        userId: "u1",
        chatId: "c1",
        runId: "run-test",
        userPlan: "admin",
        isConfirmed: false,
      }
    );

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("REQUIRES_CONFIRMATION");
  });

  it("should execute a safe command", async () => {
    const res = await toolRegistry.execute(
      "shell_command",
      { command: "echo hello", timeout: 5000 },
      {
        userId: "u1",
        chatId: "c1",
        runId: "run-test-2",
        userPlan: "admin",
        isConfirmed: true,
      }
    );

    expect(res.output?.stdout).toContain("hello");
    expect(res.output?.exitCode).toBe(0);
  });

  it("should call onStream (stdout/stderr) and onExit", async () => {
    const chunks: Array<{ stream: string; chunk: string }> = [];
    let exit: any = null;

    const res = await toolRegistry.execute(
      "shell_command",
      // Use printf to avoid extra shell formatting; emit both stdout and stderr.
      { command: "printf 'out'; printf 'err' 1>&2", timeout: 5000 },
      {
        userId: "u1",
        chatId: "c1",
        runId: "run-test-3",
        userPlan: "admin",
        isConfirmed: true,
        onStream: (evt) => chunks.push(evt),
        onExit: (evt) => {
          exit = evt;
        },
      }
    );

    expect(res.output?.stdout).toContain("out");
    expect(res.output?.stderr).toContain("err");

    // Streaming is best-effort, but for this short command we should get at least one chunk.
    expect(chunks.length).toBeGreaterThan(0);

    expect(exit).toBeTruthy();
    expect(exit.exitCode).toBe(0);
  });
});
