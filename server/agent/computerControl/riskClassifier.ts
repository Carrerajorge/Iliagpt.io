import { EventEmitter } from "events";

export type RiskLevel = "safe" | "moderate" | "dangerous" | "critical";

export interface RiskClassification {
  command: string;
  riskLevel: RiskLevel;
  reasons: string[];
  requiresConfirmation: boolean;
  blockedByDefault: boolean;
  timestamp: number;
}

const CRITICAL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive\s+--force|-[a-zA-Z]*f[a-zA-Z]*r)\b/, reason: "Recursive forced deletion" },
  { pattern: /\brm\s+-rf\s+\/\s*$/, reason: "Root filesystem deletion" },
  { pattern: /\bmkfs\b/, reason: "Filesystem format" },
  { pattern: /\bdd\s+.*of=\/dev\//, reason: "Raw disk write" },
  { pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/, reason: "Fork bomb" },
  { pattern: />\s*\/dev\/sd[a-z]/, reason: "Direct device write" },
  { pattern: /\bshutdown\b/, reason: "System shutdown" },
  { pattern: /\breboot\b/, reason: "System reboot" },
  { pattern: /\binit\s+[06]\b/, reason: "System halt/reboot via init" },
  { pattern: /\bsystemctl\s+(poweroff|halt|reboot)\b/, reason: "System power control" },
];

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bsudo\b/, reason: "Elevated privileges (sudo)" },
  { pattern: /\bsu\s+-?\s*$/, reason: "Switch to root user" },
  { pattern: /\bchmod\s+[0-7]*7[0-7]*\s/, reason: "Permissive chmod" },
  { pattern: /\bchmod\s+-R\b/, reason: "Recursive permission change" },
  { pattern: /\bchown\s+-R\b/, reason: "Recursive ownership change" },
  { pattern: /\brm\s+-rf\b/, reason: "Recursive forced deletion" },
  { pattern: /\brm\s+-r\b/, reason: "Recursive deletion" },
  { pattern: /\biptables\b/, reason: "Firewall modification" },
  { pattern: /\bufw\b/, reason: "Firewall modification" },
  { pattern: /\bsystemctl\s+(start|stop|restart|enable|disable)\b/, reason: "Service management" },
  { pattern: /\bkill\s+-9\b/, reason: "Force kill process" },
  { pattern: /\bkillall\b/, reason: "Kill all processes by name" },
  { pattern: /\bpkill\b/, reason: "Pattern-based process kill" },
  { pattern: /\bcrontab\s+-[er]\b/, reason: "Cron job modification" },
  { pattern: /\buseradd\b/, reason: "User account creation" },
  { pattern: /\buserdel\b/, reason: "User account deletion" },
  { pattern: /\bpasswd\b/, reason: "Password change" },
  { pattern: /\bvisudo\b/, reason: "Sudoers modification" },
  { pattern: />\s*\/etc\//, reason: "Write to system config" },
  { pattern: /\bsed\s+-i\b.*\/etc\//, reason: "In-place edit of system config" },
  { pattern: /\bcurl\b.*\|\s*(ba)?sh\b/, reason: "Pipe remote script to shell" },
  { pattern: /\bwget\b.*\|\s*(ba)?sh\b/, reason: "Pipe remote script to shell" },
];

const MODERATE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bnpm\s+install\b/, reason: "Package installation (npm)" },
  { pattern: /\byarn\s+add\b/, reason: "Package installation (yarn)" },
  { pattern: /\bpip\s+install\b/, reason: "Package installation (pip)" },
  { pattern: /\bapt(-get)?\s+install\b/, reason: "Package installation (apt)" },
  { pattern: /\bbrew\s+install\b/, reason: "Package installation (brew)" },
  { pattern: /\bcurl\b/, reason: "Network request (curl)" },
  { pattern: /\bwget\b/, reason: "Network request (wget)" },
  { pattern: /\bgit\s+push\b/, reason: "Git push" },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: "Git hard reset" },
  { pattern: /\bgit\s+clean\s+-fd\b/, reason: "Git clean forced" },
  { pattern: /\bdocker\s+rm\b/, reason: "Docker container removal" },
  { pattern: /\bdocker\s+rmi\b/, reason: "Docker image removal" },
  { pattern: /\benv\b/, reason: "Environment variable access" },
  { pattern: /\bexport\b/, reason: "Environment variable export" },
  { pattern: /\bscp\b/, reason: "Secure copy" },
  { pattern: /\brsync\b/, reason: "Remote sync" },
  { pattern: /\bssh\b/, reason: "SSH connection" },
];

export class RiskClassifier extends EventEmitter {
  private customRules: Array<{ pattern: RegExp; level: RiskLevel; reason: string }> = [];

  classify(command: string): RiskClassification {
    const trimmed = command.trim();
    const reasons: string[] = [];
    let maxLevel: RiskLevel = "safe";

    const checkPatterns = (
      patterns: Array<{ pattern: RegExp; reason: string }>,
      level: RiskLevel
    ) => {
      for (const { pattern, reason } of patterns) {
        if (pattern.test(trimmed)) {
          reasons.push(reason);
          if (riskOrder(level) > riskOrder(maxLevel)) {
            maxLevel = level;
          }
        }
      }
    };

    checkPatterns(CRITICAL_PATTERNS, "critical");
    checkPatterns(DANGEROUS_PATTERNS, "dangerous");
    checkPatterns(MODERATE_PATTERNS, "moderate");

    for (const rule of this.customRules) {
      if (rule.pattern.test(trimmed)) {
        reasons.push(rule.reason);
        if (riskOrder(rule.level) > riskOrder(maxLevel)) {
          maxLevel = rule.level;
        }
      }
    }

    const classification: RiskClassification = {
      command: trimmed,
      riskLevel: maxLevel,
      reasons,
      requiresConfirmation: maxLevel === "dangerous" || maxLevel === "critical",
      blockedByDefault: maxLevel === "critical",
      timestamp: Date.now(),
    };

    this.emit("classified", classification);
    return classification;
  }

  addRule(pattern: RegExp, level: RiskLevel, reason: string): void {
    this.customRules.push({ pattern, level, reason });
  }

  clearCustomRules(): void {
    this.customRules = [];
  }
}

function riskOrder(level: RiskLevel): number {
  switch (level) {
    case "safe": return 0;
    case "moderate": return 1;
    case "dangerous": return 2;
    case "critical": return 3;
  }
}

export const riskClassifier = new RiskClassifier();
