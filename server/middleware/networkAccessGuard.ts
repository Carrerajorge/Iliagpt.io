import type { Request, Response, NextFunction } from "express";
import { getNetworkAccessPolicyForUser } from "../services/networkAccessPolicyService";
import { getUserId } from "../types/express";

export function requireNetworkAccessEnabled() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Debes iniciar sesión", code: "AUTH_REQUIRED" });
      }

      const policy = await getNetworkAccessPolicyForUser(userId);
      if (!policy.effectiveNetworkAccessEnabled) {
        return res.status(403).json({
          error: "Acceso a red para ejecución desactivado",
          code: "NETWORK_ACCESS_DISABLED",
          policy,
        });
      }

      next();
    } catch (e: any) {
      console.error("[NetworkAccessGuard] error:", e);
      res.status(500).json({ error: "Failed to validate network access policy" });
    }
  };
}
