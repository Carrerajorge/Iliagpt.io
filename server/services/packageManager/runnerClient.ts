import { randomUUID } from "crypto";


type RunnerResult = {

  ok: boolean;

  exitCode: number | null;

  signal: NodeJS.Signals | null;

  stdout: string;

  stderr: string;

  durationMs: number;

};


function getRunnerConfig() {

  const runnerUrl = process.env.SHELL_COMMAND_RUNNER_URL || "http://sandbox-runner:8080";

  const token = process.env.SHELL_COMMAND_RUNNER_TOKEN || process.env.SANDBOX_RUNNER_TOKEN || "";

  if (!token) throw new Error("RUNNER_TOKEN_NOT_CONFIGURED");

  return { runnerUrl, token };

}


export async function runViaSandboxRunner(params: {

  command: string;

  timeoutMs: number;

  maxOutputBytes: number;

}): Promise<RunnerResult> {

  const { runnerUrl, token } = getRunnerConfig();


  const runId = `pkg-${randomUUID()}`;

  const runResp = await fetch(`${runnerUrl}/v1/shell/run`, {

    method: "POST",

    headers: {

      "Content-Type": "application/json",

      Authorization: `Bearer ${token}`,

    },

    body: JSON.stringify({

      runId,

      command: params.command,

      timeoutMs: params.timeoutMs,

    }),

  });


  if (!runResp.ok) {

    const txt = await runResp.text().catch(() => "");

    throw new Error(`RUNNER_RUN_FAILED: ${runResp.status} ${txt}`);

  }


  const runJson = (await runResp.json()) as { jobId: string; streamUrl: string };

  const streamUrl = runJson.streamUrl.startsWith("http")

    ? runJson.streamUrl

    : `${runnerUrl}${runJson.streamUrl}`;


  const streamResp = await fetch(streamUrl, {

    headers: { Authorization: `Bearer ${token}` },

  });

  if (!streamResp.ok || !streamResp.body) {

    const txt = await streamResp.text().catch(() => "");

    throw new Error(`RUNNER_STREAM_FAILED: ${streamResp.status} ${txt}`);

  }


  const decoder = new TextDecoder();

  let buf = "";

  let stdout = "";

  let stderr = "";

  let exitCode: number | null = null;

  let signal: string | null = null;

  let wasKilled = false;

  let durationMs = 0;


  const capAppend = (s: string, chunk: string) => {

    if (s.length >= params.maxOutputBytes) return s;

    const remain = params.maxOutputBytes - s.length;

    return s + chunk.slice(0, remain);

  };


  for await (const c of streamResp.body as any) {

    buf += decoder.decode(c, { stream: true });


    // SSE events are separated by blank line

    while (true) {

      const idx = buf.indexOf("\n\n");

      if (idx === -1) break;

      const raw = buf.slice(0, idx);

      buf = buf.slice(idx + 2);


      // parse "data: {json}"

      const dataLine = raw

        .split("\n")

        .find((l) => l.startsWith("data: "));

      if (!dataLine) continue;


      const payload = dataLine.slice("data: ".length).trim();

      if (payload === "{}") continue;


      let evt: any;

      try {

        evt = JSON.parse(payload);

      } catch {

        continue;

      }


      if (evt.type === "stdout") stdout = capAppend(stdout, String(evt.chunk || ""));

      if (evt.type === "stderr") stderr = capAppend(stderr, String(evt.chunk || ""));

      if (evt.type === "exit") {

        exitCode = typeof evt.exitCode === "number" ? evt.exitCode : 1;

        signal = evt.signal ? String(evt.signal) : null;

        wasKilled = Boolean(evt.wasKilled);

        durationMs = Number(evt.durationMs || 0);

      }

    }

  }


  const ok = exitCode === 0 && !wasKilled;

  return {

    ok,

    exitCode,

    signal: (signal as any) || null,

    stdout,

    stderr,

    durationMs,

  };

}
