import { v4 as uuidv4 } from "uuid";
import {
  Stage, StageContext, QualityGateResult, NormalizedFact, NormalizedFactSchema, SupportedLocale
} from "../contracts";

interface NormalizerInput {
  facts: NormalizedFact[];
  locale: SupportedLocale;
}

interface NormalizerOutput {
  normalizedFacts: NormalizedFact[];
}

const LOCALE_CONFIGS: Record<SupportedLocale, {
  decimalSeparator: string;
  thousandsSeparator: string;
  currencySymbol: string;
  dateFormat: string;
}> = {
  es: { decimalSeparator: ",", thousandsSeparator: ".", currencySymbol: "€", dateFormat: "DD/MM/YYYY" },
  en: { decimalSeparator: ".", thousandsSeparator: ",", currencySymbol: "$", dateFormat: "MM/DD/YYYY" },
  pt: { decimalSeparator: ",", thousandsSeparator: ".", currencySymbol: "R$", dateFormat: "DD/MM/YYYY" },
  fr: { decimalSeparator: ",", thousandsSeparator: " ", currencySymbol: "€", dateFormat: "DD/MM/YYYY" },
  de: { decimalSeparator: ",", thousandsSeparator: ".", currencySymbol: "€", dateFormat: "DD.MM.YYYY" },
  it: { decimalSeparator: ",", thousandsSeparator: ".", currencySymbol: "€", dateFormat: "DD/MM/YYYY" },
  ar: { decimalSeparator: ".", thousandsSeparator: ",", currencySymbol: "ر.س", dateFormat: "YYYY/MM/DD" },
  hi: { decimalSeparator: ".", thousandsSeparator: ",", currencySymbol: "₹", dateFormat: "DD/MM/YYYY" },
  ja: { decimalSeparator: ".", thousandsSeparator: ",", currencySymbol: "¥", dateFormat: "YYYY/MM/DD" },
  ko: { decimalSeparator: ".", thousandsSeparator: ",", currencySymbol: "₩", dateFormat: "YYYY/MM/DD" },
  zh: { decimalSeparator: ".", thousandsSeparator: ",", currencySymbol: "¥", dateFormat: "YYYY/MM/DD" },
  ru: { decimalSeparator: ",", thousandsSeparator: " ", currencySymbol: "₽", dateFormat: "DD.MM.YYYY" },
  tr: { decimalSeparator: ",", thousandsSeparator: ".", currencySymbol: "₺", dateFormat: "DD.MM.YYYY" },
  id: { decimalSeparator: ",", thousandsSeparator: ".", currencySymbol: "Rp", dateFormat: "DD/MM/YYYY" },
};

const UNIT_ALIASES: Record<string, string> = {
  "%": "percent",
  "percent": "percent",
  "percentage": "percent",
  "porcentaje": "percent",
  "$": "USD",
  "usd": "USD",
  "dollars": "USD",
  "dólares": "USD",
  "€": "EUR",
  "eur": "EUR",
  "euros": "EUR",
  "£": "GBP",
  "gbp": "GBP",
  "millones": "million",
  "million": "million",
  "millions": "million",
  "miles": "thousand",
  "thousand": "thousand",
  "thousands": "thousand",
  "billion": "billion",
  "billones": "billion",
};

export class DataNormalizerStage implements Stage<NormalizerInput, NormalizerOutput> {
  id = "normalizer";
  name = "Data Normalizer";

  async execute(input: NormalizerInput, context: StageContext): Promise<NormalizerOutput> {
    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 0.1,
      message: `Normalizing ${input.facts.length} facts for locale ${input.locale}`,
    });

    const localeConfig = LOCALE_CONFIGS[input.locale] || LOCALE_CONFIGS.en;
    const normalizedFacts: NormalizedFact[] = [];
    const seenKeys = new Map<string, NormalizedFact>();

    for (let i = 0; i < input.facts.length; i++) {
      const fact = input.facts[i];
      
      context.emitEvent({
        eventType: "stage.progress",
        stageId: this.id,
        stageName: this.name,
        progress: 0.1 + (0.8 * (i + 1) / input.facts.length),
      });

      const normalizedFact = this.normalizeFact(fact, input.locale, localeConfig);

      const dedupeKey = this.getDedupeKey(normalizedFact);
      const existing = seenKeys.get(dedupeKey);
      
      if (existing) {
        if (normalizedFact.confidence > existing.confidence) {
          seenKeys.set(dedupeKey, normalizedFact);
        }
      } else {
        seenKeys.set(dedupeKey, normalizedFact);
      }
    }

    normalizedFacts.push(...seenKeys.values());

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 1.0,
      message: `Normalized to ${normalizedFacts.length} unique facts`,
    });

    return { normalizedFacts };
  }

  private normalizeFact(
    fact: NormalizedFact,
    locale: SupportedLocale,
    config: typeof LOCALE_CONFIGS["en"]
  ): NormalizedFact {
    let normalizedValue = fact.value;
    let normalizedUnit = fact.unit;

    if (typeof fact.value === "number") {
      normalizedValue = this.normalizeNumber(fact.value, fact.unit);
    } else if (typeof fact.value === "string") {
      const parsed = this.parseLocalizedNumber(fact.value, config);
      if (!isNaN(parsed)) {
        normalizedValue = parsed;
      }
    }

    if (normalizedUnit) {
      normalizedUnit = UNIT_ALIASES[normalizedUnit.toLowerCase()] || normalizedUnit;
    }

    const normalizedKey = this.normalizeKey(fact.key);

    return NormalizedFactSchema.parse({
      ...fact,
      id: fact.id || uuidv4(),
      key: normalizedKey,
      value: normalizedValue,
      unit: normalizedUnit,
      locale,
      provenance: {
        ...fact.provenance,
        validatedBy: [...(fact.provenance.validatedBy || []), "normalizer"],
      },
    });
  }

  private normalizeNumber(value: number, unit?: string): number {
    if (!unit) return value;
    
    const lowerUnit = unit.toLowerCase();
    
    if (lowerUnit === "million" || lowerUnit === "millones") {
      return value * 1_000_000;
    }
    if (lowerUnit === "billion" || lowerUnit === "billones") {
      return value * 1_000_000_000;
    }
    if (lowerUnit === "thousand" || lowerUnit === "miles" || lowerUnit === "k") {
      return value * 1_000;
    }
    
    return value;
  }

  private parseLocalizedNumber(
    value: string,
    config: typeof LOCALE_CONFIGS["en"]
  ): number {
    let normalized = value.trim();
    
    normalized = normalized.replace(new RegExp(`\\${config.thousandsSeparator}`, "g"), "");
    
    normalized = normalized.replace(config.decimalSeparator, ".");
    
    normalized = normalized.replace(/[^0-9.-]/g, "");
    
    return parseFloat(normalized);
  }

  private normalizeKey(key: string): string {
    return key
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  }

  private getDedupeKey(fact: NormalizedFact): string {
    const valueStr = typeof fact.value === "number" 
      ? fact.value.toFixed(4) 
      : String(fact.value);
    return `${fact.key}:${valueStr}:${fact.unit || ""}`;
  }

  validate(output: NormalizerOutput): QualityGateResult {
    const issues: QualityGateResult["issues"] = [];
    let score = 1.0;

    if (output.normalizedFacts.length === 0) {
      issues.push({ severity: "warning", message: "No facts to normalize" });
    }

    const withUnits = output.normalizedFacts.filter(f => f.unit);
    const withoutUnits = output.normalizedFacts.filter(f => !f.unit && typeof f.value === "number");
    
    if (withoutUnits.length > withUnits.length) {
      issues.push({ severity: "info", message: "Many numeric facts lack units" });
    }

    const lowConfidence = output.normalizedFacts.filter(f => f.confidence < 0.5);
    if (lowConfidence.length > output.normalizedFacts.length * 0.3) {
      issues.push({ severity: "warning", message: "Many facts have low confidence" });
      score -= 0.1;
    }

    return {
      gateId: "normalizer_quality",
      gateName: "Data Normalization Quality",
      passed: score >= 0.7,
      score: Math.max(0, score),
      threshold: 0.7,
      issues,
      checkedAt: new Date().toISOString(),
    };
  }

  async fallback(input: NormalizerInput, _context: StageContext): Promise<NormalizerOutput> {
    return { normalizedFacts: input.facts };
  }
}

export const dataNormalizerStage = new DataNormalizerStage();
