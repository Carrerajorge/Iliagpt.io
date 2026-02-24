import express from "express"; import { randomUUID } from "crypto"; import { spawn, type ChildProcessWithoutNullStreams } from "child_process"; import path from "path"; import fs from "fs/promises";

type StreamEvt =
  | { type: "stdout"; chunk: string; ts: number }
  | { type: "stderr"; chunk: string; ts: number }
  | { type: "exit"; exitCode: number; signal: string | null; wasKilled: boolean; durationMs: number; ts: number };

type Job = {
  jobId: string;
  runId: string;
  command: string;
  createdAt: number;
  timeoutMs: number;
  proc: ChildProcessWithoutNullStreams;
  events: StreamEvt[];
  done: boolean;
};

const app = express();
app.use(express.json({ limit: "256kb" }));

const PORT = Number(process.env.SANDBOX_RUNNER_PORT || "8080");
const TOKEN = process.env.SANDBOX_RUNNER_TOKEN || "";

const WORKSPACE_ROOT = process.env.AGENT_WORKSPACE_ROOT || "/workspace_root";
const DOCKER_IMAGE = process.env.SHELL_COMMAND_DOCKER_IMAGE || "debian:bookworm-slim";

const JOB_TTL_MS = Number(process.env.SANDBOX_RUNNER_JOB_TTL_MS || String(10 * 60_000)); // 10 min

const jobs = new Map<string, Job>();

function requireAuth(req: express.Request, res: express.Response): boolean {
  if (!TOKEN) {
    res.status(500).json({ error: "SANDBOX_RUNNER_TOKEN_NOT_CONFIGURED" });
    return false;
  }
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return false;
  }
  const got = auth.slice("Bearer ".length);
  if (got !== TOKEN) {
    res.status(403).json({ error: "FORBIDDEN" });
    return false;
  }
  return true;
}

function validateRunId(runId: string): boolean {
  // Accept UUIDs and safe slugs.
  return /^[a-zA-Z0-9_-]{8,128}$/.test(runId);
}

function pushEvt(job: Job, evt: StreamEvt) {
  job.events.push(evt);
  // cap memory (keep last ~2MB assuming avg 1KB chunks)
  if (job.events.length > 2000) job.events.splice(0, job.events.length - 2000);
}

function spawnDockerJob(params: { runId: string; command: string; timeoutMs: number }): Job {
  const { runId, command, timeoutMs } = params;

  const jobId = randomUUID();
  const start = Date.now();
  const runWorkspace = path.resolve(WORKSPACE_ROOT, runId);

  const dockerArgs: string[] = [
    "run",
    "--rm",
    "-i",
    "--network",
    (process.env.SHELL_COMMAND_DOCKER_NETWORK || "none"),
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--pids-limit",
    process.env.SHELL_COMMAND_DOCKER_PIDS || "256",
    "--cpus",
    process.env.SHELL_COMMAND_DOCKER_CPUS || "1",
    "--memory",
    process.env.SHELL_COMMAND_DOCKER_MEMORY || "512m",
    "-v",
    `${runWorkspace}:/workspace`,
    "-w",
    "/workspace",
    DOCKER_IMAGE,
    "/usr/bin/bash",
    "-lc",
    command,
  ];

  const proc = spawn("docker", dockerArgs, {
    cwd: runWorkspace,
    env: { ...process.env },
    shell: false,
    windowsHide: true,
  });

  const job: Job = {
    jobId,
    runId,
    command,
    createdAt: Date.now(),
    timeoutMs,
    proc,
    events: [],
    done: false,
  };

  let killed = false;
  const timeoutHandle = setTimeout(() => {
    killed = true;
    try {
      proc.kill("SIGKILL");
    } catch {
      // ignore
    }
  }, timeoutMs);

  proc.stdout.on("data", (d) => pushEvt(job, { type: "stdout", chunk: d.toString(), ts: Date.now() }));
  proc.stderr.on("data", (d) => pushEvt(job, { type: "stderr", chunk: d.toString(), ts: Date.now() }));

  proc.on("close", (code, signal) => {
    clearTimeout(timeoutHandle);
    const exitCode = typeof code === "number" ? code : signal ? 1 : 0;
    pushEvt(job, {
      type: "exit",
      exitCode,
      signal: signal ? String(signal) : null,
      wasKilled: killed,
      durationMs: Date.now() - start,
      ts: Date.now(),
    });
    job.done = true;
  });

  proc.on("error", (err) => {
    clearTimeout(timeoutHandle);
    pushEvt(job, { type: "stderr", chunk: `Failed to spawn docker: ${err.message}\n`, ts: Date.now() });
    pushEvt(job, {
      type: "exit",
      exitCode: 1,
      signal: null,
      wasKilled: killed,
      durationMs: Date.now() - start,
      ts: Date.now(),
    });
    job.done = true;
  });

  return job;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/v1/shell/run", async (req, res) => {
  if (!requireAuth(req, res)) return;

  const runId = String(req.body?.runId || "");
  const command = String(req.body?.command || "").trim();
  const timeoutMsRaw = Number(req.body?.timeoutMs || 30_000);
  const timeoutMs = Math.min(Math.max(timeoutMsRaw, 1000), 600_000);

  if (!validateRunId(runId)) {
    return res.status(400).json({ error: "INVALID_RUN_ID" });
  }
  if (!command) {
    return res.status(400).json({ error: "INVALID_COMMAND" });
  }

  const runWorkspace = path.resolve(WORKSPACE_ROOT, runId);
  try {
    await fs.mkdir(runWorkspace, { recursive: true });
  } catch (e: any) {
    return res.status(500).json({ error: "WORKSPACE_CREATE_FAILED", message: e?.message || String(e) });
  }

  const job = spawnDockerJob({ runId, command, timeoutMs });
  jobs.set(job.jobId, job);

  res.json({ jobId: job.jobId, streamUrl: `/v1/shell/stream/${job.jobId}` });
});

app.get("/v1/shell/stream/:jobId", (req, res) => {
  if (!requireAuth(req, res)) return;
  const jobId = String(req.params.jobId || "");
  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: "NOT_FOUND" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  let cursor = 0;
  const send = () => {
    while (cursor < job.events.length) {
      const evt = job.events[cursor++];
      res.write(`event: shell\n`);
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    }
    if (job.done) {
      res.write(`event: done\n`);
      res.write(`data: {}\n\n`);
      res.end();
    }
  };

  const interval = setInterval(send, 150);
  req.on("close", () => clearInterval(interval));
  send();
});

// best-effort cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}, 60_000).unref();

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[sandbox-runner] listening on :${PORT} workspaceRoot=${WORKSPACE_ROOT}`);
});
