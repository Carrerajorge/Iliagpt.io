import { nanoid } from "nanoid";
import type { IntentType, SupportedLocale } from "../../../shared/schemas/intent";
import { logStructured } from "./telemetry";
import type { FeedbackSignal } from "./feedbackLoop";

export interface AliasCandidate {
  id: string;
  intent: IntentType;
  alias: string;
  locale: SupportedLocale;
  frequency: number;
  confidence: number;
  status: "pending" | "confirmed" | "rejected";
  created_at: Date;
  last_used_at: Date;
  confirmed_at?: Date;
  source_feedback_ids: string[];
}

export interface ConfirmedAlias {
  intent: IntentType;
  alias: string;
  locale: SupportedLocale;
  frequency: number;
  confidence: number;
}

const aliasCandidates: Map<string, AliasCandidate> = new Map();
const confirmedAliases: Map<string, ConfirmedAlias[]> = new Map();

const MAX_CANDIDATES = 2000;
const MIN_FREQUENCY_FOR_AUTO_CONFIRM = 3;
const MIN_CONFIDENCE_THRESHOLD = 0.7;
const STALE_DAYS_THRESHOLD = 30;
const PRUNE_CONFIDENCE_THRESHOLD = 0.3;

function getAliasKey(intent: IntentType, alias: string, locale: SupportedLocale): string {
  return `${intent}::${locale}::${alias.toLowerCase().trim()}`;
}

function getConfirmedKey(intent: IntentType, locale: SupportedLocale): string {
  return `${intent}::${locale}`;
}

export function proposeNewAlias(
  intent: IntentType,
  alias: string,
  locale: SupportedLocale,
  feedbackId?: string,
  initialConfidence: number = 0.5
): AliasCandidate {
  const normalizedAlias = alias.toLowerCase().trim();
  const key = getAliasKey(intent, normalizedAlias, locale);

  const existing = findCandidateByKey(key);
  if (existing) {
    existing.frequency++;
    existing.confidence = calculateUpdatedConfidence(existing);
    existing.last_used_at = new Date();
    if (feedbackId) {
      existing.source_feedback_ids.push(feedbackId);
    }

    if (
      existing.status === "pending" &&
      existing.frequency >= MIN_FREQUENCY_FOR_AUTO_CONFIRM &&
      existing.confidence >= MIN_CONFIDENCE_THRESHOLD
    ) {
      confirmAliasInternal(existing);
    }

    logStructured("info", "Alias candidate reinforced", {
      id: existing.id,
      intent,
      alias: normalizedAlias,
      frequency: existing.frequency,
      confidence: existing.confidence
    });

    return existing;
  }

  if (aliasCandidates.size >= MAX_CANDIDATES) {
    pruneLowestConfidenceCandidates();
  }

  const candidate: AliasCandidate = {
    id: nanoid(16),
    intent,
    alias: normalizedAlias,
    locale,
    frequency: 1,
    confidence: initialConfidence,
    status: "pending",
    created_at: new Date(),
    last_used_at: new Date(),
    source_feedback_ids: feedbackId ? [feedbackId] : []
  };

  aliasCandidates.set(candidate.id, candidate);

  logStructured("info", "New alias candidate proposed", {
    id: candidate.id,
    intent,
    alias: normalizedAlias,
    locale
  });

  return candidate;
}

function findCandidateByKey(key: string): AliasCandidate | null {
  for (const candidate of aliasCandidates.values()) {
    const candidateKey = getAliasKey(candidate.intent, candidate.alias, candidate.locale);
    if (candidateKey === key) return candidate;
  }
  return null;
}

function calculateUpdatedConfidence(candidate: AliasCandidate): number {
  const frequencyBoost = Math.min(candidate.frequency * 0.1, 0.3);
  const recencyBoost = calculateRecencyBoost(candidate.last_used_at);
  return Math.min(candidate.confidence + frequencyBoost + recencyBoost, 1.0);
}

function calculateRecencyBoost(lastUsed: Date): number {
  const daysSinceLastUse = (Date.now() - lastUsed.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceLastUse < 1) return 0.1;
  if (daysSinceLastUse < 7) return 0.05;
  return 0;
}

function confirmAliasInternal(candidate: AliasCandidate): void {
  candidate.status = "confirmed";
  candidate.confirmed_at = new Date();

  const confirmedKey = getConfirmedKey(candidate.intent, candidate.locale);
  const existing = confirmedAliases.get(confirmedKey) || [];

  const alreadyConfirmed = existing.some((a) => a.alias === candidate.alias);
  if (!alreadyConfirmed) {
    existing.push({
      intent: candidate.intent,
      alias: candidate.alias,
      locale: candidate.locale,
      frequency: candidate.frequency,
      confidence: candidate.confidence
    });
    confirmedAliases.set(confirmedKey, existing);

    logStructured("info", "Alias confirmed", {
      id: candidate.id,
      intent: candidate.intent,
      alias: candidate.alias,
      locale: candidate.locale
    });
  }
}

export function confirmAlias(aliasId: string): boolean {
  const candidate = aliasCandidates.get(aliasId);
  if (!candidate || candidate.status !== "pending") {
    return false;
  }

  confirmAliasInternal(candidate);
  return true;
}

export function rejectAlias(aliasId: string): boolean {
  const candidate = aliasCandidates.get(aliasId);
  if (!candidate || candidate.status !== "pending") {
    return false;
  }

  candidate.status = "rejected";
  logStructured("info", "Alias rejected", {
    id: aliasId,
    intent: candidate.intent,
    alias: candidate.alias
  });

  return true;
}

export function getAliasCandidates(options?: {
  intent?: IntentType;
  locale?: SupportedLocale;
  status?: "pending" | "confirmed" | "rejected";
  minConfidence?: number;
  limit?: number;
}): AliasCandidate[] {
  const result: AliasCandidate[] = [];

  for (const candidate of aliasCandidates.values()) {
    if (options?.intent && candidate.intent !== options.intent) continue;
    if (options?.locale && candidate.locale !== options.locale) continue;
    if (options?.status && candidate.status !== options.status) continue;
    if (options?.minConfidence && candidate.confidence < options.minConfidence) continue;

    result.push(candidate);

    if (options?.limit && result.length >= options.limit) break;
  }

  return result.sort((a, b) => b.confidence - a.confidence);
}

export function getPendingCandidates(limit: number = 50): AliasCandidate[] {
  return getAliasCandidates({ status: "pending", limit });
}

export function getConfirmedAliasesForIntent(
  intent: IntentType,
  locale?: SupportedLocale
): ConfirmedAlias[] {
  if (locale) {
    return confirmedAliases.get(getConfirmedKey(intent, locale)) || [];
  }

  const allAliases: ConfirmedAlias[] = [];
  for (const [key, aliases] of confirmedAliases.entries()) {
    if (key.startsWith(`${intent}::`)) {
      allAliases.push(...aliases);
    }
  }
  return allAliases;
}

export function getAllConfirmedAliases(): Map<string, ConfirmedAlias[]> {
  return new Map(confirmedAliases);
}

export function pruneStaleAliases(): {
  pruned_pending: number;
  pruned_rejected: number;
  pruned_low_confidence: number;
} {
  const now = Date.now();
  const staleThreshold = STALE_DAYS_THRESHOLD * 24 * 60 * 60 * 1000;

  let prunedPending = 0;
  let prunedRejected = 0;
  let prunedLowConfidence = 0;

  for (const [id, candidate] of aliasCandidates.entries()) {
    const age = now - candidate.last_used_at.getTime();

    if (candidate.status === "rejected") {
      aliasCandidates.delete(id);
      prunedRejected++;
      continue;
    }

    if (candidate.status === "pending" && age > staleThreshold) {
      aliasCandidates.delete(id);
      prunedPending++;
      continue;
    }

    if (candidate.confidence < PRUNE_CONFIDENCE_THRESHOLD && age > staleThreshold / 2) {
      aliasCandidates.delete(id);
      prunedLowConfidence++;
    }
  }

  logStructured("info", "Pruned stale aliases", {
    pruned_pending: prunedPending,
    pruned_rejected: prunedRejected,
    pruned_low_confidence: prunedLowConfidence
  });

  return {
    pruned_pending: prunedPending,
    pruned_rejected: prunedRejected,
    pruned_low_confidence: prunedLowConfidence
  };
}

function pruneLowestConfidenceCandidates(): number {
  const sorted = Array.from(aliasCandidates.entries())
    .filter(([, c]) => c.status === "pending")
    .sort((a, b) => a[1].confidence - b[1].confidence);

  const toRemove = Math.floor(sorted.length * 0.1);
  let removed = 0;

  for (let i = 0; i < toRemove && i < sorted.length; i++) {
    aliasCandidates.delete(sorted[i][0]);
    removed++;
  }

  return removed;
}

export function extractAliasFromCorrection(feedback: FeedbackSignal): string | null {
  if (feedback.type !== "correction" || !feedback.corrected_intent) {
    return null;
  }

  const text = feedback.original_text.toLowerCase().trim();

  const words = text.split(/\s+/);
  if (words.length <= 5) {
    return text;
  }

  const keyPatterns = [
    /(?:crear|create|make|generar|hacer)\s+(?:un[ao]?\s+)?(\w+)/i,
    /(?:quiero|want|necesito|need)\s+(?:un[ao]?\s+)?(\w+)/i,
    /^(\w+)\s+(?:de|about|sobre|on)/i
  ];

  for (const pattern of keyPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return words.slice(0, 3).join(" ");
}

export function processCorrectionsToAliases(corrections: FeedbackSignal[]): number {
  let proposed = 0;

  for (const correction of corrections) {
    if (correction.type !== "correction" || !correction.corrected_intent) {
      continue;
    }

    const alias = extractAliasFromCorrection(correction);
    if (alias && alias.length >= 2) {
      proposeNewAlias(
        correction.corrected_intent,
        alias,
        correction.locale,
        correction.id
      );
      proposed++;
    }
  }

  logStructured("info", "Processed corrections to alias candidates", {
    total_corrections: corrections.length,
    aliases_proposed: proposed
  });

  return proposed;
}

export function processRephrasesToAliases(rephrases: FeedbackSignal[]): number {
  let proposed = 0;

  for (const rephrase of rephrases) {
    if (rephrase.type !== "rephrase" || !rephrase.rephrased_text) {
      continue;
    }

    const rephrased = rephrase.rephrased_text.toLowerCase().trim();
    if (rephrased.length >= 3 && rephrased.length <= 100) {
      proposeNewAlias(
        rephrase.original_intent,
        rephrased,
        rephrase.locale,
        rephrase.id,
        0.6
      );
      proposed++;
    }
  }

  logStructured("info", "Processed rephrases to alias candidates", {
    total_rephrases: rephrases.length,
    aliases_proposed: proposed
  });

  return proposed;
}

export function getAliasStats(): {
  total_candidates: number;
  pending: number;
  confirmed: number;
  rejected: number;
  by_intent: Record<IntentType, number>;
  by_locale: Record<string, number>;
  avg_confidence: number;
  avg_frequency: number;
} {
  const byIntent: Partial<Record<IntentType, number>> = {};
  const byLocale: Record<string, number> = {};
  let pending = 0;
  let confirmed = 0;
  let rejected = 0;
  let totalConfidence = 0;
  let totalFrequency = 0;

  for (const candidate of aliasCandidates.values()) {
    byIntent[candidate.intent] = (byIntent[candidate.intent] || 0) + 1;
    byLocale[candidate.locale] = (byLocale[candidate.locale] || 0) + 1;
    totalConfidence += candidate.confidence;
    totalFrequency += candidate.frequency;

    switch (candidate.status) {
      case "pending":
        pending++;
        break;
      case "confirmed":
        confirmed++;
        break;
      case "rejected":
        rejected++;
        break;
    }
  }

  const size = aliasCandidates.size || 1;

  return {
    total_candidates: aliasCandidates.size,
    pending,
    confirmed,
    rejected,
    by_intent: byIntent as Record<IntentType, number>,
    by_locale: byLocale,
    avg_confidence: totalConfidence / size,
    avg_frequency: totalFrequency / size
  };
}

export function clearAliasStore(): void {
  aliasCandidates.clear();
  confirmedAliases.clear();
  logStructured("info", "Alias store cleared", {});
}

export function exportAliasCandidates(): AliasCandidate[] {
  return Array.from(aliasCandidates.values());
}

export function exportConfirmedAliases(): Array<{
  key: string;
  aliases: ConfirmedAlias[];
}> {
  return Array.from(confirmedAliases.entries()).map(([key, aliases]) => ({
    key,
    aliases
  }));
}

export function importAliasCandidates(data: AliasCandidate[]): number {
  let imported = 0;

  for (const candidate of data) {
    if (!aliasCandidates.has(candidate.id)) {
      aliasCandidates.set(candidate.id, {
        ...candidate,
        created_at: new Date(candidate.created_at),
        last_used_at: new Date(candidate.last_used_at),
        confirmed_at: candidate.confirmed_at ? new Date(candidate.confirmed_at) : undefined
      });
      imported++;

      if (candidate.status === "confirmed") {
        const confirmedKey = getConfirmedKey(candidate.intent, candidate.locale);
        const existing = confirmedAliases.get(confirmedKey) || [];
        if (!existing.some((a) => a.alias === candidate.alias)) {
          existing.push({
            intent: candidate.intent,
            alias: candidate.alias,
            locale: candidate.locale,
            frequency: candidate.frequency,
            confidence: candidate.confidence
          });
          confirmedAliases.set(confirmedKey, existing);
        }
      }
    }
  }

  logStructured("info", "Alias candidates imported", { imported });

  return imported;
}
