import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { db } from "../db";
import {
  codeInterpreterRuns,
  codeInterpreterArtifacts,
  InsertCodeInterpreterRun,
  InsertCodeInterpreterArtifact,
  CodeInterpreterRun,
  CodeInterpreterArtifact,
} from "@shared/schema";
import { eq } from "drizzle-orm";

const EXECUTION_TIMEOUT_MS = 30000;
const MAX_OUTPUT_SIZE = 100000;

interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  executionTimeMs: number;
  artifacts: Array<{
    type: string;
    name: string;
    data: string;
    mimeType: string;
  }>;
}

const PYTHON_SETUP = `
import sys
import os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import io
import base64
import json

_ARTIFACTS = []
_OUTPUT_DIR = os.environ.get('OUTPUT_DIR', '/tmp')

def _capture_figure(fig=None, name='figure'):
    if fig is None:
        fig = plt.gcf()
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=150, bbox_inches='tight')
    buf.seek(0)
    data = base64.b64encode(buf.read()).decode('utf-8')
    _ARTIFACTS.append({
        'type': 'image',
        'name': name + '.png',
        'data': data,
        'mimeType': 'image/png'
    })
    plt.close(fig)

_original_show = plt.show
def _patched_show(*args, **kwargs):
    _capture_figure(name=f'figure_{len(_ARTIFACTS)}')
plt.show = _patched_show

def save_artifact(data, name, mime_type='application/octet-stream'):
    if isinstance(data, bytes):
        encoded = base64.b64encode(data).decode('utf-8')
    else:
        encoded = base64.b64encode(data.encode('utf-8')).decode('utf-8')
    _ARTIFACTS.append({
        'type': 'file',
        'name': name,
        'data': encoded,
        'mimeType': mime_type
    })

`;

const PYTHON_TEARDOWN = `
import json
print("\\n__ARTIFACTS_JSON__:" + json.dumps(_ARTIFACTS))
`;

export async function executeCode(
  code: string,
  options: {
    conversationId?: string;
    userId?: string;
    language?: string;
  } = {}
): Promise<{ run: CodeInterpreterRun; artifacts: CodeInterpreterArtifact[] }> {
  const language = options.language || "python";

  const runRecord = await db
    .insert(codeInterpreterRuns)
    .values({
      conversationId: options.conversationId || null,
      userId: options.userId || null,
      code,
      language,
      status: "running",
    } as InsertCodeInterpreterRun)
    .returning();

  const run = runRecord[0];
  const result = await runPythonCode(code);

  const updatedRun = await db
    .update(codeInterpreterRuns)
    .set({
      status: result.success ? "success" : "error",
      stdout: result.stdout.slice(0, MAX_OUTPUT_SIZE),
      stderr: result.stderr.slice(0, MAX_OUTPUT_SIZE),
      executionTimeMs: result.executionTimeMs,
    })
    .where(eq(codeInterpreterRuns.id, run.id))
    .returning();

  const artifacts: CodeInterpreterArtifact[] = [];
  for (const artifact of result.artifacts) {
    const inserted = await db
      .insert(codeInterpreterArtifacts)
      .values({
        runId: run.id,
        type: artifact.type,
        name: artifact.name,
        data: artifact.data,
        mimeType: artifact.mimeType,
      } as InsertCodeInterpreterArtifact)
      .returning();
    artifacts.push(inserted[0]);
  }

  return { run: updatedRun[0], artifacts };
}

async function runPythonCode(code: string): Promise<ExecutionResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-interpreter-"));
  const scriptPath = path.join(tmpDir, "script.py");

  const fullCode = PYTHON_SETUP + code + PYTHON_TEARDOWN;
  fs.writeFileSync(scriptPath, fullCode, "utf-8");

  const startTime = Date.now();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const proc = spawn("python3", [scriptPath], {
      cwd: tmpDir,
      env: {
        ...process.env,
        OUTPUT_DIR: tmpDir,
        MPLBACKEND: "Agg",
      },
      timeout: EXECUTION_TIMEOUT_MS,
      shell: false, // Explicit: prevent command injection
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, EXECUTION_TIMEOUT_MS);

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timeoutHandle);
      const executionTimeMs = Date.now() - startTime;

      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.warn("[CodeInterpreter] Failed to cleanup temp directory:", tmpDir);
      }

      if (timedOut) {
        resolve({
          success: false,
          stdout,
          stderr: stderr + "\nExecution timed out after 30 seconds",
          executionTimeMs,
          artifacts: [],
        });
        return;
      }

      let artifacts: ExecutionResult["artifacts"] = [];
      const artifactMatch = stdout.match(/__ARTIFACTS_JSON__:(.+)$/m);
      if (artifactMatch) {
        try {
          artifacts = JSON.parse(artifactMatch[1]);
          stdout = stdout.replace(/__ARTIFACTS_JSON__:.+$/m, "").trim();
        } catch (parseErr) {
          console.warn("[CodeInterpreter] Failed to parse artifacts JSON");
        }
      }

      resolve({
        success: code === 0,
        stdout,
        stderr,
        executionTimeMs,
        artifacts,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutHandle);
      const executionTimeMs = Date.now() - startTime;

      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.warn("[CodeInterpreter] Failed to cleanup temp directory on error:", tmpDir);
      }

      resolve({
        success: false,
        stdout,
        stderr: stderr + "\n" + err.message,
        executionTimeMs,
        artifacts: [],
      });
    });
  });
}

export async function getRun(runId: string): Promise<CodeInterpreterRun | null> {
  const runs = await db
    .select()
    .from(codeInterpreterRuns)
    .where(eq(codeInterpreterRuns.id, runId));
  return runs[0] || null;
}

export async function getRunArtifacts(runId: string): Promise<CodeInterpreterArtifact[]> {
  return db
    .select()
    .from(codeInterpreterArtifacts)
    .where(eq(codeInterpreterArtifacts.runId, runId));
}

export async function getRunsByConversation(conversationId: string): Promise<CodeInterpreterRun[]> {
  return db
    .select()
    .from(codeInterpreterRuns)
    .where(eq(codeInterpreterRuns.conversationId, conversationId));
}
