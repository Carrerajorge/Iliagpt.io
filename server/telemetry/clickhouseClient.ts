import { createClient } from '@clickhouse/client';

export const clickhouse = createClient({
  host: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'iliagpt_telemetry',
  application: 'iliagpt-hypervisor'
});

export async function initializeClickhouse() {
  try {
    // Ensure DB exists
    await clickhouse.command({
      query: 'CREATE DATABASE IF NOT EXISTS iliagpt_telemetry'
    });

    // Agent Actions Table
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS agent_actions (
          timestamp DateTime64(3),
          session_id String,
          agent_id String,
          action_type String,
          action_params String,
          result String,
          duration_ms UInt32,
          surprise_before Float32,
          surprise_after Float32,
          success UInt8
        ) ENGINE = MergeTree()
        ORDER BY (timestamp, session_id)
      `
    });

    // Vision Frames Table
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS vision_frames (
          timestamp DateTime64(3),
          frame_id String,
          change_percent Float32,
          elements_detected UInt16,
          semantic_state String,
          focused_app String,
          analysis_ms UInt32
        ) ENGINE = MergeTree()
        ORDER BY timestamp
        TTL timestamp + INTERVAL 2 WEEK
      `
    });

    // System Metrics Table
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS system_metrics (
          timestamp DateTime64(3),
          cpu_percent Float32,
          memory_used_mb UInt32,
          gpu_percent Float32,
          disk_io_read_mb Float32,
          disk_io_write_mb Float32,
          network_rx_mb Float32,
          network_tx_mb Float32,
          active_processes UInt16
        ) ENGINE = MergeTree()
        ORDER BY timestamp
        TTL timestamp + INTERVAL 4 WEEK
      `
    });

    console.log("[Telemetry] ClickHouse Schemas Verified. Analytical DB Ready.");
  } catch (error) {
    console.warn("[Telemetry] ClickHouse Init Warning:", error);
    // Graceful degradation si no está corriendo el container
  }
}

// Batching Buffers
let agentActionsBuffer: any[] = [];
let visionFramesBuffer: any[] = [];
let systemMetricsBuffer: any[] = [];

// Buffered Insert Functions
export function insertAgentAction(action: {
  sessionId: string;
  agentId: string;
  actionType: string;
  actionParams: string;
  result: string;
  durationMs: number;
  surpriseBefore: number;
  surpriseAfter: number;
  success: boolean;
}) {
  agentActionsBuffer.push({
    timestamp: new Date().toISOString().replace('T', ' ').replace('Z', ''),
    session_id: action.sessionId,
    agent_id: action.agentId,
    action_type: action.actionType,
    action_params: action.actionParams,
    result: action.result,
    duration_ms: action.durationMs,
    surprise_before: action.surpriseBefore,
    surprise_after: action.surpriseAfter,
    success: action.success ? 1 : 0
  });
}

export function insertVisionFrame(frame: {
  frameId: string;
  changePercent: number;
  elementsDetected: number;
  semanticState: string;
  focusedApp: string;
  analysisMs: number;
}) {
  visionFramesBuffer.push({
    timestamp: new Date().toISOString().replace('T', ' ').replace('Z', ''),
    frame_id: frame.frameId,
    change_percent: frame.changePercent,
    elements_detected: frame.elementsDetected,
    semantic_state: frame.semanticState,
    focused_app: frame.focusedApp,
    analysis_ms: frame.analysisMs
  });
}

export function insertSystemMetrics(metrics: {
  cpuPercent: number;
  memoryUsedMb: number;
  gpuPercent: number;
  diskIoReadMb: number;
  diskIoWriteMb: number;
  networkRxMb: number;
  networkTxMb: number;
  activeProcesses: number;
}) {
  systemMetricsBuffer.push({
    timestamp: new Date().toISOString().replace('T', ' ').replace('Z', ''),
    cpu_percent: metrics.cpuPercent,
    memory_used_mb: metrics.memoryUsedMb,
    gpu_percent: metrics.gpuPercent,
    disk_io_read_mb: metrics.diskIoReadMb,
    disk_io_write_mb: metrics.diskIoWriteMb,
    network_rx_mb: metrics.networkRxMb,
    network_tx_mb: metrics.networkTxMb,
    active_processes: metrics.activeProcesses
  });
}

// Background Batch Flush Loop
setInterval(async () => {
  try {
    if (agentActionsBuffer.length > 0) {
      const batch = [...agentActionsBuffer];
      agentActionsBuffer = [];
      await clickhouse.insert({
        table: 'agent_actions',
        values: batch,
        format: 'JSONEachRow'
      });
    }

    if (visionFramesBuffer.length > 0) {
      const batch = [...visionFramesBuffer];
      visionFramesBuffer = [];
      await clickhouse.insert({
        table: 'vision_frames',
        values: batch,
        format: 'JSONEachRow'
      });
    }

    if (systemMetricsBuffer.length > 0) {
      const batch = [...systemMetricsBuffer];
      systemMetricsBuffer = [];
      await clickhouse.insert({
        table: 'system_metrics',
        values: batch,
        format: 'JSONEachRow'
      });
    }
  } catch (e) {
    console.error("[Telemetry] ClickHouse Batch Insert Failed:", e);
  }
}, 5000); // Trigger flush every 5 seconds
