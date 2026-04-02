import { Router, Request, Response } from "express";
let si: any = null;
try { si = require("systeminformation"); } catch { }
export function createHardwareTelemetryRouter(): Router {
  const router = Router();

  router.get("/stream", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    // flush headers immediately
    res.flushHeaders();

    const fetchAndSendStats = async () => {
      try {
        if (!si) { res.write(`data: ${JSON.stringify({ error: "systeminformation not available" })}\n\n`); return; }
        const mem = await si.mem();
        const cpu = await si.currentLoad();
        const gpu = await si.graphics(); // for VRAM if available
        
        let ollamaStatus = "offline";
        let ollamaLatency = 0;
        let ollamaModels = [];
        try {
          const start = Date.now();
          const ollamaRes = await fetch("http://localhost:11434/api/tags", { 
            signal: AbortSignal.timeout(2000) 
          });
          if (ollamaRes.ok) {
            ollamaStatus = "online";
            ollamaLatency = Date.now() - start;
            const data = await ollamaRes.json();
            if (data && data.models) {
              ollamaModels = data.models.map((m: Record<string, unknown>) => m.name);
            }
          }
        } catch (_) {
          // Keep offline
        }

        const telemetry = {
          time: Date.now(),
          system: {
            memUsed: mem.active,
            memTotal: mem.total,
            cpuLoad: cpu.currentLoad,
            gpus: gpu.controllers.map(c => ({
              model: c.model,
              vram: c.vram,
              vramDynamic: c.vramDynamic
            }))
          },
          ollama: {
            status: ollamaStatus,
            latency: ollamaLatency,
            models: ollamaModels
          }
        };

        res.write(`data: ${JSON.stringify(telemetry)}\n\n`);
      } catch (err) {
        console.error("[HardwareTelemetry] Error fetching stats:", err);
      }
    };

    // Send first reading immediately
    fetchAndSendStats();

    // Loop every 5 seconds
    const interval = setInterval(fetchAndSendStats, 5000);

    req.on("close", () => {
      clearInterval(interval);
    });
  });

  return router;
}
