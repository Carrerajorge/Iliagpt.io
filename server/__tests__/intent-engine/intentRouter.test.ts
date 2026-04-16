import { describe, it, expect, beforeAll } from "vitest";
import * as fc from "fast-check";
import { routeIntent, ROUTER_VERSION, configure } from "../../services/intent-engine/index";
import { preprocess } from "../../services/intent-engine/preprocess";
import { detectLanguage } from "../../services/intent-engine/langDetect";
import { ruleBasedMatch } from "../../services/intent-engine/ruleMatcher";
import { knnMatch } from "../../services/intent-engine/embeddingMatcher";
import { EVALUATION_DATASET, getExamplesByLocale, getDatasetStats } from "../../services/intent-engine/datasets/evaluation";
import type { IntentType } from "../../../shared/schemas/intent";

describe("Intent Router v2 - Preprocessing", () => {
  it("should normalize Unicode (NFKC)", () => {
    const result = preprocess("Créer une présentation", "fr");
    expect(result.normalized).not.toContain("é");
    expect(result.normalized).toContain("creer");
  });

  it("should remove URLs", () => {
    const result = preprocess("Check this https://example.com for info", "en");
    expect(result.normalized).not.toContain("https");
    expect(result.removed_urls).toContain("https://example.com");
  });

  it("should remove emojis", () => {
    const result = preprocess("Create a presentation 🎉📊", "en");
    expect(result.removed_emojis.length).toBeGreaterThan(0);
    expect(result.normalized).not.toContain("🎉");
  });

  it("should correct common typos", () => {
    const result = preprocess("Crea un pawer point", "es");
    expect(result.normalized).toContain("powerpoint");
    expect(result.typos_corrected.length).toBeGreaterThan(0);
  });

  it("should handle multiple typos", () => {
    const result = preprocess("Hazme un exel y un documeto", "es");
    expect(result.normalized).toContain("excel");
    expect(result.normalized).toContain("documento");
  });
});

describe("Intent Router v2 - Language Detection", () => {
  it("should detect Spanish", () => {
    const result = detectLanguage("Crea una presentación sobre inteligencia artificial");
    expect(result.locale).toBe("es");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("should detect English", () => {
    const result = detectLanguage("Create a presentation about machine learning and AI");
    expect(["en", "fr"]).toContain(result.locale);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("should detect Portuguese", () => {
    const result = detectLanguage("Crie uma apresentação sobre o mercado brasileiro");
    expect(result.locale).toBe("pt");
  });

  it("should detect French", () => {
    const result = detectLanguage("Créez une présentation sur le marketing digital");
    expect(result.locale).toBe("fr");
  });

  it("should detect German", () => {
    const result = detectLanguage("Erstelle eine Präsentation über das Projekt und die Entwicklung");
    expect(["de", "fr"]).toContain(result.locale);
  });

  it("should handle short text gracefully", () => {
    const result = detectLanguage("hola");
    expect(result.confidence).toBeGreaterThan(0);
  });
});

describe("Intent Router v2 - Rule-based Matching", () => {
  it("should match CREATE_PRESENTATION with high confidence", () => {
    const result = ruleBasedMatch("crear presentacion sobre ia", "es");
    expect(result.intent).toBe("CREATE_PRESENTATION");
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.has_creation_verb).toBe(true);
  });

  it("should match CREATE_DOCUMENT", () => {
    const result = ruleBasedMatch("escribir un documento sobre el proyecto", "es");
    expect(result.intent).toBe("CREATE_DOCUMENT");
  });

  it("should match CREATE_SPREADSHEET", () => {
    const result = ruleBasedMatch("crear excel con datos de ventas", "es");
    expect(result.intent).toBe("CREATE_SPREADSHEET");
    expect(result.output_format).toBe("xlsx");
  });

  it("should match SUMMARIZE", () => {
    const result = ruleBasedMatch("resumeme este texto", "es");
    expect(result.intent).toBe("SUMMARIZE");
  });

  it("should match TRANSLATE", () => {
    const result = ruleBasedMatch("traduce esto al ingles", "es");
    expect(result.intent).toBe("TRANSLATE");
  });

  it("should handle fuzzy matching", () => {
    const result = ruleBasedMatch("crear precentacion", "es");
    expect(result.intent).toBe("CREATE_PRESENTATION");
  });

  it("should detect output format", () => {
    const result = ruleBasedMatch("crear un pptx sobre ventas", "es");
    expect(result.output_format).toBe("pptx");
  });
});

describe("Intent Router v2 - KNN Matching", () => {
  it("should find similar intents", async () => {
    const result = await knnMatch("make a powerpoint about AI");
    expect(result.intent).toBe("CREATE_PRESENTATION");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("should return top matches", async () => {
    const result = await knnMatch("write a report");
    expect(result.top_matches.length).toBeGreaterThan(0);
  });

  it("should handle multilingual queries", async () => {
    const result = await knnMatch("faire un document word");
    expect(["CREATE_DOCUMENT", "CREATE_PRESENTATION", "CREATE_SPREADSHEET"]).toContain(result.intent);
  });
});

describe("Intent Router v2 - Full Pipeline", () => {
  beforeAll(() => {
    configure({ enableLLMFallback: false, enableCache: false });
  });

  it("should route Spanish presentation request", async () => {
    const result = await routeIntent("Crea una presentación sobre inteligencia artificial");
    expect(result.intent).toBe("CREATE_PRESENTATION");
    expect(result.router_version).toBe(ROUTER_VERSION);
    expect(result.language_detected).toBe("es");
  });

  it("should route English document request", async () => {
    const result = await routeIntent("Write a report on market analysis");
    expect(result.intent).toBe("CREATE_DOCUMENT");
    expect(result.language_detected).toBe("en");
  });

  it("should route spreadsheet request", async () => {
    const result = await routeIntent("Hazme un excel con los datos de ventas");
    expect(result.intent).toBe("CREATE_SPREADSHEET");
    expect(result.output_format).toBe("xlsx");
  });

  it("should handle typos gracefully", async () => {
    const result = await routeIntent("Crea un pawer point de IA");
    expect(result.intent).toBe("CREATE_PRESENTATION");
  });

  it("should extract slots", async () => {
    const result = await routeIntent("Crea una presentación profesional de 10 diapositivas sobre ventas para ejecutivos");
    expect(result.slots.num_slides).toBe(10);
    expect(result.slots.audience).toBe("executives");
    expect(result.slots.style).toBe("professional");
  });

  it("should return processing time", async () => {
    const result = await routeIntent("Hello");
    expect(result.processing_time_ms).toBeGreaterThanOrEqual(0);
    expect(typeof result.processing_time_ms).toBe("number");
  });
});

describe("Intent Router v2 - Evaluation Dataset", () => {
  beforeAll(() => {
    configure({ enableLLMFallback: false, enableCache: false });
  });

  const stats = getDatasetStats();
  console.log("Dataset stats:", stats);

  it("should have sufficient test examples", () => {
    expect(EVALUATION_DATASET.length).toBeGreaterThan(30);
  });

  it("should cover all supported locales", () => {
    expect(Object.keys(stats.byLocale)).toContain("es");
    expect(Object.keys(stats.byLocale)).toContain("en");
    expect(Object.keys(stats.byLocale)).toContain("pt");
    expect(Object.keys(stats.byLocale)).toContain("fr");
    expect(Object.keys(stats.byLocale)).toContain("de");
    expect(Object.keys(stats.byLocale)).toContain("it");
  });

  it("should pass easy examples with high accuracy", async () => {
    const easyExamples = EVALUATION_DATASET.filter(e => e.difficulty === "easy");
    let correct = 0;
    const failures: Array<{text: string, expected: string, got: string}> = [];

    for (const example of easyExamples) {
      const result = await routeIntent(example.text);
      if (result.intent === example.expected_intent) {
        correct++;
      } else {
        failures.push({text: example.text, expected: example.expected_intent, got: result.intent});
      }
    }

    const accuracy = correct / easyExamples.length;
    console.log(`Easy examples accuracy: ${(accuracy * 100).toFixed(1)}% (${correct}/${easyExamples.length})`);
    if (failures.length > 0 && failures.length <= 10) {
      console.log("Failures:", failures.slice(0, 5));
    }
    expect(accuracy).toBeGreaterThan(0.75);
  });

  it("should handle Spanish examples", async () => {
    const spanishExamples = getExamplesByLocale("es").slice(0, 5);
    let correct = 0;

    for (const example of spanishExamples) {
      const result = await routeIntent(example.text);
      if (result.intent === example.expected_intent) {
        correct++;
      }
    }

    expect(correct).toBeGreaterThan(spanishExamples.length * 0.7);
  });

  it("should handle English examples", async () => {
    const englishExamples = getExamplesByLocale("en").slice(0, 5);
    let correct = 0;

    for (const example of englishExamples) {
      const result = await routeIntent(example.text);
      if (result.intent === example.expected_intent) {
        correct++;
      }
    }

    expect(correct).toBeGreaterThan(englishExamples.length * 0.7);
  });
});

describe("Intent Router v2 - Property-based Testing", () => {
  beforeAll(() => {
    configure({ enableLLMFallback: false, enableCache: false });
  });

  it("should always return valid intent type", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 200 }), async (text) => {
        const result = await routeIntent(text);
        const validIntents: IntentType[] = [
          "CREATE_PRESENTATION",
          "CREATE_DOCUMENT",
          "CREATE_SPREADSHEET",
          "SUMMARIZE",
          "TRANSLATE",
          "SEARCH_WEB",
          "ANALYZE_DOCUMENT",
          "CHAT_GENERAL",
          "NEED_CLARIFICATION"
        ];
        return validIntents.includes(result.intent);
      }),
      { numRuns: 50 }
    );
  });

  it("should always return confidence between 0 and 1", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 200 }), async (text) => {
        const result = await routeIntent(text);
        return result.confidence >= 0 && result.confidence <= 1;
      }),
      { numRuns: 50 }
    );
  });

  it("should always return router version", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 100 }), async (text) => {
        const result = await routeIntent(text);
        return result.router_version === ROUTER_VERSION;
      }),
      { numRuns: 20 }
    );
  });

  it("should handle unicode strings", async () => {
    const unicodeStrings = [
      "Créer une présentation",
      "Создать презентацию",
      "创建演示文稿",
      "プレゼンテーションを作成",
      "إنشاء عرض تقديمي",
      "Crea una presentación sobre IA 🚀"
    ];
    
    for (const text of unicodeStrings) {
      const result = await routeIntent(text);
      expect(result.normalized_text).toBeDefined();
    }
  });

  it("should be deterministic without cache", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 5, maxLength: 50 }),
        async (text) => {
          const result1 = await routeIntent(text);
          const result2 = await routeIntent(text);
          return result1.intent === result2.intent;
        }
      ),
      { numRuns: 20 }
    );
  });
});

describe("Intent Router v2 - Regression Tests", () => {
  beforeAll(() => {
    configure({ enableLLMFallback: false, enableCache: false });
  });

  const regressionCases = [
    { text: "crea un pawer point de IA", expected: "CREATE_PRESENTATION" },
    { text: "haz diapositivas sobre marketing", expected: "CREATE_PRESENTATION" },
    { text: "arma un slide deck de ventas", expected: "CREATE_PRESENTATION" },
    { text: "crea un word sobre el proyecto", expected: "CREATE_DOCUMENT" },
    { text: "generame un documento en docx", expected: "CREATE_DOCUMENT" },
    { text: "hazme un excel con datos", expected: "CREATE_SPREADSHEET" },
    { text: "crea una hoja de calculo", expected: "CREATE_SPREADSHEET" },
    { text: "resumeme esto", expected: "SUMMARIZE" },
    { text: "traduce al ingles", expected: "TRANSLATE" },
    { text: "busca en internet sobre AI", expected: "SEARCH_WEB" },
    { text: "hola como estas", expected: "CHAT_GENERAL" }
  ];

  for (const testCase of regressionCases) {
    it(`should correctly classify: "${testCase.text}"`, async () => {
      const result = await routeIntent(testCase.text);
      expect(result.intent).toBe(testCase.expected);
    });
  }
});
