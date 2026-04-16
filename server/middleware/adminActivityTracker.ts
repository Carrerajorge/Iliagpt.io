/**
 * Admin Activity Tracker Middleware
 * Automatically logs all admin API actions
 */

import { Request, Response, NextFunction } from "express";
import { auditLog } from "../services/auditLogger";

// Actions that should be logged automatically
const LOGGED_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

// Paths that should not be logged (to avoid noise)
const EXCLUDED_PATHS = [
  "/api/admin/dashboard/realtime",
  "/api/admin/security/logs",
  "/api/admin/agent/gaps",
];

export function adminActivityTracker(req: Request, res: Response, next: NextFunction) {
  // Only log modifying requests
  if (!LOGGED_METHODS.includes(req.method)) {
    return next();
  }

  // Skip excluded paths
  if (EXCLUDED_PATHS.some(path => req.path.startsWith(path))) {
    return next();
  }

  // Store original end function
  const originalEnd = res.end;

  // Capture response
  res.end = function(chunk?: any, encoding?: any, callback?: any) {
    // Log after response is sent
    setImmediate(async () => {
      try {
        const action = `admin.${req.method.toLowerCase()}.${req.path.replace(/\//g, ".").replace(/^\.api\.admin\./, "")}`;
        
        await auditLog(req, {
          action: action.substring(0, 50), // Truncate if too long
          resource: extractResource(req.path),
          resourceId: extractResourceId(req.path),
          details: {
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            body: sanitizeBody(req.body),
          },
          category: "admin",
          severity: res.statusCode >= 400 ? "error" : "info"
        });
      } catch (error) {
        console.error("[AdminActivityTracker] Failed to log activity:", error);
      }
    });

    // Call original end
    return originalEnd.call(this, chunk, encoding, callback);
  };

  next();
}

/**
 * Extract resource type from path
 */
function extractResource(path: string): string {
  const parts = path.replace("/api/admin/", "").split("/");
  return parts[0] || "unknown";
}

/**
 * Extract resource ID from path if present
 */
function extractResourceId(path: string): string | undefined {
  const parts = path.replace("/api/admin/", "").split("/");
  // Check if second part looks like an ID
  if (parts[1] && !["stats", "list", "export", "bulk"].includes(parts[1])) {
    return parts[1];
  }
  return undefined;
}

/**
 * Sanitize request body to remove sensitive data
 */
function sanitizeBody(body: any): any {
  if (!body) return undefined;
  
  const sanitized = { ...body };
  
  // Remove sensitive fields
  const sensitiveFields = ["password", "apiKey", "secret", "token", "credentials"];
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = "[REDACTED]";
    }
  }
  
  return sanitized;
}
