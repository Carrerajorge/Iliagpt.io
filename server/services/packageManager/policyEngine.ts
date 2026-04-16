import { PackageManagerId } from "./capabilityProbe";

export type PolicyDecision = "allow" | "warn" | "require_confirmation" | "block";

export interface PolicyResult {
  decision: PolicyDecision;
  sanitizedName: string;
  reasons: string[];
  warnings: string[];
  severity: "low" | "medium" | "high";
}

export interface PolicyInput {
  packageName: string;
  action: "install" | "uninstall";
  managerId: PackageManagerId;
}

const dangerousPackages = [
  "metasploit",
  "msfconsole",
  "msfvenom",
  "nmap",
  "sqlmap",
  "aircrack-ng",
  "hydra",
  "john",
  "hashcat",
  "ettercap",
  "kismet",
  "wifite",
  "tcpdump",
  "wireshark",
  "powersploit",
  "revshell",
  "miner",
];

const criticalSystemPackages = ["systemd", "kernel", "linux-image", "glibc", "libc", "openssh-server"];

const invalidChars = /[;&|`$<>\\]/;
const whitespace = /\s/;
const allowedPattern = /^[a-zA-Z0-9._+@-]+$/;

function sanitizePackageName(name: string): string {
  return name.trim();
}

export function evaluatePackagePolicy(input: PolicyInput): PolicyResult {
  const sanitizedName = sanitizePackageName(input.packageName);
  const reasons: string[] = [];
  const warnings: string[] = [];
  let decision: PolicyDecision = "allow";
  let severity: PolicyResult["severity"] = "low";

  if (!sanitizedName || sanitizedName.length < 2) {
    decision = "block";
    reasons.push("Package name is empty or too short.");
    severity = "high";
  }

  if (invalidChars.test(sanitizedName) || whitespace.test(sanitizedName)) {
    decision = "block";
    reasons.push("Package name contains forbidden characters or whitespace.");
    severity = "high";
  }

  if (!allowedPattern.test(sanitizedName)) {
    decision = "block";
    reasons.push("Package name contains unsupported characters.");
    severity = "high";
  }

  if (dangerousPackages.some((pkg) => sanitizedName.toLowerCase().includes(pkg))) {
    decision = "block";
    reasons.push("Package appears to be offensive tooling (hacking/mining/reverse shells).");
    severity = "high";
  }

  if (criticalSystemPackages.some((pkg) => sanitizedName.toLowerCase().startsWith(pkg))) {
    decision = "require_confirmation";
    warnings.push("Operation targets a critical system package; manual confirmation required.");
    severity = "medium";
  }

  if (input.action === "uninstall" && (sanitizedName === "sudo" || sanitizedName === "bash")) {
    decision = "block";
    reasons.push("Refusing to remove fundamental tooling (sudo/bash).");
    severity = "high";
  }

  if (decision === "allow" && warnings.length === 0 && sanitizedName.length > 60) {
    decision = "warn";
    warnings.push("Package name is unusually long; verify it is not obfuscated.");
    severity = "medium";
  }

  return {
    decision,
    sanitizedName,
    reasons,
    warnings,
    severity,
  };
}
