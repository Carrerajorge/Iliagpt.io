
import { Router } from "express";
import { dbRead } from "../db"; // Use read replica for health check
import { cache } from "../lib/cache";
import { sql } from "drizzle-orm";
import fs from "fs";
import os from "os";

export const healthRouter = Router();

// Simple health check - always responds quickly
healthRouter.get("/", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

healthRouter.get("/detailed", async (req, res) => {
  const status: any = {
    status: "ok",
    timestamp: new Date().toISOString(),
    components: {},
    system: {
      uptime: os.uptime(),
      loadavg: os.loadavg(),
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
      }
    }
  };

  // Check Database
  try {
    const start = Date.now();
    await dbRead.execute(sql`SELECT 1`);
    status.components.database = {
      status: "up",
      latencyMs: Date.now() - start
    };
  } catch (error: any) {
    status.components.database = {
      status: "down",
      error: error.message
    };
    status.status = "degraded"; // or "down"
  }

  // Check Redis
  try {
    const start = Date.now();
    const redis = cache.getRedisClient();
    if (redis) {
      await redis.ping();
      status.components.redis = {
        status: "up",
        latencyMs: Date.now() - start
      };
    } else {
      status.components.redis = {
        status: "disabled", // or "up" if using memory cache fallback
        message: "Using in-memory cache"
      };
    }
  } catch (error: any) {
    status.components.redis = {
      status: "down",
      error: error.message
    };
    status.status = "degraded";
  }

  // Check Disk Space (basic check of root existence, advanced checks require 'check-disk-space' pkg)
  try {
    // Just check if we can write to tmp
    const testFile = `/tmp/health_check_${Date.now()}`;
    fs.writeFileSync(testFile, "ok");
    fs.unlinkSync(testFile);
    status.components.disk = {
      status: "healthy",
      message: "Write access confirmed"
    };
  } catch (error: any) {
    status.components.disk = {
      status: "unhealthy",
      error: error.message
    };
    status.status = "degraded";
  }

  const statusCode = status.status === "ok" ? 200 : 503;
  res.status(statusCode).json(status);
});

export function createHealthRouter() {
  return healthRouter;
}

export default healthRouter;
