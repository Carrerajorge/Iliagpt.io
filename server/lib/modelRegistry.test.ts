import { describe, it, expect } from "vitest";
import {
  XAI_MODELS,
  GEMINI_MODELS_REGISTRY,
  DEFAULT_XAI_TEXT_MODEL,
  DEFAULT_XAI_REASONING_MODEL,
  DEFAULT_XAI_VISION_MODEL,
  DEFAULT_GEMINI_TEXT_MODEL,
  DEFAULT_GEMINI_REASONING_MODEL,
  DEFAULT_GEMINI_VISION_MODEL,
  DEFAULT_PROVIDER,
  DEFAULT_TEXT_MODEL,
  DEFAULT_REASONING_MODEL,
  DEFAULT_VISION_MODEL,
  KNOWN_XAI_MODEL_IDS,
  KNOWN_GEMINI_MODEL_IDS,
  FALLBACK_CHAINS,
  MODEL_PRICING_REGISTRY,
} from "./modelRegistry";
import type { ModelPricingEntry } from "./modelRegistry";

// ---------------------------------------------------------------------------
// XAI_MODELS constants
// ---------------------------------------------------------------------------
describe("XAI_MODELS", () => {
  it("contains all expected Grok 4.1 models", () => {
    expect(XAI_MODELS.GROK_4_1_FAST).toBe("grok-4-1-fast-non-reasoning");
    expect(XAI_MODELS.GROK_4_1_FAST_REASONING).toBe("grok-4-1-fast-reasoning");
  });

  it("contains all expected Grok 4 models", () => {
    expect(XAI_MODELS.GROK_4_FAST).toBe("grok-4-fast-non-reasoning");
    expect(XAI_MODELS.GROK_4_FAST_REASONING).toBe("grok-4-fast-reasoning");
    expect(XAI_MODELS.GROK_4_PREMIUM).toBe("grok-4-0709");
    expect(XAI_MODELS.GROK_CODE).toBe("grok-code-fast-1");
  });

  it("contains all expected Grok 3 models", () => {
    expect(XAI_MODELS.GROK_3).toBe("grok-3");
    expect(XAI_MODELS.GROK_3_FAST).toBe("grok-3-fast");
    expect(XAI_MODELS.GROK_3_MINI).toBe("grok-3-mini");
    expect(XAI_MODELS.GROK_3_MINI_FAST).toBe("grok-3-mini-fast");
  });

  it("contains legacy Grok 2 vision model", () => {
    expect(XAI_MODELS.GROK_2_VISION).toBe("grok-2-vision-1212");
  });
});

// ---------------------------------------------------------------------------
// GEMINI_MODELS_REGISTRY constants
// ---------------------------------------------------------------------------
describe("GEMINI_MODELS_REGISTRY", () => {
  it("contains the expected Gemini model IDs", () => {
    expect(GEMINI_MODELS_REGISTRY.FLASH_PREVIEW).toBe("gemini-3-flash-preview");
    expect(GEMINI_MODELS_REGISTRY.FLASH_25).toBe("gemini-2.5-flash");
    expect(GEMINI_MODELS_REGISTRY.PRO_25).toBe("gemini-2.5-pro");
    expect(GEMINI_MODELS_REGISTRY.FLASH_20).toBe("gemini-2.0-flash");
    expect(GEMINI_MODELS_REGISTRY.PRO_31).toBe("gemini-3.1-pro");
    expect(GEMINI_MODELS_REGISTRY.FLASH_31).toBe("gemini-3.1-flash");
  });
});

// ---------------------------------------------------------------------------
// Default exports
// ---------------------------------------------------------------------------
describe("Default model constants", () => {
  it("sets default xAI text model to Grok 4.1 fast", () => {
    expect(DEFAULT_XAI_TEXT_MODEL).toBe(XAI_MODELS.GROK_4_1_FAST);
  });

  it("sets default xAI reasoning model to Grok 4.1 fast reasoning", () => {
    expect(DEFAULT_XAI_REASONING_MODEL).toBe(XAI_MODELS.GROK_4_1_FAST_REASONING);
  });

  it("sets default xAI vision model to Grok 2 Vision", () => {
    expect(DEFAULT_XAI_VISION_MODEL).toBe(XAI_MODELS.GROK_2_VISION);
  });

  it("sets default Gemini text model to Pro 3.1", () => {
    expect(DEFAULT_GEMINI_TEXT_MODEL).toBe(GEMINI_MODELS_REGISTRY.PRO_31);
  });

  it("sets default Gemini reasoning model to Pro 3.1", () => {
    expect(DEFAULT_GEMINI_REASONING_MODEL).toBe(GEMINI_MODELS_REGISTRY.PRO_31);
  });

  it("sets default Gemini vision model to Flash 3.1", () => {
    expect(DEFAULT_GEMINI_VISION_MODEL).toBe(GEMINI_MODELS_REGISTRY.FLASH_31);
  });
  
  it("has gemini as default provider", () => {
    expect(DEFAULT_PROVIDER).toBe("gemini");
  });

  it("app-level defaults point to Gemini models", () => {
    expect(DEFAULT_TEXT_MODEL).toBe(DEFAULT_GEMINI_TEXT_MODEL);
    expect(DEFAULT_REASONING_MODEL).toBe(DEFAULT_GEMINI_REASONING_MODEL);
    expect(DEFAULT_VISION_MODEL).toBe(DEFAULT_GEMINI_VISION_MODEL);
  });
});

// ---------------------------------------------------------------------------
// KNOWN model ID sets
// ---------------------------------------------------------------------------
describe("KNOWN_XAI_MODEL_IDS", () => {
  it("is a Set that contains all XAI model values (lowercased)", () => {
    const allXaiValues = Object.values(XAI_MODELS);
    for (const modelId of allXaiValues) {
      expect(KNOWN_XAI_MODEL_IDS.has(modelId.toLowerCase())).toBe(true);
    }
  });

  it("does not contain Gemini model IDs", () => {
    expect(KNOWN_XAI_MODEL_IDS.has("gemini-2.5-flash")).toBe(false);
  });

  it("has the correct size matching XAI_MODELS values", () => {
    const uniqueXai = new Set(Object.values(XAI_MODELS).map((v) => v.toLowerCase()));
    expect(KNOWN_XAI_MODEL_IDS.size).toBe(uniqueXai.size);
  });
});

describe("KNOWN_GEMINI_MODEL_IDS", () => {
  it("contains all GEMINI_MODELS_REGISTRY values (lowercased)", () => {
    const allGemini = Object.values(GEMINI_MODELS_REGISTRY);
    for (const modelId of allGemini) {
      expect(KNOWN_GEMINI_MODEL_IDS.has(modelId.toLowerCase())).toBe(true);
    }
  });

  it("includes legacy Gemini IDs", () => {
    expect(KNOWN_GEMINI_MODEL_IDS.has("gemini-1.5-flash")).toBe(true);
    expect(KNOWN_GEMINI_MODEL_IDS.has("gemini-1.5-pro")).toBe(true);
    expect(KNOWN_GEMINI_MODEL_IDS.has("gemini-2.0-pro")).toBe(true);
  });

  it("does not contain xAI model IDs", () => {
    expect(KNOWN_GEMINI_MODEL_IDS.has("grok-3")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FALLBACK_CHAINS
// ---------------------------------------------------------------------------
describe("FALLBACK_CHAINS", () => {
  it("has fallback chain for Grok 4.1 fast", () => {
    const chain = FALLBACK_CHAINS[XAI_MODELS.GROK_4_1_FAST];
    expect(chain).toBeDefined();
    expect(chain).toContain(XAI_MODELS.GROK_4_FAST);
    expect(chain).toContain(XAI_MODELS.GROK_3_FAST);
  });

  it("has fallback chain for Gemini Pro 3.1", () => {
    const chain = FALLBACK_CHAINS[GEMINI_MODELS_REGISTRY.PRO_31];
    expect(chain).toBeDefined();
    expect(chain).toContain(GEMINI_MODELS_REGISTRY.FLASH_31);
    expect(chain).toContain(GEMINI_MODELS_REGISTRY.PRO_25);
  });

  it("all fallback chains reference models from the registry constants", () => {
    const allModelIds = new Set([
      ...Object.values(XAI_MODELS),
      ...Object.values(GEMINI_MODELS_REGISTRY),
    ]);

    for (const [primary, fallbacks] of Object.entries(FALLBACK_CHAINS)) {
      expect(allModelIds.has(primary)).toBe(true);
      for (const fb of fallbacks) {
        expect(allModelIds.has(fb)).toBe(true);
      }
    }
  });

  it("returns undefined for a model without a fallback chain", () => {
    expect(FALLBACK_CHAINS["nonexistent-model"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MODEL_PRICING_REGISTRY
// ---------------------------------------------------------------------------
describe("MODEL_PRICING_REGISTRY", () => {
  it("has pricing for every model in XAI_MODELS", () => {
    for (const modelId of Object.values(XAI_MODELS)) {
      const entry = MODEL_PRICING_REGISTRY[modelId];
      expect(entry).toBeDefined();
      expect(entry.inputPerMillion).toBeGreaterThan(0);
      expect(entry.outputPerMillion).toBeGreaterThan(0);
    }
  });

  it("has pricing for every model in GEMINI_MODELS_REGISTRY", () => {
    for (const modelId of Object.values(GEMINI_MODELS_REGISTRY)) {
      const entry = MODEL_PRICING_REGISTRY[modelId];
      expect(entry).toBeDefined();
      expect(entry.inputPerMillion).toBeGreaterThan(0);
      expect(entry.outputPerMillion).toBeGreaterThan(0);
    }
  });

  it("output price is always >= input price", () => {
    for (const [modelId, pricing] of Object.entries(MODEL_PRICING_REGISTRY)) {
      expect(pricing.outputPerMillion).toBeGreaterThanOrEqual(pricing.inputPerMillion);
    }
  });

  it("Gemini Flash models are cheaper than Gemini Pro", () => {
    const flash = MODEL_PRICING_REGISTRY[GEMINI_MODELS_REGISTRY.FLASH_31];
    const pro = MODEL_PRICING_REGISTRY[GEMINI_MODELS_REGISTRY.PRO_31];
    expect(flash.inputPerMillion).toBeLessThan(pro.inputPerMillion);
    expect(flash.outputPerMillion).toBeLessThan(pro.outputPerMillion);
  });

  it("returns undefined for unknown model pricing", () => {
    expect(MODEL_PRICING_REGISTRY["nonexistent"]).toBeUndefined();
  });
});
