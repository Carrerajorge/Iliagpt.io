import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";

import {
  listenWithFallback,
  resolveHttpListenCandidates,
  shouldRetryListenError,
  type HttpListenCandidate,
} from "../httpListen";

class FakeListenServer extends EventEmitter {
  public attempts: HttpListenCandidate["options"][] = [];
  private readonly failAttempts: NodeJS.ErrnoException[];

  constructor(failAttempts: NodeJS.ErrnoException[] = []) {
    super();
    this.failAttempts = [...failAttempts];
  }

  listen(options: HttpListenCandidate["options"]) {
    this.attempts.push(options);
    queueMicrotask(() => {
      const nextError = this.failAttempts.shift();
      if (nextError) {
        this.emit("error", nextError);
        return;
      }
      this.emit("listening");
    });
    return this;
  }
}

describe("httpListen", () => {
  it("builds production candidates with reusePort fallback and loopback fallback", () => {
    expect(
      resolveHttpListenCandidates({
        port: 41734,
        configuredHost: "0.0.0.0",
        isProduction: true,
        preferReusePort: true,
      }).map((candidate) => ({
        host: candidate.host,
        reusePort: candidate.reusePort,
      })),
    ).toEqual([
      { host: "0.0.0.0", reusePort: true },
      { host: "0.0.0.0", reusePort: false },
      { host: "127.0.0.1", reusePort: false },
    ]);
  });

  it("prefers loopback when the production base URL is local", () => {
    expect(
      resolveHttpListenCandidates({
        port: 41734,
        baseUrl: "http://127.0.0.1:41734",
        isProduction: true,
        preferReusePort: false,
      }).map((candidate) => ({
        host: candidate.host,
        reusePort: candidate.reusePort,
      })),
    ).toEqual([{ host: "127.0.0.1", reusePort: false }]);
  });

  it("retries with the next candidate when listen fails with a retryable code", async () => {
    const server = new FakeListenServer([
      Object.assign(new Error("reusePort unsupported"), { code: "ENOTSUP" }),
    ]);
    const candidates = resolveHttpListenCandidates({
      port: 41734,
      configuredHost: "0.0.0.0",
      isProduction: true,
      preferReusePort: true,
    });
    const onRetry = vi.fn();

    const winner = await listenWithFallback(server, candidates, onRetry);

    expect(winner.host).toBe("0.0.0.0");
    expect(winner.reusePort).toBe(false);
    expect(server.attempts).toHaveLength(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-retryable listen failures", async () => {
    const server = new FakeListenServer([
      Object.assign(new Error("permission denied"), { code: "EACCES" }),
    ]);
    const candidates = resolveHttpListenCandidates({
      port: 41734,
      configuredHost: "0.0.0.0",
      isProduction: true,
      preferReusePort: true,
    });

    await expect(listenWithFallback(server, candidates)).rejects.toMatchObject({ code: "EACCES" });
    expect(server.attempts).toHaveLength(1);
  });

  it("identifies retryable listen error codes", () => {
    expect(shouldRetryListenError({ code: "ENOTSUP" } as NodeJS.ErrnoException)).toBe(true);
    expect(shouldRetryListenError({ code: "EADDRNOTAVAIL" } as NodeJS.ErrnoException)).toBe(true);
    expect(shouldRetryListenError({ code: "EAFNOSUPPORT" } as NodeJS.ErrnoException)).toBe(true);
    expect(shouldRetryListenError({ code: "EACCES" } as NodeJS.ErrnoException)).toBe(false);
  });
});
