export type DangerousMatch = { reason: string; pattern: RegExp };

// High-risk shell command patterns.
// Requirement alignment: allow execution, but require explicit confirmation for destructive operations.
export const SHELL_DANGEROUS_PATTERNS: DangerousMatch[] = [
  // Match any rm invocation that includes both -r and -f flags (combined or separate: -rf, -fr, -r -f, etc.).
  { pattern: /\brm\b[\s\S]*-\S*r\S*f/i, reason: "rm -rf" },
  { pattern: /\bmkfs(\.|\s)/i, reason: "mkfs" },
  { pattern: /\bdd\b\s+if=/i, reason: "dd if=" },
  { pattern: />\s*\/dev\//i, reason: "> /dev/*" },
  { pattern: /\bsudo\b/i, reason: "sudo" },
  { pattern: /\bchmod\b\s+777\b/i, reason: "chmod 777" },
  { pattern: /\b(curl|wget)\b.*\|\s*sh\b/i, reason: "curl|sh / wget|sh" },
  { pattern: /\b(shutdown|reboot)\b/i, reason: "shutdown/reboot" },
];

export function getDangerousShellMatch(command: string): DangerousMatch | null {
  const cmd = String(command || "");
  for (const d of SHELL_DANGEROUS_PATTERNS) {
    if (d.pattern.test(cmd)) return d;
  }
  return null;
}

export function getShellSandboxMode(): "host" | "docker" | "runner" {
  const explicit = (process.env.SHELL_COMMAND_SANDBOX_MODE || "").toLowerCase().trim();
  if (explicit === "host" || explicit === "docker" || explicit === "runner") return explicit;

  // Stable default: in production, use runner (docker-isolated) by default.
  if ((process.env.NODE_ENV || "").toLowerCase() === "production") return "runner";

  return "host";
}
