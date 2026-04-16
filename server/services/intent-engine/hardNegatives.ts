import { nanoid } from "nanoid";
import type { IntentType, SupportedLocale } from "../../../shared/schemas/intent";
import { logStructured } from "./telemetry";
import type { FeedbackSignal } from "./feedbackLoop";

export interface HardNegative {
  id: string;
  text: string;
  wrong_intent: IntentType;
  correct_intent: IntentType;
  locale: SupportedLocale;
  weight: number;
  occurrences: number;
  created_at: Date;
  last_seen_at: Date;
  embedding?: number[];
}

export interface ConfusionPair {
  intent_a: IntentType;
  intent_b: IntentType;
  count: number;
  examples: Array<{
    text: string;
    predicted: IntentType;
    actual: IntentType;
  }>;
  last_updated: Date;
}

interface ConfusionMatrix {
  matrix: Map<string, number>;
  examples: Map<string, Array<{ text: string; predicted: IntentType; actual: IntentType }>>;
}

const hardNegatives: Map<string, HardNegative> = new Map();
const confusionMatrix: ConfusionMatrix = {
  matrix: new Map(),
  examples: new Map()
};

const MAX_HARD_NEGATIVES = 5000;
const MAX_CONFUSION_EXAMPLES = 10;
const DEFAULT_BOOST_WEIGHT = 2.0;
const DECAY_FACTOR = 0.95;
const MIN_WEIGHT_THRESHOLD = 0.5;

function getConfusionKey(intentA: IntentType, intentB: IntentType): string {
  const sorted = [intentA, intentB].sort();
  return `${sorted[0]}::${sorted[1]}`;
}

export function addHardNegative(
  text: string,
  wrongIntent: IntentType,
  correctIntent: IntentType,
  locale: SupportedLocale = "en",
  embedding?: number[]
): HardNegative {
  const normalizedText = text.toLowerCase().trim();
  const existingId = findHardNegativeByText(normalizedText);

  if (existingId) {
    const existing = hardNegatives.get(existingId)!;
    existing.occurrences++;
    existing.weight = Math.min(existing.weight * 1.1, 5.0);
    existing.last_seen_at = new Date();
    if (embedding) existing.embedding = embedding;

    logStructured("info", "Hard negative reinforced", {
      id: existingId,
      occurrences: existing.occurrences,
      weight: existing.weight
    });

    return existing;
  }

  if (hardNegatives.size >= MAX_HARD_NEGATIVES) {
    pruneWeakHardNegatives();
  }

  const hardNegative: HardNegative = {
    id: nanoid(16),
    text: normalizedText,
    wrong_intent: wrongIntent,
    correct_intent: correctIntent,
    locale,
    weight: DEFAULT_BOOST_WEIGHT,
    occurrences: 1,
    created_at: new Date(),
    last_seen_at: new Date(),
    embedding
  };

  hardNegatives.set(hardNegative.id, hardNegative);

  updateConfusionMatrix(wrongIntent, correctIntent, normalizedText);

  logStructured("info", "Hard negative added", {
    id: hardNegative.id,
    wrong_intent: wrongIntent,
    correct_intent: correctIntent,
    text_preview: normalizedText.substring(0, 50)
  });

  return hardNegative;
}

function findHardNegativeByText(text: string): string | null {
  for (const [id, hn] of hardNegatives.entries()) {
    if (hn.text === text) return id;
  }
  return null;
}

function updateConfusionMatrix(
  predicted: IntentType,
  actual: IntentType,
  text: string
): void {
  if (predicted === actual) return;

  const key = getConfusionKey(predicted, actual);

  const currentCount = confusionMatrix.matrix.get(key) || 0;
  confusionMatrix.matrix.set(key, currentCount + 1);

  const examples = confusionMatrix.examples.get(key) || [];
  examples.push({ text, predicted, actual });

  if (examples.length > MAX_CONFUSION_EXAMPLES) {
    examples.shift();
  }

  confusionMatrix.examples.set(key, examples);
}

export function getConfusionPairs(minCount: number = 1): ConfusionPair[] {
  const pairs: ConfusionPair[] = [];

  for (const [key, count] of confusionMatrix.matrix.entries()) {
    if (count < minCount) continue;

    const [intentA, intentB] = key.split("::") as [IntentType, IntentType];
    const examples = confusionMatrix.examples.get(key) || [];

    pairs.push({
      intent_a: intentA,
      intent_b: intentB,
      count,
      examples,
      last_updated: examples.length > 0
        ? new Date()
        : new Date(0)
    });
  }

  return pairs.sort((a, b) => b.count - a.count);
}

export function getTopConfusionPairs(limit: number = 10): ConfusionPair[] {
  return getConfusionPairs().slice(0, limit);
}

export function getConfusionCountBetween(
  intentA: IntentType,
  intentB: IntentType
): number {
  const key = getConfusionKey(intentA, intentB);
  return confusionMatrix.matrix.get(key) || 0;
}

export function boostHardNegatives(factor: number = 1.5): {
  boosted_count: number;
  total_hard_negatives: number;
} {
  let boostedCount = 0;

  for (const hn of hardNegatives.values()) {
    const oldWeight = hn.weight;
    hn.weight = Math.min(hn.weight * factor, 5.0);
    if (hn.weight !== oldWeight) boostedCount++;
  }

  logStructured("info", "Hard negatives boosted", {
    boosted_count: boostedCount,
    factor
  });

  return {
    boosted_count: boostedCount,
    total_hard_negatives: hardNegatives.size
  };
}

export function decayHardNegativeWeights(): number {
  let decayedCount = 0;

  for (const [id, hn] of hardNegatives.entries()) {
    const daysSinceLastSeen = (Date.now() - hn.last_seen_at.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceLastSeen > 7) {
      hn.weight *= DECAY_FACTOR;
      decayedCount++;

      if (hn.weight < MIN_WEIGHT_THRESHOLD) {
        hardNegatives.delete(id);
      }
    }
  }

  logStructured("info", "Hard negative weights decayed", { decayed_count: decayedCount });

  return decayedCount;
}

function pruneWeakHardNegatives(): number {
  const sorted = Array.from(hardNegatives.entries())
    .sort((a, b) => a[1].weight - b[1].weight);

  const toRemove = Math.floor(sorted.length * 0.1);
  let removed = 0;

  for (let i = 0; i < toRemove && i < sorted.length; i++) {
    hardNegatives.delete(sorted[i][0]);
    removed++;
  }

  logStructured("info", "Pruned weak hard negatives", { removed });

  return removed;
}

export function getHardNegativeById(id: string): HardNegative | null {
  return hardNegatives.get(id) || null;
}

export function getHardNegatives(options?: {
  intent?: IntentType;
  locale?: SupportedLocale;
  minWeight?: number;
  limit?: number;
}): HardNegative[] {
  const result: HardNegative[] = [];

  for (const hn of hardNegatives.values()) {
    if (options?.intent && hn.correct_intent !== options.intent && hn.wrong_intent !== options.intent) {
      continue;
    }
    if (options?.locale && hn.locale !== options.locale) continue;
    if (options?.minWeight && hn.weight < options.minWeight) continue;

    result.push(hn);

    if (options?.limit && result.length >= options.limit) break;
  }

  return result.sort((a, b) => b.weight - a.weight);
}

export function getHardNegativesForIntent(
  intent: IntentType,
  limit: number = 50
): HardNegative[] {
  return getHardNegatives({ intent, limit });
}

export function processCorrectionsToHardNegatives(
  corrections: FeedbackSignal[]
): number {
  let added = 0;

  for (const correction of corrections) {
    if (
      correction.type === "correction" &&
      correction.corrected_intent &&
      correction.corrected_intent !== correction.original_intent
    ) {
      addHardNegative(
        correction.original_text,
        correction.original_intent,
        correction.corrected_intent,
        correction.locale
      );
      added++;
    }
  }

  logStructured("info", "Processed corrections to hard negatives", {
    total_corrections: corrections.length,
    hard_negatives_added: added
  });

  return added;
}

export function getHardNegativeStats(): {
  total_hard_negatives: number;
  by_intent: Record<IntentType, number>;
  by_locale: Record<string, number>;
  avg_weight: number;
  avg_occurrences: number;
  top_confusion_pairs: Array<{ pair: string; count: number }>;
} {
  const byIntent: Partial<Record<IntentType, number>> = {};
  const byLocale: Record<string, number> = {};
  let totalWeight = 0;
  let totalOccurrences = 0;

  for (const hn of hardNegatives.values()) {
    byIntent[hn.correct_intent] = (byIntent[hn.correct_intent] || 0) + 1;
    byLocale[hn.locale] = (byLocale[hn.locale] || 0) + 1;
    totalWeight += hn.weight;
    totalOccurrences += hn.occurrences;
  }

  const topPairs = getTopConfusionPairs(5).map((p) => ({
    pair: `${p.intent_a} <-> ${p.intent_b}`,
    count: p.count
  }));

  const size = hardNegatives.size || 1;

  return {
    total_hard_negatives: hardNegatives.size,
    by_intent: byIntent as Record<IntentType, number>,
    by_locale: byLocale,
    avg_weight: totalWeight / size,
    avg_occurrences: totalOccurrences / size,
    top_confusion_pairs: topPairs
  };
}

export function clearHardNegatives(): void {
  hardNegatives.clear();
  confusionMatrix.matrix.clear();
  confusionMatrix.examples.clear();
  logStructured("info", "Hard negatives store cleared", {});
}

export function exportHardNegatives(): HardNegative[] {
  return Array.from(hardNegatives.values());
}

export function importHardNegatives(data: HardNegative[]): number {
  let imported = 0;

  for (const hn of data) {
    if (!hardNegatives.has(hn.id)) {
      hardNegatives.set(hn.id, {
        ...hn,
        created_at: new Date(hn.created_at),
        last_seen_at: new Date(hn.last_seen_at)
      });
      imported++;

      updateConfusionMatrix(hn.wrong_intent, hn.correct_intent, hn.text);
    }
  }

  logStructured("info", "Hard negatives imported", { imported });

  return imported;
}

export function getEmbeddingsForBoosting(): Array<{
  text: string;
  intent: IntentType;
  weight: number;
  embedding?: number[];
}> {
  const result: Array<{
    text: string;
    intent: IntentType;
    weight: number;
    embedding?: number[];
  }> = [];

  for (const hn of hardNegatives.values()) {
    result.push({
      text: hn.text,
      intent: hn.correct_intent,
      weight: hn.weight,
      embedding: hn.embedding
    });
  }

  return result.sort((a, b) => b.weight - a.weight);
}
