/**
 * System Metrics Collector
 *
 * Collects OS-level CPU, RAM, and disk metrics at a configurable interval.
 * Exposes:
 * - Prometheus gauges (registered in parePrometheusMetrics registry)
 * - JSON snapshot via getSystemMetrics() for the admin API
 * - Historical ring buffer (last 60 samples = 5min at 5s interval)
 */

import os from "os";
import fs from "fs";
import { execFileSync } from "child_process";
import { Gauge, Registry } from "prom-client";
import { createLogger } from "../utils/logger";

const log = createLogger("system-metrics");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CpuSnapshot {
  percent: number;
  cores: number[];
  loadAvg: [number, number, number];
  count: number;
}

export interface MemorySnapshot {
  totalBytes: number;
  usedBytes: number;
  percent: number;
  processRssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
}

export interface DiskSnapshot {
  mount: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  percent: number;
}

export interface SystemMetricsSnapshot {
  timestamp: number;
  cpu: CpuSnapshot;
  memory: MemorySnapshot;
  disks: DiskSnapshot[];
  uptime: { system: number; process: number };
  platform: string;
  hostname: string;
}

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

const HISTORY_SIZE = 60;
const history: SystemMetricsSnapshot[] = [];
let latestSnapshot: SystemMetricsSnapshot | null = null;

// ---------------------------------------------------------------------------
// CPU delta calculation
// ---------------------------------------------------------------------------

let prevCpuTimes: Array<{ idle: number; total: number }> = [];

function measureCpuPercent(): { overall: number; cores: number[] } {
  const cpus = os.cpus();
  const corePcts: number[] = [];
  let totalIdle = 0;
  let totalTick = 0;

  for (let i = 0; i < cpus.length; i++) {
    const t = cpus[i].times;
    const idle = t.idle;
    const total = t.user + t.nice + t.sys + t.idle + t.irq;

    if (prevCpuTimes[i]) {
      const dIdle = idle - prevCpuTimes[i].idle;
      const dTotal = total - prevCpuTimes[i].total;
      corePcts.push(dTotal > 0 ? Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10 : 0);
    }

    totalIdle += idle;
    totalTick += total;
  }

  let overall = 0;
  if (prevCpuTimes.length > 0) {
    const pIdle = prevCpuTimes.reduce((s, c) => s + c.idle, 0);
    const pTot = prevCpuTimes.reduce((s, c) => s + c.total, 0);
    const dI = totalIdle - pIdle;
    const dT = totalTick - pTot;
    overall = dT > 0 ? Math.round(((dT - dI) / dT) * 1000) / 10 : 0;
  }

  prevCpuTimes = cpus.map((cpu) => {
    const t = cpu.times;
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
  });

  return { overall, cores: corePcts };
}

// ---------------------------------------------------------------------------
// Disk measurement (safe — no shell injection)
// ---------------------------------------------------------------------------

function measureDisk(): DiskSnapshot[] {
  // Use Node.js fs.statfsSync where available (Node 18.15+)
  try {
    const stat = fs.statfsSync("/");
    const total = stat.blocks * stat.bsize;
    const free = stat.bfree * stat.bsize;
    const used = total - free;
    return [{
      mount: "/",
      totalBytes: total,
      usedBytes: used,
      availableBytes: free,
      percent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
    }];
  } catch {
    // Fallback: use df (execFileSync — no shell, safe from injection)
    try {
      if (process.platform === "win32") return [];
      const output = execFileSync("df", ["-k", "/"], { timeout: 3000 }).toString();
      const lines = output.trim().split("\n");
      if (lines.length < 2) return [];
      const parts = lines[1].split(/\s+/);
      if (parts.length < 6) return [];
      const totalKb = parseInt(parts[1], 10);
      const usedKb = parseInt(parts[2], 10);
      const availKb = parseInt(parts[3], 10);
      return [{
        mount: parts[5] || "/",
        totalBytes: totalKb * 1024,
        usedBytes: usedKb * 1024,
        availableBytes: availKb * 1024,
        percent: totalKb > 0 ? Math.round((usedKb / totalKb) * 1000) / 10 : 0,
      }];
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

function collectSnapshot(): SystemMetricsSnapshot {
  const cpuMeasure = measureCpuPercent();
  const la = os.loadavg() as [number, number, number];
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const procMem = process.memoryUsage();

  return {
    timestamp: Date.now(),
    cpu: {
      percent: cpuMeasure.overall,
      cores: cpuMeasure.cores,
      loadAvg: [Math.round(la[0] * 100) / 100, Math.round(la[1] * 100) / 100, Math.round(la[2] * 100) / 100],
      count: os.cpus().length,
    },
    memory: {
      totalBytes: totalMem,
      usedBytes: usedMem,
      percent: Math.round((usedMem / totalMem) * 1000) / 10,
      processRssBytes: procMem.rss,
      heapUsedBytes: procMem.heapUsed,
      heapTotalBytes: procMem.heapTotal,
    },
    disks: measureDisk(),
    uptime: { system: Math.round(os.uptime()), process: Math.round(process.uptime()) },
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    hostname: os.hostname(),
  };
}

// ---------------------------------------------------------------------------
// Prometheus gauges
// ---------------------------------------------------------------------------

let gaugesRegistered = false;
let cpuGauge: Gauge;
let memUsedGauge: Gauge;
let memPercentGauge: Gauge;
let diskPercentGauge: Gauge;
let loadAvgGauge: Gauge;
let processRssGauge: Gauge;
let heapUsedGauge: Gauge;

export function registerPrometheusGauges(registry: Registry): void {
  if (gaugesRegistered) return;
  gaugesRegistered = true;

  cpuGauge = new Gauge({ name: "iliagpt_system_cpu_percent", help: "System CPU utilization %", registers: [registry] });
  memUsedGauge = new Gauge({ name: "iliagpt_system_memory_used_bytes", help: "System RAM used bytes", registers: [registry] });
  memPercentGauge = new Gauge({ name: "iliagpt_system_memory_percent", help: "System RAM utilization %", registers: [registry] });
  diskPercentGauge = new Gauge({ name: "iliagpt_system_disk_percent", help: "Disk utilization %", labelNames: ["mount"], registers: [registry] });
  loadAvgGauge = new Gauge({ name: "iliagpt_system_load_average", help: "System load average", labelNames: ["period"], registers: [registry] });
  processRssGauge = new Gauge({ name: "iliagpt_process_rss_bytes", help: "Node.js process RSS bytes", registers: [registry] });
  heapUsedGauge = new Gauge({ name: "iliagpt_process_heap_used_bytes", help: "Node.js heap used bytes", registers: [registry] });
}

function updateGauges(snap: SystemMetricsSnapshot): void {
  if (!gaugesRegistered) return;
  cpuGauge.set(snap.cpu.percent);
  memUsedGauge.set(snap.memory.usedBytes);
  memPercentGauge.set(snap.memory.percent);
  for (const d of snap.disks) diskPercentGauge.labels(d.mount).set(d.percent);
  loadAvgGauge.labels("1m").set(snap.cpu.loadAvg[0]);
  loadAvgGauge.labels("5m").set(snap.cpu.loadAvg[1]);
  loadAvgGauge.labels("15m").set(snap.cpu.loadAvg[2]);
  processRssGauge.set(snap.memory.processRssBytes);
  heapUsedGauge.set(snap.memory.heapUsedBytes);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getSystemMetrics(): SystemMetricsSnapshot | null { return latestSnapshot; }
export function getSystemMetricsHistory(): SystemMetricsSnapshot[] { return [...history]; }

export function collectNow(): SystemMetricsSnapshot {
  const snap = collectSnapshot();
  latestSnapshot = snap;
  history.push(snap);
  if (history.length > HISTORY_SIZE) history.shift();
  updateGauges(snap);
  return snap;
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startCollecting(intervalMs: number = 5000): void {
  if (intervalId) return;
  collectNow();
  setTimeout(collectNow, 1000); // Second sample for valid CPU delta
  intervalId = setInterval(collectNow, intervalMs);
  log.info("System metrics collector started", { intervalMs, historySize: HISTORY_SIZE });
}

export function stopCollecting(): void {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
}
