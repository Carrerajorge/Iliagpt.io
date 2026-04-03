/**
 * Auth Storage — Identity Resolution with Provider Linking
 *
 * IAM Hardening:
 *  - Email canonicalization (UNIQUE index on email_canonical)
 *  - Provider identity linking (user_identities table)
 *  - Auth event bus emissions for CQRS projections
 */

import { users, userSettings, libraryStorage, userIdentities, type User } from "@shared/schema";
import { db } from "../../db";
import { eq, sql, and } from "drizzle-orm";
import { autoAcceptWorkspaceInvitationForUser } from "../../services/workspaceInvitationService";
import { canonicalizeEmail } from "../../lib/emailCanon";
import { authEventBus } from "../../services/authEventBus";

export type UpsertUser = {
  id: string;
  email?: string | null;
  username?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  role?: string | null;
  authProvider?: string | null;
  emailVerified?: string | null;
  providerSubject?: string | null;
};

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserLogin(id: string, loginData: { ipAddress?: string | null; userAgent?: string | null }): Promise<void>;
}

const RETURNING_COLUMNS = {
  id: users.id,
  email: users.email,
  emailCanonical: users.emailCanonical,
  username: users.username,
  fullName: users.fullName,
  firstName: users.firstName,
  lastName: users.lastName,
  profileImageUrl: users.profileImageUrl,
  role: users.role,
  status: users.status,
  authProvider: users.authProvider,
  emailVerified: users.emailVerified,
  plan: users.plan,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  orgId: users.orgId,
};

function mapAuthUserRow(row: any): User {
  const firstName = row.first_name ?? row.firstName ?? null;
  const lastName = row.last_name ?? row.lastName ?? null;
  const fullName = row.full_name ?? row.fullName ?? ([firstName, lastName].filter(Boolean).join(" ") || null);

  return {
    id: String(row.id),
    email: row.email ?? null,
    password: row.password ?? null,
    username: row.username ?? null,
    firstName,
    lastName,
    fullName,
    role: row.role ?? "user",
    status: row.status ?? "active",
    authProvider: row.auth_provider ?? row.authProvider ?? "email",
    emailVerified: row.email_verified ?? row.emailVerified ?? "false",
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    lastLoginAt: row.last_login_at ?? row.lastLoginAt ?? null,
    lastIp: row.last_ip ?? row.lastIp ?? null,
    userAgent: row.user_agent ?? row.userAgent ?? null,
    loginCount: row.login_count ?? row.loginCount ?? 0,
    orgId: row.org_id ?? row.orgId ?? "default",
  } as User;
}

function getSqlCode(error: any): string | undefined {
  return error?.cause?.code || error?.code;
}

async function ensureIdentityLink(
  userId: string,
  provider: string,
  providerSubject: string,
  providerEmail?: string | null,
  emailVerified?: boolean,
): Promise<void> {
  try {
    await db
      .insert(userIdentities)
      .values({
        userId,
        provider,
        providerSubject,
        providerEmail: providerEmail || null,
        emailVerified: emailVerified ?? false,
        linkedAt: new Date(),
        lastUsedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [userIdentities.provider, userIdentities.providerSubject],
        set: {
          lastUsedAt: new Date(),
          providerEmail: providerEmail || sql`user_identities.provider_email`,
          emailVerified: emailVerified ?? sql`user_identities.email_verified`,
        },
      });
  } catch (error: any) {
    console.warn(`[AuthStorage] ensureIdentityLink failed for user=${userId} provider=${provider}:`, error?.message || error);
  }
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    try {
      const result = await db.execute(sql`
        SELECT id, email, password, username, first_name, last_name, role, status,
               auth_provider, email_verified, created_at, updated_at, last_login_at,
               last_ip, user_agent, login_count, org_id
        FROM users
        WHERE id = ${id}
        LIMIT 1
      `);
      const row = (result as any)?.rows?.[0];
      if (!row) return undefined;
      return mapAuthUserRow(row);
    } catch (error: any) {
      const sqlCode = getSqlCode(error);
      if (sqlCode === "42703") {
        const fallbackResult = await db.execute(sql`
          SELECT id, email, password FROM users WHERE id = ${id} LIMIT 1
        `);
        const fallbackRow = (fallbackResult as any)?.rows?.[0];
        if (!fallbackRow) return undefined;
        return mapAuthUserRow(fallbackRow);
      }
      if (sqlCode === "42P01") return undefined;
      console.error(`[AuthStorage] getUser failed for id=${id}:`, error?.message || error);
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const canonical = canonicalizeEmail(email);
    try {
      const result = await db.execute(sql`
        SELECT id, email, password, username, first_name, last_name, role, status,
               auth_provider, email_verified, created_at, updated_at, last_login_at,
               last_ip, user_agent, login_count, org_id
        FROM users
        WHERE email_canonical = ${canonical}
        LIMIT 1
      `);
      const row = (result as any)?.rows?.[0];
      if (!row) return undefined;
      return mapAuthUserRow(row);
    } catch (error: any) {
      const sqlCode = getSqlCode(error);
      if (sqlCode === "42703") {
        try {
          const result = await db.execute(sql`
            SELECT id, email, password, username, first_name, last_name, role, status,
                   auth_provider, email_verified, created_at, updated_at, last_login_at,
                   last_ip, user_agent, login_count, org_id
            FROM users WHERE email ILIKE ${canonical} LIMIT 1
          `);
          const row = (result as any)?.rows?.[0];
          if (!row) return undefined;
          return mapAuthUserRow(row);
        } catch {
          const result = await db.execute(sql`
            SELECT id, email, password FROM users WHERE email ILIKE ${canonical} LIMIT 1
          `);
          const row = (result as any)?.rows?.[0];
          if (!row) return undefined;
          return mapAuthUserRow(row);
        }
      }
      if (sqlCode === "42P01") return undefined;
      console.error(`[AuthStorage] getUserByEmail failed:`, error?.message || error);
      throw error;
    }
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const startTime = Date.now();
    const provider = userData.authProvider || "email";
    const providerSubject = userData.providerSubject || userData.id;
    const canonical = userData.email ? canonicalizeEmail(userData.email) : null;

    try {
      // Step 1: Resolve by provider identity
      try {
        const identityResult = await db.execute(sql`
          SELECT user_id FROM user_identities
          WHERE provider = ${provider} AND provider_subject = ${providerSubject}
          LIMIT 1
        `);
        const identityRow = (identityResult as any)?.rows?.[0];
        if (identityRow) {
          const existingUser = await this.getUser(identityRow.user_id);
          if (existingUser) {
            const [updatedUser] = await db
              .update(users)
              .set({
                email: userData.email ?? existingUser.email,
                username: userData.username ?? existingUser.username,
                fullName: userData.fullName ?? existingUser.fullName,
                firstName: userData.firstName ?? existingUser.firstName,
                lastName: userData.lastName ?? existingUser.lastName,
                profileImageUrl: userData.profileImageUrl ?? existingUser.profileImageUrl,
                authProvider: userData.authProvider ?? existingUser.authProvider,
                emailVerified: userData.emailVerified ?? existingUser.emailVerified,
                updatedAt: new Date(),
              })
              .where(eq(users.id, existingUser.id))
              .returning(RETURNING_COLUMNS);

            await ensureIdentityLink(existingUser.id, provider, providerSubject, userData.email, userData.emailVerified === "true");
            authEventBus.publish("USER_UPDATED", updatedUser.id, { provider, resolvedBy: "identity" });
            this.bestEffortPostLogin(updatedUser.id);
            return updatedUser;
          }
        }
      } catch (identityError: any) {
        if (getSqlCode(identityError) !== "42P01" && getSqlCode(identityError) !== "42703") {
          console.warn("[AuthStorage] Identity lookup failed, falling back:", identityError?.message);
        }
      }

      // Step 2: Resolve by user ID
      const existingById = await this.getUser(userData.id);
      if (existingById) {
        const [updatedUser] = await db
          .update(users)
          .set({
            email: userData.email ?? existingById.email,
            username: userData.username ?? existingById.username,
            fullName: userData.fullName ?? existingById.fullName,
            firstName: userData.firstName ?? existingById.firstName,
            lastName: userData.lastName ?? existingById.lastName,
            profileImageUrl: userData.profileImageUrl ?? existingById.profileImageUrl,
            authProvider: userData.authProvider ?? existingById.authProvider,
            emailVerified: userData.emailVerified ?? existingById.emailVerified,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userData.id))
          .returning(RETURNING_COLUMNS);

        await ensureIdentityLink(updatedUser.id, provider, providerSubject, userData.email, userData.emailVerified === "true");
        authEventBus.publish("USER_UPDATED", updatedUser.id, { provider, resolvedBy: "id" });
        this.bestEffortPostLogin(updatedUser.id);
        return updatedUser;
      }

      // Step 3: Resolve by canonical email
      if (canonical) {
        const existingByEmail = await this.getUserByEmail(canonical);
        if (existingByEmail) {
          const [updatedUser] = await db
            .update(users)
            .set({
              username: userData.username ?? existingByEmail.username,
              fullName: userData.fullName ?? existingByEmail.fullName,
              firstName: userData.firstName ?? existingByEmail.firstName,
              lastName: userData.lastName ?? existingByEmail.lastName,
              profileImageUrl: userData.profileImageUrl ?? existingByEmail.profileImageUrl,
              authProvider: userData.authProvider ?? existingByEmail.authProvider,
              emailVerified: userData.emailVerified ?? existingByEmail.emailVerified,
              updatedAt: new Date(),
            })
            .where(eq(users.id, existingByEmail.id))
            .returning(RETURNING_COLUMNS);

          await ensureIdentityLink(existingByEmail.id, provider, providerSubject, userData.email, userData.emailVerified === "true");
          authEventBus.publish("IDENTITY_LINKED", updatedUser.id, { provider, resolvedBy: "email" });
          this.bestEffortPostLogin(updatedUser.id);
          return updatedUser;
        }
      }

      // Step 4: Create new user + identity
      const [newUser] = await db
        .insert(users)
        .values({
          id: userData.id,
          orgId: userData.id,
          email: userData.email,
          emailCanonical: canonical,
          username: userData.username ?? (userData.email ? userData.email.split("@")[0] : null),
          fullName: userData.fullName,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          authProvider: userData.authProvider ?? "email",
          emailVerified: userData.emailVerified ?? "false",
          role: userData.role ?? "user",
          plan: "free",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning(RETURNING_COLUMNS);

      await ensureIdentityLink(newUser.id, provider, providerSubject, userData.email, userData.emailVerified === "true");
      authEventBus.publish("USER_REGISTERED", newUser.id, { email: newUser.email, provider });

      console.log(JSON.stringify({
        event: "user_created", userId: newUser.id, email: newUser.email,
        authProvider: newUser.authProvider, durationMs: Date.now() - startTime,
      }));

      this.bestEffortPostLogin(newUser.id);
      return newUser;

    } catch (error: any) {
      console.error(JSON.stringify({
        event: "user_upsert_failed", error: error.message,
        code: error.code, durationMs: Date.now() - startTime,
      }));
      throw new Error(`Failed to upsert user: ${error.message}`);
    }
  }

  private bestEffortPostLogin(userId: string): void {
    Promise.resolve().then(async () => {
      try { await autoAcceptWorkspaceInvitationForUser(userId); } catch {}
    });
  }

  async updateUserLogin(id: string, loginData: { ipAddress?: string | null; userAgent?: string | null }): Promise<void> {
    try {
      const now = new Date();
      const result = await db.update(users).set({
        lastLoginAt: now,
        lastIp: loginData.ipAddress,
        userAgent: loginData.userAgent,
        loginCount: sql<number>`COALESCE(${users.loginCount}, 0) + 1`,
        updatedAt: now,
      }).where(eq(users.id, id)).returning({ id: users.id });

      if (result.length === 0) {
        console.warn(`[AuthStorage] updateUserLogin: No user found with id=${id}`);
      }

      authEventBus.publish("USER_LOGIN", id, { ip: loginData.ipAddress });

      try { await db.insert(userSettings).values({ userId: id }).onConflictDoNothing(); } catch {}
      try { await db.insert(libraryStorage).values({ userId: id }).onConflictDoNothing(); } catch {}
    } catch (error: any) {
      console.error(`[AuthStorage] updateUserLogin failed for id=${id}:`, error.message);
      throw error;
    }
  }
}

export const authStorage = new AuthStorage();
