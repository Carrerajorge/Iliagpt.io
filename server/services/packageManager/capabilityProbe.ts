import path from "path";
import fs from "fs";
import { OSContext } from "./osDetector";

export type PackageManagerId =
  | "apt"
  | "dnf"
  | "yum"
  | "apk"
  | "pacman"
  | "brew"
  | "port"
  | "winget"
  | "choco"
  | "scoop"
  | "npm"
  | "pnpm"
  | "yarn"
  | "pip"
  | "uv"
  | "pipx"
  | "cargo"
  | "nix"
  | "unknown";

export type PackageManagerKind = "os" | "language";

export interface DetectedManager {
  id: PackageManagerId;
  kind: PackageManagerKind;
  binary: string;
  friendlyName: string;
  preferred?: boolean;
}

function findBinary(binary: string): string | null {
  const paths = (process.env.PATH || "").split(path.delimiter);
  for (const base of paths) {
    const candidate = path.join(base, binary);
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function detect(osContext: OSContext, entries: Array<{ id: PackageManagerId; kind: PackageManagerKind; binary: string; friendlyName: string }>): DetectedManager[] {
  const results: DetectedManager[] = [];
  for (const entry of entries) {
    const found = findBinary(entry.binary);
    if (found) {
      results.push({ ...entry, binary: found });
    }
  }

  // Mark a preferred OS manager if any is present
  if (!results.some((m) => m.preferred) && results.length > 0) {
    const preferred = chooseDefaultManager(osContext, results);
    if (preferred) {
      results.forEach((m) => {
        if (m.id === preferred.id) m.preferred = true;
      });
    }
  }

  return results;
}

function chooseDefaultManager(osContext: OSContext, detected: DetectedManager[]): DetectedManager | undefined {
  const priorityByOs: Record<OSContext["family"], PackageManagerId[]> = {
    linux: ["apt", "dnf", "yum", "apk", "pacman", "nix"],
    macos: ["brew", "port", "nix"],
    windows: ["winget", "choco", "scoop"],
    wsl: ["apt", "dnf", "yum", "nix"],
    unknown: [],
  };

  const priorities = priorityByOs[osContext.family] ?? [];
  for (const candidate of priorities) {
    const match = detected.find((m) => m.id === candidate);
    if (match) return match;
  }
  return detected[0];
}

export interface CapabilityReport {
  os: OSContext;
  available: DetectedManager[];
  osManagers: DetectedManager[];
  languageManagers: DetectedManager[];
  defaultManager?: DetectedManager;
}

export function detectPackageManagers(osContext: OSContext): CapabilityReport {
  const osManagers = detect(osContext, [
    { id: "apt", kind: "os", binary: "apt-get", friendlyName: "APT" },
    { id: "dnf", kind: "os", binary: "dnf", friendlyName: "DNF" },
    { id: "yum", kind: "os", binary: "yum", friendlyName: "YUM" },
    { id: "apk", kind: "os", binary: "apk", friendlyName: "APK" },
    { id: "pacman", kind: "os", binary: "pacman", friendlyName: "Pacman" },
    { id: "brew", kind: "os", binary: "brew", friendlyName: "Homebrew" },
    { id: "port", kind: "os", binary: "port", friendlyName: "MacPorts" },
    { id: "winget", kind: "os", binary: "winget", friendlyName: "winget" },
    { id: "choco", kind: "os", binary: "choco", friendlyName: "Chocolatey" },
    { id: "scoop", kind: "os", binary: "scoop", friendlyName: "Scoop" },
    { id: "nix", kind: "os", binary: "nix", friendlyName: "Nix" },
  ]);

  const languageManagers = detect(osContext, [
    { id: "npm", kind: "language", binary: "npm", friendlyName: "npm" },
    { id: "pnpm", kind: "language", binary: "pnpm", friendlyName: "pnpm" },
    { id: "yarn", kind: "language", binary: "yarn", friendlyName: "yarn" },
    { id: "pip", kind: "language", binary: "pip", friendlyName: "pip" },
    { id: "uv", kind: "language", binary: "uv", friendlyName: "uv" },
    { id: "pipx", kind: "language", binary: "pipx", friendlyName: "pipx" },
    { id: "cargo", kind: "language", binary: "cargo", friendlyName: "cargo" },
  ]);

  const available = [...osManagers, ...languageManagers];
  const defaultManager = chooseDefaultManager(osContext, osManagers);

  return {
    os: osContext,
    available,
    osManagers,
    languageManagers,
    defaultManager,
  };
}

export function resolveManager(capabilities: CapabilityReport, requested?: PackageManagerId): DetectedManager | undefined {
  if (requested) {
    const match = capabilities.available.find((m) => m.id === requested);
    if (match) return match;
  }
  return capabilities.defaultManager ?? capabilities.available[0];
}
