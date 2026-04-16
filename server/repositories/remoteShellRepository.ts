import { db } from "../db";
import { remoteShellTargets, type RemoteShellTarget, type InsertRemoteShellTarget } from "../../shared/schema";
import { eq, or, sql } from "drizzle-orm";

export interface CreateRemoteTargetInput {
  name: string;
  host: string;
  port?: number;
  username: string;
  authType: "password" | "private_key";
  encryptedSecret: string;
  secretHint?: string;
  ownerId: string;
  allowedAdminIds?: string[];
  notes?: string;
}

export interface UpdateRemoteTargetInput {
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  authType?: "password" | "private_key";
  encryptedSecret?: string;
  secretHint?: string;
  allowedAdminIds?: string[];
  notes?: string;
}

function sanitize(target: RemoteShellTarget) {
  const { encryptedSecret, ...rest } = target;
  return {
    ...rest,
    allowedAdminIds: rest.allowedAdminIds ?? [],
  };
}

class RemoteShellRepository {
  async createTarget(input: CreateRemoteTargetInput) {
    const [record] = await db.insert(remoteShellTargets).values({
      name: input.name,
      host: input.host,
      port: input.port ?? 22,
      username: input.username,
      authType: input.authType,
      encryptedSecret: input.encryptedSecret,
      secretHint: input.secretHint,
      ownerId: input.ownerId,
      allowedAdminIds: input.allowedAdminIds ?? [],
      notes: input.notes,
    }).returning();

    return sanitize(record);
  }

  async listTargetsForAdmin(adminId: string) {
    const rows = await db.select().from(remoteShellTargets).where(
      or(
        eq(remoteShellTargets.ownerId, adminId),
        sql`ARRAY[${adminId}]::text[] && ${remoteShellTargets.allowedAdminIds}`
      )
    ).orderBy(remoteShellTargets.createdAt);
    return rows.map(sanitize);
  }

  async getTargetById(id: string): Promise<RemoteShellTarget | undefined> {
    const [record] = await db.select().from(remoteShellTargets).where(eq(remoteShellTargets.id, id));
    return record;
  }

  async updateTarget(id: string, updates: UpdateRemoteTargetInput) {
    if (!Object.keys(updates).length) {
      const target = await this.getTargetById(id);
      return target ? sanitize(target) : undefined;
    }

    const payload: Partial<InsertRemoteShellTarget> & { updatedAt: any } = {
      updatedAt: sql`NOW()`,
    };

    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.host !== undefined) payload.host = updates.host;
    if (updates.port !== undefined) payload.port = updates.port;
    if (updates.username !== undefined) payload.username = updates.username;
    if (updates.authType !== undefined) payload.authType = updates.authType;
    if (updates.encryptedSecret !== undefined) payload.encryptedSecret = updates.encryptedSecret;
    if (updates.secretHint !== undefined) payload.secretHint = updates.secretHint;
    if (updates.allowedAdminIds !== undefined) payload.allowedAdminIds = updates.allowedAdminIds;
    if (updates.notes !== undefined) payload.notes = updates.notes;

    const [record] = await db
      .update(remoteShellTargets)
      .set(payload)
      .where(eq(remoteShellTargets.id, id))
      .returning();

    return record ? sanitize(record) : undefined;
  }

  async deleteTarget(id: string) {
    await db.delete(remoteShellTargets).where(eq(remoteShellTargets.id, id));
  }

  async recordSuccess(id: string) {
    await db
      .update(remoteShellTargets)
      .set({ lastConnectedAt: sql`NOW()`, updatedAt: sql`NOW()` })
      .where(eq(remoteShellTargets.id, id));
  }
}

export const remoteShellRepository = new RemoteShellRepository();
