import { detectOS } from "./osDetector"; import { CapabilityReport, detectPackageManagers, resolveManager, PackageManagerId } from "./capabilityProbe"; import { evaluatePackagePolicy } from 
"./policyEngine"; import { buildPlan, PackagePlan, PackageAction } from "./planner"; import { packageAuditStore } from "./auditStore";

export interface PlanRequest {
  packageName: string;
  manager?: PackageManagerId;
  action?: PackageAction;
  version?: string;
  options?: {
    assumeYes?: boolean;
    global?: boolean;
  };
  requestedBy?: string | null;
}

export interface PlanResponse {
  plan: PackagePlan;
  capabilities: CapabilityReport;
  policy: ReturnType<typeof evaluatePackagePolicy>;
  auditId?: string | null;
  /** Phase 2: confirmation id for execute. In Phase 1 it is still returned, but execute is disabled by feature flag. */
  confirmationId: string;
  confirmationExpiresAt: string;
}

export interface ExecuteRequest {
  confirmationId: string;
  confirm: true;
}

export interface ExecuteResponse {
  confirmationId: string;
  executed: boolean;
  displayCommand: string;
  result?: {
    ok: boolean;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    durationMs: number;
  };
  rollbackPlan?: {
    command: string;
    exec: PackagePlan["exec"];
  };
}

type PendingConfirmation = {
  plan: PackagePlan;
  policy: ReturnType<typeof evaluatePackagePolicy>;
  managerId: string;
  requestedBy: string | null;
  expiresAtMs: number;
};

const confirmations = new Map<string, PendingConfirmation>();

function nowIso() {
  return new Date().toISOString();
}

function randomId(): string {
  // Node 22+ has crypto.randomUUID
  return (globalThis as any).crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanupExpiredConfirmations() {
  const now = Date.now();
  for (const [id, conf] of confirmations) {
    if (conf.expiresAtMs <= now) confirmations.delete(id);
  }
}

class PackageManagerService {
  async plan(input: PlanRequest): Promise<PlanResponse> {
    cleanupExpiredConfirmations();

    const os = detectOS();
    const capabilities = detectPackageManagers(os);

    if (!capabilities.available.length) {
      throw new Error("No package managers detected in this environment.");
    }

    const manager = resolveManager(capabilities, input.manager);
    if (!manager) {
      throw new Error("Requested package manager is not available on this host.");
    }

    const policy = evaluatePackagePolicy({
      packageName: input.packageName,
      action: input.action ?? "install",
      managerId: manager.id,
    });

    const plan = buildPlan({
      os,
      manager,
      packageName: policy.sanitizedName,
      action: input.action ?? "install",
      version: input.version,
      options: { ...input.options, dryRun: true },
      policyDecision: policy.decision,
    });

    // Store confirmation for Phase 2 execution.
    const confirmationId = randomId();
    const ttlMs = 5 * 60 * 1000;
    const expiresAtMs = Date.now() + ttlMs;
    confirmations.set(confirmationId, {
      plan,
      policy,
      managerId: manager.id,
      requestedBy: input.requestedBy ?? null,
      expiresAtMs,
    });

    let auditId: string | null | undefined = undefined;
    try {
      const audit = await packageAuditStore.recordPlan({
        confirmationId,
        command: plan.command,
        packageName: plan.packageName,
        managerId: manager.id,
        action: plan.action,
        osFamily: os.family,
        osDistro: os.distro,
        policyDecision: policy.decision,
        policyWarnings: policy.warnings,
        requestedBy: input.requestedBy ?? null,
      });
      auditId = audit?.id;
    } catch {
      auditId = undefined;
    }

    return {
      plan,
      capabilities,
      policy,
      auditId,
      confirmationId,
      confirmationExpiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async execute(input: ExecuteRequest, requestedBy: string | null): Promise<ExecuteResponse> {
    cleanupExpiredConfirmations();

    if (process.env.ALLOW_SYSTEM_PACKAGE_INSTALL !== "true") {
      throw new Error("EXECUTION_DISABLED: Set ALLOW_SYSTEM_PACKAGE_INSTALL=true to enable /execute.");
    }

    const conf = confirmations.get(input.confirmationId);
    if (!conf) {
      throw new Error("CONFIRMATION_NOT_FOUND_OR_EXPIRED");
    }

    if (input.confirm !== true) {
      throw new Error("CONFIRMATION_REQUIRED");
    }

    // Enforce policy at execution time too.
    if (conf.policy.decision === "block") {
      throw new Error("POLICY_BLOCKED");
    }

    // Build rollback plan (Phase 2: provide rollback command, do not auto-run).
    const rollbackAction = conf.plan.action === "install" ? "uninstall" : "install";
    const rollbackPlan = buildPlan({
      os: conf.plan.os,
      manager: conf.plan.manager,
      packageName: conf.plan.packageName,
      action: rollbackAction,
      version: conf.plan.version,
      options: { dryRun: true },
      policyDecision: conf.policy.decision,
    });

    // Execute
    let result: {
      ok: boolean;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
      stderr: string;
      durationMs: number;
    };

    const isRoot = typeof process.getuid === "function" ? process.getuid() === 0 : false;

    if (!isRoot) {
      const { runViaSandboxRunner } = await import("./runnerClient");

      // Build command to run INSIDE the hardened runner container (no sudo).
      const exec = conf.plan.exec;

      const innerCmdRaw =
        exec.bin === "sudo"
          ? exec.args.join(" ")
          : [exec.bin, ...exec.args].join(" ");

      // apt-get in hardened containers (cap-drop ALL) cannot switch to _apt user.
      // Force apt sandbox user to root to avoid setgroups/seteuid failures.
      const innerCmd =
        innerCmdRaw.startsWith("apt-get ")
          ? innerCmdRaw.replace(/^apt-get\s+/, "apt-get -o APT::Sandbox::User=root ")
          : innerCmdRaw.startsWith("/usr/bin/apt-get ")
            ? innerCmdRaw.replace(/^\/usr\/bin\/apt-get\s+/, "/usr/bin/apt-get -o APT::Sandbox::User=root ")
            : innerCmdRaw;

      const isApt = innerCmd.startsWith("apt-get ") || innerCmd.startsWith("/usr/bin/apt-get ");
      const needsAptUpdate = isApt && conf.plan.action === "install";

      const command = needsAptUpdate
        ? `set -e; apt-get -o APT::Sandbox::User=root update; ${innerCmd}`
        : `set -e; ${innerCmd}`;

      result = await runViaSandboxRunner({
        command,
        timeoutMs: 2 * 60 * 1000,
        maxOutputBytes: 64 * 1024,
      });
    } else {
      const { executeCommand } = await import("./executor");
      result = await executeCommand(
        {
          bin: conf.plan.exec.bin,
          args: conf.plan.exec.args,
          display: conf.plan.exec.display,
          requiresSudo: conf.plan.exec.requiresSudo,
        },
        {
          timeoutMs: 2 * 60 * 1000,
          maxOutputBytes: 64 * 1024,
        }
      );
    }

    // Consume confirmation to avoid replay.
    confirmations.delete(input.confirmationId);
    await packageAuditStore.recordExecute({
      confirmationId: input.confirmationId,
      status: result.ok ? "succeeded" : "failed",
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      exitCode: result.exitCode ?? null,
      durationMs: result.durationMs ?? 0,
      rollbackCommand: rollbackPlan.command ?? null,
    });
    return {
      confirmationId: input.confirmationId,
      executed: true,
      displayCommand: conf.plan.exec.display,
      result,
      rollbackPlan: { command: rollbackPlan.command, exec: rollbackPlan.exec },
    };
  }
}
export const packageManagerService = new PackageManagerService();
