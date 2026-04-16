import { spawn } from "child_process";

export const processListToolSchema = {
  type: "function" as const,
  function: {
    name: "process_list",
    description: "List running processes on the system. Can filter by name. Returns PID, CPU%, MEM%, and command for each process. Useful for debugging, checking if services are running, or finding resource-heavy processes.",
    parameters: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          description: "Optional filter to match process names (case-insensitive grep)"
        },
        sortBy: {
          type: "string",
          enum: ["cpu", "mem", "pid"],
          description: "Sort results by CPU usage, memory usage, or PID (default: cpu)"
        },
        limit: {
          type: "number",
          description: "Maximum number of processes to return (default 30, max 100)"
        }
      },
      required: []
    }
  }
};

export const portCheckToolSchema = {
  type: "function" as const,
  function: {
    name: "port_check",
    description: "Check which process is using a specific port, or list all ports in use. Useful for debugging port conflicts or verifying services are listening.",
    parameters: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description: "Specific port number to check. If omitted, lists all listening ports."
        },
        protocol: {
          type: "string",
          enum: ["tcp", "udp", "all"],
          description: "Protocol filter (default: tcp)"
        }
      },
      required: []
    }
  }
};

const SYSTEM_PIDS = new Set([0, 1, 2]);

const TIMEOUT_MS = 10000;

function runCommand(cmd: string, args: string[], timeoutMs = TIMEOUT_MS): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      timeout: timeoutMs,
      env: { ...process.env, LC_ALL: "C" },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > 100000) {
        proc.kill();
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on("error", (err) => {
      resolve({ stdout: "", stderr: err.message, exitCode: 1 });
    });
  });
}

interface ProcessInfo {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  vsz: string;
  rss: string;
  command: string;
}

function parseProcessLine(line: string): ProcessInfo | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("PID") || trimmed.startsWith("USER")) return null;

  const parts = trimmed.split(/\s+/);
  if (parts.length < 7) return null;

  const pid = parseInt(parts[0], 10);
  if (isNaN(pid) || SYSTEM_PIDS.has(pid)) return null;

  return {
    pid,
    user: parts[1],
    cpu: parseFloat(parts[2]) || 0,
    mem: parseFloat(parts[3]) || 0,
    vsz: parts[4],
    rss: parts[5],
    command: parts.slice(6).join(" "),
  };
}

export async function executeProcessList(args: {
  filter?: string;
  sortBy?: "cpu" | "mem" | "pid";
  limit?: number;
}): Promise<{ processes: ProcessInfo[]; count: number; error?: string }> {
  const limit = Math.min(Math.max(args.limit || 30, 1), 100);
  const sortBy = args.sortBy || "cpu";

  const sortFlag = sortBy === "mem" ? "--sort=-%mem" : sortBy === "pid" ? "--sort=pid" : "--sort=-%cpu";
  const { stdout, stderr, exitCode } = await runCommand("ps", [
    "aux", sortFlag
  ]);

  if (exitCode !== 0 && !stdout) {
    return { processes: [], count: 0, error: `ps failed: ${stderr}` };
  }

  const lines = stdout.split("\n");
  let processes: ProcessInfo[] = [];

  for (const line of lines) {
    const proc = parseProcessLine(line);
    if (!proc) continue;

    if (args.filter) {
      const filterLower = args.filter.toLowerCase();
      if (!proc.command.toLowerCase().includes(filterLower)) continue;
    }

    processes.push(proc);
  }

  const total = processes.length;
  processes = processes.slice(0, limit);

  return { processes, count: total };
}

interface PortInfo {
  protocol: string;
  localAddress: string;
  port: number;
  pid: number | null;
  process: string;
  state: string;
}

export async function executePortCheck(args: {
  port?: number;
  protocol?: "tcp" | "udp" | "all";
}): Promise<{ ports: PortInfo[]; error?: string }> {
  if (args.port !== undefined) {
    if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
      return { ports: [], error: "Invalid port number. Must be between 1 and 65535." };
    }
  }

  const protocol = args.protocol || "tcp";

  const ssArgs = ["-lnp"];
  if (protocol === "tcp") ssArgs.push("-t");
  else if (protocol === "udp") ssArgs.push("-u");
  else { ssArgs.push("-t"); ssArgs.push("-u"); }

  let { stdout, stderr, exitCode } = await runCommand("ss", ssArgs);

  if (exitCode !== 0 && !stdout) {
    ({ stdout, stderr, exitCode } = await runCommand("netstat", ["-tlnp"]));
    if (exitCode !== 0 && !stdout) {
      return { ports: [], error: `Could not check ports: ${stderr}` };
    }
  }

  const lines = stdout.split("\n");
  const ports: PortInfo[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("State") || trimmed.startsWith("Netid") || trimmed.startsWith("Proto") || trimmed.startsWith("Active")) continue;

    const portInfo = parseSsLine(trimmed);
    if (!portInfo) continue;

    if (args.port !== undefined && portInfo.port !== args.port) continue;

    ports.push(portInfo);
  }

  return { ports };
}

function parseSsLine(line: string): PortInfo | null {
  const parts = line.split(/\s+/);
  if (parts.length < 5) return null;

  let proto = "";
  let localAddr = "";
  let state = "";
  let processInfo = "";

  if (parts[0] === "tcp" || parts[0] === "udp" || parts[0] === "tcp6" || parts[0] === "udp6") {
    proto = parts[0];
    state = parts[1] || "";
    localAddr = parts[4] || parts[3] || "";
    processInfo = parts.slice(5).join(" ");
  } else if (parts[0].startsWith("LISTEN") || parts[0].startsWith("UNCONN")) {
    state = parts[0];
    proto = "tcp";
    localAddr = parts[3] || "";
    processInfo = parts.slice(5).join(" ");
  } else {
    return null;
  }

  let port = 0;
  const lastColon = localAddr.lastIndexOf(":");
  if (lastColon !== -1) {
    const portStr = localAddr.substring(lastColon + 1);
    port = parseInt(portStr, 10);
    if (isNaN(port)) port = 0;
  }

  let pid: number | null = null;
  let procName = "";
  const pidMatch = processInfo.match(/pid=(\d+)/);
  if (pidMatch) {
    pid = parseInt(pidMatch[1], 10);
  }
  const nameMatch = processInfo.match(/\("([^"]+)"/);
  if (nameMatch) {
    procName = nameMatch[1];
  }

  return {
    protocol: proto.replace("6", ""),
    localAddress: localAddr,
    port,
    pid,
    process: procName || (pid ? `PID ${pid}` : "unknown"),
    state: state,
  };
}
