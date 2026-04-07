import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_LOG_DIR, getResolvedLoggerSettings } from "../openclaw-src/logging";
import { requireAdmin } from "./admin/utils";

type GatewayLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

type GatewayLogEntry = {
  id: string;
  file: string;
  raw: string;
  time: string;
  level: GatewayLogLevel | "unknown";
  message: string;
  subsystem?: string;
  data?: Record<string, unknown>;
};

type LogFilters = {
  levels: Set<GatewayLogLevel> | null;
  search: string;
};

const VALID_LEVELS: GatewayLogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];
const VALID_LEVEL_SET = new Set<GatewayLogLevel>(VALID_LEVELS);
const LOG_FILE_RE = /^openclaw(?:-\d{4}-\d{2}-\d{2})?\.log$/;
const DEFAULT_SNAPSHOT_LIMIT = 400;
const DEFAULT_MAX_BYTES = 400_000;
const HEARTBEAT_MS = 15_000;
const POLL_MS = 1_500;

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function getLogDirectory(): string {
  const configuredFile = getResolvedLoggerSettings().file;
  return path.dirname(configuredFile || DEFAULT_LOG_DIR);
}

async function listGatewayLogFiles() {
  const dir = getLogDirectory();
  await fsp.mkdir(dir, { recursive: true });
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && LOG_FILE_RE.test(entry.name))
      .map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        const stat = await fsp.stat(fullPath);
        return {
          name: entry.name,
          path: fullPath,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          modifiedAtMs: stat.mtimeMs,
        };
      }),
  );

  return files.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
}

async function resolveLogFile(requested?: string): Promise<string> {
  const configuredFile = getResolvedLoggerSettings().file;
  const files = await listGatewayLogFiles();
  const configuredName = path.basename(configuredFile);

  if (requested) {
    const safeName = path.basename(requested);
    if (!LOG_FILE_RE.test(safeName)) {
      throw new Error("Invalid log file");
    }
    const match = files.find((file) => file.name === safeName);
    if (match) return match.path;
    throw new Error("Requested log file not found");
  }

  const configuredMatch = files.find((file) => file.name === configuredName);
  if (configuredMatch) return configuredMatch.path;
  return files[0]?.path || configuredFile;
}

function normalizeLevel(value: unknown): GatewayLogLevel | "unknown" {
  const normalized = String(value ?? "").toLowerCase().trim();
  return VALID_LEVEL_SET.has(normalized as GatewayLogLevel) ? (normalized as GatewayLogLevel) : "unknown";
}

function extractMessage(payload: Record<string, unknown>, raw: string): string {
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }

  if (typeof payload.msg === "string" && payload.msg.trim()) {
    return payload.msg.trim();
  }

  if (Array.isArray(payload.arguments) && payload.arguments.length > 0) {
    return payload.arguments.map((item) => String(item ?? "")).join(" ").trim();
  }

  return raw;
}

function parseLogLine(rawLine: string, fileName: string, position: number): GatewayLogEntry | null {
  const raw = rawLine.trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const time =
      (typeof parsed.time === "string" && parsed.time) ||
      (typeof parsed.date === "string" && parsed.date) ||
      new Date().toISOString();
    const level = normalizeLevel(
      parsed.level ??
      (parsed._meta && typeof parsed._meta === "object" ? (parsed._meta as Record<string, unknown>).logLevelName : undefined),
    );
    const message = extractMessage(parsed, raw);
    const subsystem =
      typeof parsed.subsystem === "string"
        ? parsed.subsystem
        : typeof parsed.name === "string"
          ? parsed.name
          : undefined;

    return {
      id: `${fileName}:${position}`,
      file: fileName,
      raw,
      time,
      level,
      message,
      subsystem,
      data: parsed,
    };
  } catch {
    return {
      id: `${fileName}:${position}`,
      file: fileName,
      raw,
      time: new Date().toISOString(),
      level: "unknown",
      message: raw,
    };
  }
}

function parseLevels(raw: unknown): Set<GatewayLogLevel> | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  const levels = raw
    .split(",")
    .map((level) => normalizeLevel(level))
    .filter((level): level is GatewayLogLevel => level !== "unknown");
  return levels.length > 0 ? new Set(levels) : null;
}

function buildFilters(req: Request): LogFilters {
  return {
    levels: parseLevels(req.query.level),
    search: String(req.query.search || "").trim().toLowerCase(),
  };
}

function matchesFilters(entry: GatewayLogEntry, filters: LogFilters): boolean {
  if (filters.levels && (!VALID_LEVEL_SET.has(entry.level as GatewayLogLevel) || !filters.levels.has(entry.level as GatewayLogLevel))) {
    return false;
  }

  if (!filters.search) return true;

  const haystack = [
    entry.message,
    entry.raw,
    entry.subsystem || "",
    entry.time,
    JSON.stringify(entry.data || {}),
  ].join(" ").toLowerCase();

  return haystack.includes(filters.search);
}

async function readFileTail(file: string, maxBytes = DEFAULT_MAX_BYTES): Promise<{ text: string; size: number }> {
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat) {
    return { text: "", size: 0 };
  }

  const size = stat.size;
  const start = Math.max(0, size - maxBytes);
  const handle = await fsp.open(file, "r");

  try {
    const length = size - start;
    const buffer = Buffer.alloc(Math.max(0, length));
    const readResult = await handle.read(buffer, 0, length, start);
    let text = buffer.toString("utf8", 0, readResult.bytesRead);
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
    }
    return { text, size };
  } finally {
    await handle.close();
  }
}

async function readFilteredSnapshot(file: string, filters: LogFilters, limit: number) {
  const fileName = path.basename(file);
  const tail = await readFileTail(file);
  const entries = tail.text
    .split("\n")
    .map((line, index) => parseLogLine(line, fileName, index))
    .filter((entry): entry is GatewayLogEntry => Boolean(entry))
    .filter((entry) => matchesFilters(entry, filters))
    .slice(-limit);

  return {
    cursor: tail.size,
    entries,
  };
}

async function readSinceCursor(file: string, cursor: number, filters: LogFilters) {
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat) {
    return { cursor: 0, reset: true, entries: [] as GatewayLogEntry[] };
  }

  const fileName = path.basename(file);
  const fileSize = stat.size;
  const reset = fileSize < cursor;
  const start = reset ? 0 : cursor;

  if (fileSize === start) {
    return { cursor: fileSize, reset, entries: [] as GatewayLogEntry[] };
  }

  const handle = await fsp.open(file, "r");
  try {
    const length = fileSize - start;
    const buffer = Buffer.alloc(length);
    const readResult = await handle.read(buffer, 0, length, start);
    const text = buffer.toString("utf8", 0, readResult.bytesRead);
    const entries = text
      .split("\n")
      .map((line, index) => parseLogLine(line, fileName, start + index))
      .filter((entry): entry is GatewayLogEntry => Boolean(entry))
      .filter((entry) => matchesFilters(entry, filters));

    return { cursor: fileSize, reset, entries };
  } finally {
    await handle.close();
  }
}

function writeSseEvent(res: Response, event: string, payload: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function createGatewayLogsRouter() {
  const router = Router();

  router.use(requireAdmin);

  router.get("/files", async (_req, res) => {
    try {
      const files = await listGatewayLogFiles();
      res.json({
        files: files.map((file) => ({
          name: file.name,
          size: file.size,
          modifiedAt: file.modifiedAt,
          isCurrent: file.name === path.basename(getResolvedLoggerSettings().file),
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to list log files" });
    }
  });

  router.get("/export", async (req, res) => {
    try {
      const file = await resolveLogFile(typeof req.query.file === "string" ? req.query.file : undefined);
      const filters = buildFilters(req);
      const limit = Math.max(1, Math.min(5000, Number(req.query.limit) || 2000));
      const format = String(req.query.format || "json").toLowerCase() === "csv" ? "csv" : "json";
      const snapshot = await readFilteredSnapshot(file, filters, limit);

      if (format === "csv") {
        const csv = [
          ["time", "level", "subsystem", "message", "file"].join(","),
          ...snapshot.entries.map((entry) => [
            escapeCsv(entry.time),
            escapeCsv(entry.level),
            escapeCsv(entry.subsystem || ""),
            escapeCsv(entry.message),
            escapeCsv(entry.file),
          ].join(",")),
        ].join("\n");

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${path.basename(file, ".log")}-filtered.csv"`);
        return res.send(csv);
      }

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(file, ".log")}-filtered.json"`);
      return res.send(JSON.stringify({ file: path.basename(file), entries: snapshot.entries }, null, 2));
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to export logs" });
    }
  });

  router.get("/stream", async (req, res) => {
    let watcher: fs.FSWatcher | null = null;
    let heartbeat: NodeJS.Timeout | null = null;
    let interval: NodeJS.Timeout | null = null;
    let closed = false;
    let inFlight = false;
    let queued = false;
    let cursor = 0;
    let activeFile = "";

    const cleanup = () => {
      closed = true;
      watcher?.close();
      if (heartbeat) clearInterval(heartbeat);
      if (interval) clearInterval(interval);
      res.end();
    };

    try {
      const filters = buildFilters(req);
      const snapshotLimit = Math.max(1, Math.min(1000, Number(req.query.limit) || DEFAULT_SNAPSHOT_LIMIT));
      activeFile = await resolveLogFile(typeof req.query.file === "string" ? req.query.file : undefined);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      const sendIncrementalUpdate = async () => {
        if (closed || inFlight) {
          queued = true;
          return;
        }

        inFlight = true;
        try {
          const nextFile = await resolveLogFile(typeof req.query.file === "string" ? req.query.file : undefined);
          if (nextFile !== activeFile) {
            activeFile = nextFile;
            const snapshot = await readFilteredSnapshot(activeFile, filters, snapshotLimit);
            cursor = snapshot.cursor;
            writeSseEvent(res, "snapshot", {
              file: path.basename(activeFile),
              entries: snapshot.entries,
              reset: true,
            });
            return;
          }

          const update = await readSinceCursor(activeFile, cursor, filters);
          cursor = update.cursor;
          if (update.entries.length > 0 || update.reset) {
            writeSseEvent(res, "batch", {
              file: path.basename(activeFile),
              entries: update.entries,
              reset: update.reset,
            });
          }
        } catch (error: any) {
          writeSseEvent(res, "error", { message: error.message || "Log stream failed" });
        } finally {
          inFlight = false;
          if (queued) {
            queued = false;
            void sendIncrementalUpdate();
          }
        }
      };

      const snapshot = await readFilteredSnapshot(activeFile, filters, snapshotLimit);
      cursor = snapshot.cursor;

      writeSseEvent(res, "status", {
        connected: true,
        file: path.basename(activeFile),
        levels: filters.levels ? Array.from(filters.levels) : VALID_LEVELS,
        search: filters.search,
      });
      writeSseEvent(res, "snapshot", {
        file: path.basename(activeFile),
        entries: snapshot.entries,
        reset: true,
      });

      watcher = fs.watch(getLogDirectory(), { persistent: false }, (_eventType, filename) => {
        if (!filename || !LOG_FILE_RE.test(String(filename))) return;
        void sendIncrementalUpdate();
      });

      interval = setInterval(() => {
        void sendIncrementalUpdate();
      }, POLL_MS);

      heartbeat = setInterval(() => {
        writeSseEvent(res, "heartbeat", {
          time: new Date().toISOString(),
          file: path.basename(activeFile),
        });
      }, HEARTBEAT_MS);

      req.on("close", cleanup);
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Failed to start log stream" });
      } else {
        writeSseEvent(res, "error", { message: error.message || "Failed to start log stream" });
        cleanup();
      }
    }
  });

  return router;
}
