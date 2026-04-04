import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { createHash } from "crypto";
import pino from "pino";
import type { CollaborationProtocol } from "./CollaborationProtocol.js";

const logger = pino({ name: "SharedWorkspace" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ArtifactType =
  | "document"
  | "code"
  | "data"
  | "image"
  | "config"
  | "plan"
  | "report"
  | "other";

export type LockMode = "none" | "read" | "write" | "exclusive";

export interface ArtifactVersion {
  version: number;
  content: string | Buffer;
  contentHash: string;
  contentType: string;
  size: number;
  authorId: string;
  commitMessage?: string;
  parentVersion?: number;
  createdAt: number;
  metadata: Record<string, unknown>;
}

export interface Artifact {
  artifactId: string;
  workspaceId: string;
  name: string;
  type: ArtifactType;
  path: string; // virtual path, e.g. "/plans/task-001.md"
  versions: ArtifactVersion[];
  currentVersion: number;
  locks: Lock[];
  tags: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  /** Whether this artifact is shared read-only with observers */
  public: boolean;
}

export interface Lock {
  lockId: string;
  agentId: string;
  mode: LockMode;
  acquiredAt: number;
  expiresAt: number;
  reason?: string;
}

export interface Workspace {
  workspaceId: string;
  swarmId: string;
  name: string;
  artifacts: Map<string, Artifact>;
  /** agentId → role */
  members: Map<string, "owner" | "editor" | "viewer">;
  createdAt: number;
  updatedAt: number;
}

export interface DiffEntry {
  path: string[];
  type: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
}

// ─── Diff utility ─────────────────────────────────────────────────────────────

function computeTextDiff(before: string, after: string): DiffEntry[] {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const diffs: DiffEntry[] = [];

  const maxLen = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < maxLen; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b === undefined) {
      diffs.push({ path: [`line:${i}`], type: "added", after: a });
    } else if (a === undefined) {
      diffs.push({ path: [`line:${i}`], type: "removed", before: b });
    } else if (b !== a) {
      diffs.push({ path: [`line:${i}`], type: "changed", before: b, after: a });
    }
  }
  return diffs;
}

// ─── SharedWorkspace ──────────────────────────────────────────────────────────

export class SharedWorkspace extends EventEmitter {
  private workspaces = new Map<string, Workspace>();
  private lockTimeout = 30_000; // 30 seconds default lock TTL

  constructor(private readonly protocol: CollaborationProtocol) {
    super();
    // Periodically expire stale locks
    setInterval(() => this.expireLocks(), 10_000);
    logger.info("[SharedWorkspace] Initialized");
  }

  // ── Workspace management ──────────────────────────────────────────────────────

  createWorkspace(swarmId: string, name: string, ownerId: string): Workspace {
    const workspaceId = randomUUID();
    const workspace: Workspace = {
      workspaceId,
      swarmId,
      name,
      artifacts: new Map(),
      members: new Map([[ownerId, "owner"]]),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.workspaces.set(workspaceId, workspace);
    logger.info({ workspaceId, swarmId, name }, "[SharedWorkspace] Workspace created");
    this.emit("workspace:created", { workspaceId, swarmId });
    return workspace;
  }

  addMember(
    workspaceId: string,
    agentId: string,
    role: "editor" | "viewer" = "editor"
  ): void {
    const ws = this.getWorkspaceOrThrow(workspaceId);
    ws.members.set(agentId, role);
    logger.debug({ workspaceId, agentId, role }, "[SharedWorkspace] Member added");
  }

  // ── Artifact creation ─────────────────────────────────────────────────────────

  async createArtifact(
    workspaceId: string,
    agentId: string,
    spec: {
      name: string;
      type: ArtifactType;
      path: string;
      content: string | Buffer;
      contentType?: string;
      commitMessage?: string;
      tags?: string[];
      isPublic?: boolean;
      metadata?: Record<string, unknown>;
    }
  ): Promise<Artifact> {
    const ws = this.getWorkspaceOrThrow(workspaceId);
    this.assertAccess(ws, agentId, "write");

    if (this.findArtifactByPath(ws, spec.path)) {
      throw new Error(`Artifact at path '${spec.path}' already exists in workspace '${workspaceId}'`);
    }

    const content =
      typeof spec.content === "string" ? spec.content : spec.content.toString("utf8");
    const contentHash = createHash("sha256").update(content).digest("hex");

    const firstVersion: ArtifactVersion = {
      version: 1,
      content,
      contentHash,
      contentType: spec.contentType ?? "text/plain",
      size: Buffer.byteLength(content),
      authorId: agentId,
      commitMessage: spec.commitMessage ?? "Initial version",
      createdAt: Date.now(),
      metadata: spec.metadata ?? {},
    };

    const artifact: Artifact = {
      artifactId: randomUUID(),
      workspaceId,
      name: spec.name,
      type: spec.type,
      path: spec.path,
      versions: [firstVersion],
      currentVersion: 1,
      locks: [],
      tags: spec.tags ?? [],
      createdBy: agentId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      public: spec.isPublic ?? false,
    };

    ws.artifacts.set(artifact.artifactId, artifact);
    ws.updatedAt = Date.now();

    this.notifySwarm(ws.swarmId, "artifact_created", {
      artifactId: artifact.artifactId,
      workspaceId,
      path: artifact.path,
      authorId: agentId,
    });

    logger.info(
      { artifactId: artifact.artifactId, path: artifact.path },
      "[SharedWorkspace] Artifact created"
    );
    this.emit("artifact:created", {
      artifactId: artifact.artifactId,
      workspaceId,
    });

    return artifact;
  }

  // ── Updates with version control ──────────────────────────────────────────────

  async updateArtifact(
    workspaceId: string,
    artifactId: string,
    agentId: string,
    update: {
      content: string | Buffer;
      contentType?: string;
      commitMessage?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<{ artifact: Artifact; version: ArtifactVersion; diff: DiffEntry[] }> {
    const ws = this.getWorkspaceOrThrow(workspaceId);
    this.assertAccess(ws, agentId, "write");

    const artifact = ws.artifacts.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact '${artifactId}' not found in workspace '${workspaceId}'`);
    }

    // Check lock
    this.assertLock(artifact, agentId);

    const content =
      typeof update.content === "string"
        ? update.content
        : update.content.toString("utf8");
    const contentHash = createHash("sha256").update(content).digest("hex");

    const currentContent = this.getArtifactContent(artifact);

    // Idempotency: same hash = no-op
    const currentVersion = artifact.versions[artifact.versions.length - 1];
    if (currentVersion.contentHash === contentHash) {
      return {
        artifact,
        version: currentVersion,
        diff: [],
      };
    }

    const newVersion: ArtifactVersion = {
      version: artifact.currentVersion + 1,
      content,
      contentHash,
      contentType:
        update.contentType ?? currentVersion.contentType,
      size: Buffer.byteLength(content),
      authorId: agentId,
      commitMessage: update.commitMessage ?? `Update by ${agentId}`,
      parentVersion: artifact.currentVersion,
      createdAt: Date.now(),
      metadata: update.metadata ?? currentVersion.metadata,
    };

    artifact.versions.push(newVersion);
    artifact.currentVersion = newVersion.version;
    artifact.updatedAt = Date.now();

    const diff = computeTextDiff(
      typeof currentContent === "string" ? currentContent : currentContent.toString("utf8"),
      content
    );

    ws.updatedAt = Date.now();

    this.notifySwarm(ws.swarmId, "artifact_updated", {
      artifactId,
      workspaceId,
      version: newVersion.version,
      authorId: agentId,
      diffCount: diff.length,
    });

    logger.debug(
      { artifactId, version: newVersion.version, changes: diff.length },
      "[SharedWorkspace] Artifact updated"
    );
    this.emit("artifact:updated", { artifactId, workspaceId, version: newVersion.version });

    return { artifact, version: newVersion, diff };
  }

  // ── Lock management ───────────────────────────────────────────────────────────

  acquireLock(
    workspaceId: string,
    artifactId: string,
    agentId: string,
    mode: LockMode = "write",
    reason?: string
  ): Lock {
    const ws = this.getWorkspaceOrThrow(workspaceId);
    const artifact = ws.artifacts.get(artifactId);
    if (!artifact) throw new Error(`Artifact '${artifactId}' not found`);

    // Check for conflicting locks
    const activeLocks = artifact.locks.filter((l) => l.expiresAt > Date.now());

    if (mode === "exclusive" && activeLocks.length > 0) {
      const holder = activeLocks[0];
      throw new Error(
        `Cannot acquire exclusive lock: artifact is locked by '${holder.agentId}'`
      );
    }

    if (mode === "write") {
      const writeLock = activeLocks.find(
        (l) => l.mode === "write" || l.mode === "exclusive"
      );
      if (writeLock && writeLock.agentId !== agentId) {
        throw new Error(
          `Cannot acquire write lock: artifact is write-locked by '${writeLock.agentId}'`
        );
      }
    }

    // Release any existing lock by this agent
    artifact.locks = artifact.locks.filter((l) => l.agentId !== agentId);

    const lock: Lock = {
      lockId: randomUUID(),
      agentId,
      mode,
      acquiredAt: Date.now(),
      expiresAt: Date.now() + this.lockTimeout,
      reason,
    };

    artifact.locks.push(lock);
    logger.debug({ artifactId, agentId, mode }, "[SharedWorkspace] Lock acquired");
    this.emit("lock:acquired", { artifactId, agentId, mode });
    return lock;
  }

  releaseLock(workspaceId: string, artifactId: string, agentId: string): void {
    const ws = this.getWorkspaceOrThrow(workspaceId);
    const artifact = ws.artifacts.get(artifactId);
    if (!artifact) return;

    const before = artifact.locks.length;
    artifact.locks = artifact.locks.filter((l) => l.agentId !== agentId);

    if (artifact.locks.length < before) {
      logger.debug({ artifactId, agentId }, "[SharedWorkspace] Lock released");
      this.emit("lock:released", { artifactId, agentId });
    }
  }

  private expireLocks(): void {
    const now = Date.now();
    for (const ws of this.workspaces.values()) {
      for (const artifact of ws.artifacts.values()) {
        const before = artifact.locks.length;
        artifact.locks = artifact.locks.filter((l) => l.expiresAt > now);
        if (artifact.locks.length < before) {
          logger.debug(
            { artifactId: artifact.artifactId },
            "[SharedWorkspace] Expired locks removed"
          );
        }
      }
    }
  }

  private assertLock(artifact: Artifact, agentId: string): void {
    const now = Date.now();
    const activeLocks = artifact.locks.filter(
      (l) => l.expiresAt > now && l.mode !== "read"
    );

    const agentHasLock = activeLocks.find((l) => l.agentId === agentId);
    const otherHasExclusiveLock = activeLocks.find(
      (l) => l.agentId !== agentId && (l.mode === "exclusive" || l.mode === "write")
    );

    if (otherHasExclusiveLock) {
      throw new Error(
        `Cannot write: artifact is locked by agent '${otherHasExclusiveLock.agentId}' (mode: ${otherHasExclusiveLock.mode})`
      );
    }
  }

  // ── Version history ───────────────────────────────────────────────────────────

  getVersion(
    workspaceId: string,
    artifactId: string,
    version: number
  ): ArtifactVersion | null {
    const ws = this.getWorkspaceOrThrow(workspaceId);
    const artifact = ws.artifacts.get(artifactId);
    if (!artifact) return null;
    return artifact.versions.find((v) => v.version === version) ?? null;
  }

  getVersionHistory(workspaceId: string, artifactId: string): ArtifactVersion[] {
    const ws = this.getWorkspaceOrThrow(workspaceId);
    return ws.artifacts.get(artifactId)?.versions ?? [];
  }

  diffVersions(
    workspaceId: string,
    artifactId: string,
    versionA: number,
    versionB: number
  ): DiffEntry[] {
    const a = this.getVersion(workspaceId, artifactId, versionA);
    const b = this.getVersion(workspaceId, artifactId, versionB);
    if (!a || !b) return [];

    return computeTextDiff(
      typeof a.content === "string" ? a.content : a.content.toString("utf8"),
      typeof b.content === "string" ? b.content : b.content.toString("utf8")
    );
  }

  // ── Read helpers ──────────────────────────────────────────────────────────────

  getArtifact(workspaceId: string, artifactId: string): Artifact | null {
    return this.workspaces.get(workspaceId)?.artifacts.get(artifactId) ?? null;
  }

  getArtifactByPath(workspaceId: string, path: string): Artifact | null {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) return null;
    return this.findArtifactByPath(ws, path);
  }

  getArtifactContent(artifact: Artifact): string | Buffer {
    const version = artifact.versions[artifact.versions.length - 1];
    return version?.content ?? "";
  }

  listArtifacts(workspaceId: string, type?: ArtifactType): Artifact[] {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) return [];
    const all = Array.from(ws.artifacts.values());
    return type ? all.filter((a) => a.type === type) : all;
  }

  // ── Access control ────────────────────────────────────────────────────────────

  private assertAccess(
    ws: Workspace,
    agentId: string,
    mode: "read" | "write"
  ): void {
    const memberRole = ws.members.get(agentId);
    if (!memberRole) {
      throw new Error(
        `Agent '${agentId}' is not a member of workspace '${ws.workspaceId}'`
      );
    }
    if (mode === "write" && memberRole === "viewer") {
      throw new Error(
        `Agent '${agentId}' has read-only access to workspace '${ws.workspaceId}'`
      );
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────────

  private getWorkspaceOrThrow(workspaceId: string): Workspace {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) throw new Error(`Workspace '${workspaceId}' not found`);
    return ws;
  }

  private findArtifactByPath(ws: Workspace, path: string): Artifact | null {
    for (const a of ws.artifacts.values()) {
      if (a.path === path) return a;
    }
    return null;
  }

  private notifySwarm(swarmId: string, type: string, payload: unknown): void {
    this.protocol.broadcast(swarmId, {
      from: "system",
      type: type as never,
      payload,
    });
  }

  getStats(workspaceId: string) {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) return null;
    const artifacts = Array.from(ws.artifacts.values());
    return {
      workspaceId,
      artifacts: artifacts.length,
      totalVersions: artifacts.reduce((s, a) => s + a.versions.length, 0),
      activeLocks: artifacts.reduce(
        (s, a) => s + a.locks.filter((l) => l.expiresAt > Date.now()).length,
        0
      ),
      members: ws.members.size,
    };
  }
}
