import { db } from "../db";
import { orgSettings, users } from "@shared/schema";
import { eq } from "drizzle-orm";

export type NetworkAccessPolicy = {
  orgId: string;
  orgNetworkAccessEnabled: boolean;
  userNetworkAccessEnabled: boolean;
  effectiveNetworkAccessEnabled: boolean;
  lockedByOrg: boolean;
};

const DEFAULT_ORG_ID = "default";

async function ensureOrgRow(orgId: string) {
  const [row] = await db.select().from(orgSettings).where(eq(orgSettings.orgId, orgId)).limit(1);
  if (row) return row;
  const [created] = await db
    .insert(orgSettings)
    .values({ orgId, networkAccessEnabled: false })
    .returning();
  return created;
}

export async function getNetworkAccessPolicyForUser(userId: string): Promise<NetworkAccessPolicy> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const orgId = (u as any)?.orgId || DEFAULT_ORG_ID;
  const userNetworkAccessEnabled = !!(u as any)?.networkAccessEnabled;

  const org = await ensureOrgRow(orgId);
  const orgNetworkAccessEnabled = !!org.networkAccessEnabled;

  const effectiveNetworkAccessEnabled = orgNetworkAccessEnabled && userNetworkAccessEnabled;
  const lockedByOrg = !orgNetworkAccessEnabled;

  return {
    orgId,
    orgNetworkAccessEnabled,
    userNetworkAccessEnabled,
    effectiveNetworkAccessEnabled,
    lockedByOrg,
  };
}

export async function setUserNetworkAccessEnabled(userId: string, enabled: boolean) {
  await db.update(users).set({ networkAccessEnabled: enabled }).where(eq(users.id, userId));
  return getNetworkAccessPolicyForUser(userId);
}

export async function setOrgNetworkAccessEnabled(orgId: string, enabled: boolean) {
  await ensureOrgRow(orgId);
  await db.update(orgSettings).set({ networkAccessEnabled: enabled, updatedAt: new Date() }).where(eq(orgSettings.orgId, orgId));
  const [row] = await db.select().from(orgSettings).where(eq(orgSettings.orgId, orgId)).limit(1);
  return row;
}
