import { db } from "../../db";

import { packageOperations } from "../../../shared/schema/packageManager";

import { eq } from "drizzle-orm";

import { Logger } from "../../lib/logger";


export type PlanAuditPayload = {

  confirmationId: string;

  command: string;

  packageName: string;

  managerId: string;

  action: string;

  osFamily?: string | null;

  osDistro?: string | null;

  policyDecision?: string | null;

  policyWarnings?: string[] | null;

  requestedBy?: string | null;

};


export type ExecuteAuditPayload = {

  confirmationId: string;

  status: "succeeded" | "failed";

  stdout: string;

  stderr: string;

  exitCode: number | null;

  durationMs: number;

  rollbackCommand?: string | null;

};


class PackageAuditStore {

  async recordPlan(payload: PlanAuditPayload): Promise<{ id: string } | null> {

    try {

      const rows = await db

        .insert(packageOperations)

        .values({

          confirmationId: payload.confirmationId,

          packageName: payload.packageName,

          manager: payload.managerId,

          action: payload.action,

          status: "planned",

          osFamily: payload.osFamily ?? null,

          osDistro: payload.osDistro ?? null,

          command: payload.command ?? null,

          policyDecision: payload.policyDecision ?? null,

          policyWarnings: payload.policyWarnings ?? [],

          requestedBy: payload.requestedBy ?? null,

        })

        .returning({ id: packageOperations.id });


      return rows?.[0] ? { id: rows[0].id } : null;

    } catch (e: any) {

      Logger.warn("[PackageAuditStore] recordPlan failed", { message: e?.message || String(e) });

      return null;

    }

  }


  async recordExecute(payload: ExecuteAuditPayload): Promise<void> {

    try {

      await db

        .update(packageOperations)

        .set({

          status: payload.status,

          stdout: payload.stdout ?? null,

          stderr: payload.stderr ?? null,

          exitCode: payload.exitCode ?? null,

          durationMs: payload.durationMs ?? null,

          rollbackCommand: payload.rollbackCommand ?? null,

          updatedAt: new Date(),

        })

        .where(eq(packageOperations.confirmationId, payload.confirmationId));

    } catch (e: any) {

      Logger.warn("[PackageAuditStore] recordExecute failed", { message: e?.message || String(e) });

    }

  }

}


export const packageAuditStore = new PackageAuditStore();
