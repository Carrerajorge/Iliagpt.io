import { err, ok } from "../../shared/result";
import type { Result } from "../../shared/result";
import {
  createClientErrorLog,
  type ClientErrorLogInput,
  type ClientErrorLogValidationError,
  type ClientErrorLog,
} from "../domain/clientErrorLog";
import type { ClientErrorLogStore } from "./clientErrorLogStore";

export type LogClientErrorOutput = Readonly<{ errorId: string }>;
export type LogClientErrorResult = Result<LogClientErrorOutput, ClientErrorLogValidationError>;

export async function logClientError(
  store: ClientErrorLogStore,
  input: ClientErrorLogInput,
): Promise<LogClientErrorResult> {
  const created = createClientErrorLog(input);
  if (!created.ok) {
    return err(created.error);
  }

  await store.append(created.value);
  return ok({ errorId: created.value.errorId });
}

export type RecentClientErrorsOutput = Readonly<{
  errors: readonly ClientErrorLog[];
  total: number;
  components: readonly string[];
}>;

export async function getRecentClientErrors(
  store: ClientErrorLogStore,
  options: { limit: number; componentName?: string },
): Promise<RecentClientErrorsOutput> {
  const errors = await store.recent(options);
  const all = await store.all();
  const components = Array.from(new Set(all.map((e) => e.componentName).filter(Boolean))) as string[];

  return {
    errors,
    total: all.length,
    components,
  };
}

export type ClientErrorStatsOutput = Readonly<{
  total: number;
  last24Hours: number;
  lastWeek: number;
  byComponent: Record<string, number>;
  topErrors: Array<{ message: string; count: number }>;
  healthScore: number;
}>;

export async function getClientErrorStats(store: ClientErrorLogStore): Promise<ClientErrorStatsOutput> {
  const all = await store.all();
  const now = Date.now();
  const last24h = now - 24 * 60 * 60 * 1000;
  const lastWeek = now - 7 * 24 * 60 * 60 * 1000;

  const errors24h = all.filter((e) => Date.parse(e.timestampIso) > last24h).length;
  const errorsWeek = all.filter((e) => Date.parse(e.timestampIso) > lastWeek).length;

  const byComponent: Record<string, number> = {};
  for (const e of all) {
    const name = e.componentName || "Unknown";
    byComponent[name] = (byComponent[name] || 0) + 1;
  }

  const byMessage: Record<string, number> = {};
  for (const e of all) {
    const msg = e.message.slice(0, 100);
    byMessage[msg] = (byMessage[msg] || 0) + 1;
  }

  const topErrors = Object.entries(byMessage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([message, count]) => ({ message, count }));

  return {
    total: all.length,
    last24Hours: errors24h,
    lastWeek: errorsWeek,
    byComponent,
    topErrors,
    healthScore: calculateHealthScore(errors24h),
  };
}

function calculateHealthScore(errorsIn24h: number): number {
  if (errorsIn24h === 0) return 100;
  if (errorsIn24h < 5) return 90;
  if (errorsIn24h < 20) return 75;
  if (errorsIn24h < 50) return 50;
  if (errorsIn24h < 100) return 25;
  return 10;
}
