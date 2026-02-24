import { DetectedManager, PackageManagerId } from "./capabilityProbe";
import { OSContext } from "./osDetector";

export type PackageAction = "install" | "uninstall";

export interface PlanOptions {
  assumeYes?: boolean;
  global?: boolean;
  dryRun?: boolean;
}

export interface BuildPlanInput {
  os: OSContext;
  manager: DetectedManager;
  packageName: string;
  action: PackageAction;
  version?: string;
  options?: PlanOptions;
  policyDecision: "allow" | "warn" | "require_confirmation" | "block";
}

export interface PackagePlan {
  action: PackageAction;
  packageName: string;
  version?: string;
  manager: DetectedManager;
  os: OSContext;

  /** Human-readable command (display only). */
  command: string;

  /**
   * Exec spec for safe execution (no shell). In Phase 1 it is generated but never executed.
   * Phase 2 uses it for execution.
   */
  exec: {
    bin: string;
    args: string[];
    display: string;
    requiresSudo?: boolean;
  };

  notes: string[];
  warnings: string[];
  dryRun: boolean;
  safeToExecute: boolean;
}

function withVersion(name: string, version?: string): string {
  if (!version) return name;
  return `${name}@${version}`;
}

function buildExecSpec(os: OSContext, manager: PackageManagerId, action: PackageAction, pkg: string, version?: string, options: PlanOptions = {}) {
  const { assumeYes = true, global = false } = options;
  const pkgWithVersion = withVersion(pkg, version);

  // Helpers to ensure we never shell out.
  const maybeSudo = (bin: string, args: string[], displayNoSudo: string) => {
    if (os.isContainer) {
      return { bin, args, requiresSudo: false, display: displayNoSudo };
    }
    return { bin: "sudo", args: [bin, ...args], requiresSudo: true, display: `sudo ${displayNoSudo}` };
  };

  switch (manager) {
    case "apt": {
      const args = [action === "install" ? "install" : "remove", ...(assumeYes ? ["-y"] : []), pkgWithVersion];
      const display = `apt-get ${action === "install" ? "install" : "remove"} ${assumeYes ? "-y " : ""}${pkgWithVersion}`.trim();
      return maybeSudo("apt-get", args, display); 
    }
    case "dnf":
    case "yum": {
      const args = [action === "install" ? "install" : "remove", ...(assumeYes ? ["-y"] : []), pkgWithVersion];
      const display = `${manager} ${action === "install" ? "install" : "remove"} ${assumeYes ? "-y " : ""}${pkgWithVersion}`.trim();
      return maybeSudo(manager, args, display);
    }
    case "apk": {
      const args = [action === "install" ? "add" : "del", pkgWithVersion];
      const display = `apk ${action === "install" ? "add" : "del"} ${pkgWithVersion}`.trim();
      return maybeSudo("apk", args, display); 
    }
    case "pacman": {
      const args = [action === "install" ? "-S" : "-R", ...(assumeYes ? ["--noconfirm"] : []), pkgWithVersion];
      const display = `pacman ${action === "install" ? "-S" : "-R"} ${assumeYes ? "--noconfirm " : ""}${pkgWithVersion}`.trim();
      return maybeSudo("pacman", args, display);
    }
    case "brew": {
      const args = [action === "install" ? "install" : "uninstall", pkgWithVersion];
      return { bin: "brew", args, display: `brew ${action === "install" ? "install" : "uninstall"} ${pkgWithVersion}`.trim(), requiresSudo: false };
    }
    case "port": {
      const args = [action === "install" ? "install" : "uninstall", pkgWithVersion];
      const display = `port ${action === "install" ? "install" : "uninstall"} ${pkgWithVersion}`.trim();
      return maybeSudo("port", args, display);
    }
    case "winget": {
      const args = [action === "install" ? "install" : "uninstall", "--exact", "--id", pkgWithVersion];
      return { bin: "winget", args, display: `winget ${action === "install" ? "install" : "uninstall"} --exact --id ${pkgWithVersion}`.trim(), requiresSudo: false };
    }
    case "choco": {
      const args = [action === "install" ? "install" : "uninstall", pkgWithVersion, ...(assumeYes ? ["-y"] : [])];
      return { bin: "choco", args, display: `choco ${action === "install" ? "install" : "uninstall"} ${pkgWithVersion} ${assumeYes ? "-y" : ""}`.trim(), requiresSudo: false };
    }
    case "scoop": {
      const args = [action === "install" ? "install" : "uninstall", pkgWithVersion];
      return { bin: "scoop", args, display: `scoop ${action === "install" ? "install" : "uninstall"} ${pkgWithVersion}`.trim(), requiresSudo: false };
    }
    case "npm": {
      const args = [action === "install" ? "install" : "uninstall", ...(global ? ["-g"] : []), pkgWithVersion];
      return { bin: "npm", args, display: `npm ${action === "install" ? "install" : "uninstall"} ${global ? "-g " : ""}${pkgWithVersion}`.trim(), requiresSudo: false };
    }
    case "pnpm": {
      const args = [action === "install" ? "add" : "remove", ...(global ? ["-g"] : []), pkgWithVersion];
      return { bin: "pnpm", args, display: `pnpm ${action === "install" ? "add" : "remove"} ${global ? "-g " : ""}${pkgWithVersion}`.trim(), requiresSudo: false };
    }
    case "yarn": {
      const args = global
        ? ["global", action === "install" ? "add" : "remove", pkgWithVersion]
        : [action === "install" ? "add" : "remove", pkgWithVersion];
      return { bin: "yarn", args, display: `yarn ${global ? "global " : ""}${action === "install" ? "add" : "remove"} ${pkgWithVersion}`.trim(), requiresSudo: false };
    }
    case "pip": {
      const args = action === "install" ? ["install", pkgWithVersion] : ["uninstall", "-y", pkgWithVersion];
      return { bin: "pip", args, display: `pip ${args.join(" ")}`, requiresSudo: false };
    }
    case "uv": {
      const args = action === "install" ? ["pip", "install", pkgWithVersion] : ["pip", "uninstall", pkgWithVersion];
      return { bin: "uv", args, display: `uv ${args.join(" ")}`, requiresSudo: false };
    }
    case "pipx": {
      const args = [action === "install" ? "install" : "uninstall", pkgWithVersion];
      return { bin: "pipx", args, display: `pipx ${args.join(" ")}`, requiresSudo: false };
    }
    case "cargo": {
      const args = [action === "install" ? "install" : "uninstall", pkgWithVersion];
      return { bin: "cargo", args, display: `cargo ${args.join(" ")}`, requiresSudo: false };
    }
    case "nix": {
      const args = action === "install" ? ["-iA", pkgWithVersion] : ["-e", pkgWithVersion];
      return { bin: "nix-env", args, display: `nix-env ${args.join(" ")}`, requiresSudo: false };
    }
    default:
      return { bin: manager, args: [action, pkgWithVersion], display: `${manager} ${action} ${pkgWithVersion}`, requiresSudo: false };
  }
}

export function buildPlan(input: BuildPlanInput): PackagePlan {
  const notes: string[] = [];
  const warnings: string[] = [];
  const safeToExecute = input.policyDecision !== "block";

  if (input.manager.kind === "language") {
    notes.push("Language-level manager detected; consider using project-level constraints (venv, pnpm workspace, etc.) before executing.");
  }

  if (input.os.isContainer) {
    warnings.push("Running inside a container; ensure host permissions are understood before applying changes.");
  }

  const exec = buildExecSpec(input.os, input.manager.id, input.action, input.packageName, input.version, input.options);

  return {
    action: input.action,
    packageName: input.packageName,
    version: input.version,
    manager: input.manager,
    os: input.os,
    command: exec.display,
    exec,
    notes,
    warnings,
    dryRun: input.options?.dryRun ?? true,
    safeToExecute,
  };
}
