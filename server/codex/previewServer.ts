/**
 * Codex VC Preview Server
 *
 * Detects the project framework, starts the appropriate dev server on a random
 * port (3001-3999), and supports reverse-proxying requests through the main
 * Express app at /api/codex/preview/{sessionId}.
 */

import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as http from "http";

// --- Types ---

interface PreviewProcess {
  sessionId: string;
  port: number;
  process: ChildProcess;
  framework: string;
  startedAt: number;
}

type DetectedFramework = "react-vite" | "nextjs" | "vue-vite" | "express" | "flask" | "static" | "vite";

// --- Port allocation ---

const MIN_PORT = 3001;
const MAX_PORT = 3999;
const usedPorts = new Set<number>();

function allocatePort(): number {
  for (let attempt = 0; attempt < 200; attempt++) {
    const port = MIN_PORT + Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1));
    if (!usedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
  }
  throw new Error("No available preview ports");
}

function releasePort(port: number) {
  usedPorts.delete(port);
}

// --- Framework detection ---

async function detectFramework(workspace: string, hint?: string): Promise<DetectedFramework> {
  // Check hint from session
  if (hint) {
    const hintMap: Record<string, DetectedFramework> = {
      react: "react-vite", nextjs: "nextjs", vue: "vue-vite",
      express: "express", flask: "flask", html: "static", node: "vite",
    };
    if (hintMap[hint]) return hintMap[hint];
  }

  // Auto-detect from package.json
  try {
    const raw = await fs.readFile(path.join(workspace, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps.next) return "nextjs";
    if (deps.vue || deps["@vitejs/plugin-vue"]) return "vue-vite";
    if (deps.react && deps.vite) return "react-vite";
    if (deps.vite) return "vite";
    if (deps.express) return "express";
  } catch { /* no package.json */ }

  // Check for Python
  try {
    await fs.access(path.join(workspace, "app.py"));
    return "flask";
  } catch { /* not flask */ }

  // Check for static HTML
  try {
    await fs.access(path.join(workspace, "index.html"));
    return "static";
  } catch { /* not static */ }

  return "vite";
}

function getStartCommand(framework: DetectedFramework, port: number): { cmd: string; env?: Record<string, string> } {
  switch (framework) {
    case "react-vite":
    case "vue-vite":
    case "vite":
      return { cmd: `npx vite --port ${port} --host 0.0.0.0` };
    case "nextjs":
      return { cmd: `npx next dev -p ${port}` };
    case "express":
      return { cmd: "npx tsx src/index.ts", env: { PORT: String(port) } };
    case "flask":
      return { cmd: `python3 app.py`, env: { FLASK_RUN_PORT: String(port), PORT: String(port) } };
    case "static":
      return { cmd: `npx serve -l ${port} -s .` };
  }
}

// --- Preview Manager (singleton) ---

export class PreviewManager {
  private static _instance: PreviewManager | null = null;
  private previews = new Map<string, PreviewProcess>();

  static instance(): PreviewManager {
    if (!PreviewManager._instance) {
      PreviewManager._instance = new PreviewManager();
    }
    return PreviewManager._instance;
  }

  async start(sessionId: string, workspace: string, frameworkHint?: string): Promise<number> {
    // Stop existing preview if any
    this.stop(sessionId);

    const framework = await detectFramework(workspace, frameworkHint);
    const port = allocatePort();
    const { cmd, env } = getStartCommand(framework, port);

    const proc = spawn("/bin/bash", ["-c", cmd], {
      cwd: workspace,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env, HOME: workspace },
      detached: true,
    });

    // Don't let the preview process keep the parent alive
    proc.unref();

    const preview: PreviewProcess = {
      sessionId,
      port,
      process: proc,
      framework,
      startedAt: Date.now(),
    };

    this.previews.set(sessionId, preview);

    proc.on("close", () => {
      if (this.previews.get(sessionId) === preview) {
        this.previews.delete(sessionId);
        releasePort(port);
      }
    });

    // Wait briefly for the dev server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    return port;
  }

  stop(sessionId: string): void {
    const preview = this.previews.get(sessionId);
    if (!preview) return;
    try {
      // Kill the process group
      if (preview.process.pid) {
        process.kill(-preview.process.pid, "SIGTERM");
      }
    } catch { /* already dead */ }
    releasePort(preview.port);
    this.previews.delete(sessionId);
  }

  getPort(sessionId: string): number | undefined {
    return this.previews.get(sessionId)?.port;
  }

  isRunning(sessionId: string): boolean {
    return this.previews.has(sessionId);
  }

  /**
   * Proxy an HTTP request to the preview dev server.
   *
   * `targetPath` is the path the dev server should see (e.g. "/" or
   * "/assets/index.css?v=123").  The router is responsible for extracting
   * this from its own route params — we never try to parse req.url here,
   * which avoids breakage when the Express router is mounted at an
   * arbitrary prefix.
   */
  proxyPath(
    sessionId: string,
    targetPath: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const preview = this.previews.get(sessionId);
    if (!preview) {
      res.writeHead(503, { "Content-Type": "text/html" });
      res.end("<html><body><h2>Preview not running</h2><p>Start the preview from the Codex panel.</p></body></html>");
      return;
    }

    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port: preview.port,
      path: targetPath || "/",
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${preview.port}` },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on("error", () => {
      res.writeHead(502, { "Content-Type": "text/html" });
      res.end("<html><body><h2>Preview starting...</h2><p>The dev server is still booting. Refresh in a moment.</p></body></html>");
    });

    req.pipe(proxyReq, { end: true });
  }

  stopAll(): void {
    for (const sessionId of this.previews.keys()) {
      this.stop(sessionId);
    }
  }
}
