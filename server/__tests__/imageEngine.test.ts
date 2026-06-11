import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENGINE_ENV_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "AI_INTEGRATIONS_GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "GROK_API_KEY",
  "OPENROUTER_API_KEY",
  "IMAGE_ENGINE_PRIORITY",
  "IMAGE_ENGINE_OPENROUTER_MODELS",
  "IMAGE_ENGINE_CUSTOM_BASE_URL",
  "IMAGE_ENGINE_CUSTOM_API_KEY",
  "IMAGE_ENGINE_CUSTOM_MODELS",
];

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.resetModules();
  for (const key of ENGINE_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENGINE_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

async function loadRegistry() {
  return import("../services/imageEngine/registry");
}

describe("imageEngine registry", () => {
  it("only exposes configured providers, in priority order", async () => {
    process.env.GEMINI_API_KEY = "test-gemini";
    const registry = await loadRegistry();

    const attempts = registry.resolveAttempts();
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.every((attempt) => attempt.adapter.name === "gemini")).toBe(true);
    expect(attempts[0].model.id).toBe("gemini-3.1-flash-image-preview");
  });

  it("orders providers gemini → openai → xai → openrouter by default", async () => {
    process.env.GEMINI_API_KEY = "test";
    process.env.OPENAI_API_KEY = "test";
    process.env.XAI_API_KEY = "test";
    process.env.OPENROUTER_API_KEY = "test";
    const registry = await loadRegistry();

    const providers = registry.resolveAttempts().map((attempt) => attempt.adapter.name);
    const firstIndexOf = (name: string) => providers.indexOf(name);
    expect(firstIndexOf("gemini")).toBeLessThan(firstIndexOf("openai"));
    expect(firstIndexOf("openai")).toBeLessThan(firstIndexOf("xai"));
    expect(firstIndexOf("xai")).toBeLessThan(firstIndexOf("openrouter"));
  });

  it("honors IMAGE_ENGINE_PRIORITY overrides", async () => {
    process.env.GEMINI_API_KEY = "test";
    process.env.OPENAI_API_KEY = "test";
    process.env.IMAGE_ENGINE_PRIORITY = "openai,gemini";
    const registry = await loadRegistry();

    const attempts = registry.resolveAttempts();
    expect(attempts[0].adapter.name).toBe("openai");
  });

  it("puts an explicitly requested known model first", async () => {
    process.env.GEMINI_API_KEY = "test";
    process.env.OPENAI_API_KEY = "test";
    const registry = await loadRegistry();

    const attempts = registry.resolveAttempts("dall-e-3");
    expect(attempts[0].model.id).toBe("dall-e-3");
    // Fallback chain still follows.
    expect(attempts.length).toBeGreaterThan(1);
    expect(attempts.slice(1).some((attempt) => attempt.model.id === "dall-e-3")).toBe(false);
  });

  it("routes unknown vendor/model ids through OpenRouter verbatim", async () => {
    process.env.OPENROUTER_API_KEY = "test";
    const registry = await loadRegistry();

    const attempts = registry.resolveAttempts("black-forest-labs/flux-1.1-pro");
    expect(attempts[0].adapter.name).toBe("openrouter");
    expect(attempts[0].model.id).toBe("black-forest-labs/flux-1.1-pro");
  });

  it("flags unavailable providers in the catalog", async () => {
    process.env.GEMINI_API_KEY = "test";
    const registry = await loadRegistry();

    const catalog = registry.getModelCatalog();
    const gemini = catalog.filter((entry) => entry.provider === "gemini");
    const openai = catalog.filter((entry) => entry.provider === "openai");
    expect(gemini.every((entry) => entry.available)).toBe(true);
    expect(openai.every((entry) => !entry.available)).toBe(true);
  });

  it("opens the circuit after 3 failures and recovers on success", async () => {
    const registry = await loadRegistry();
    registry.resetModelHealth();

    expect(registry.isModelCoolingDown("model-x")).toBe(false);
    registry.reportModelFailure("model-x");
    registry.reportModelFailure("model-x");
    expect(registry.isModelCoolingDown("model-x")).toBe(false);
    registry.reportModelFailure("model-x");
    expect(registry.isModelCoolingDown("model-x")).toBe(true);

    registry.reportModelSuccess("model-x");
    expect(registry.isModelCoolingDown("model-x")).toBe(false);
  });

  it("exposes env-pinned OpenRouter models before the defaults", async () => {
    process.env.OPENROUTER_API_KEY = "test";
    process.env.IMAGE_ENGINE_OPENROUTER_MODELS = "vendor/custom-image-model";
    const registry = await loadRegistry();

    const attempts = registry.resolveAttempts();
    expect(attempts[0].model.id).toBe("vendor/custom-image-model");
  });
});

describe("imageEngine payload normalization", () => {
  it("extracts a data URL from string content", async () => {
    const { extractImageFromChatMessage } = await import("../services/imageEngine/normalize");
    const base64 = Buffer.from("fake-image").toString("base64");
    const result = await extractImageFromChatMessage({
      content: `Here you go ![img](data:image/webp;base64,${base64})`,
    });
    expect(result).toEqual({ imageBase64: base64, mimeType: "image/webp" });
  });

  it("extracts b64_json entries from message.images", async () => {
    const { extractImageFromChatMessage } = await import("../services/imageEngine/normalize");
    const result = await extractImageFromChatMessage({
      images: [{ b64_json: "QUJD", content_type: "image/jpeg" }],
    });
    expect(result).toEqual({ imageBase64: "QUJD", mimeType: "image/jpeg" });
  });

  it("extracts inline_data parts from multimodal content arrays", async () => {
    const { extractImageFromChatMessage } = await import("../services/imageEngine/normalize");
    const result = await extractImageFromChatMessage({
      content: [
        { type: "text", text: "an image" },
        { type: "image", inline_data: { data: "WFla", mime_type: "image/png" } },
      ],
    });
    expect(result).toEqual({ imageBase64: "WFla", mimeType: "image/png" });
  });

  it("returns null when no image payload exists", async () => {
    const { extractImageFromChatMessage } = await import("../services/imageEngine/normalize");
    expect(await extractImageFromChatMessage({ content: "sorry, text only" })).toBeNull();
    expect(await extractImageFromChatMessage(null)).toBeNull();
  });
});

describe("image intent detection (extended)", () => {
  it("detects Spanish clitic forms and want-phrasings", async () => {
    const { detectImageRequest } = await import("../services/imageGeneration");
    expect(detectImageRequest("creame una imagen de un perro")).toBe(true);
    expect(detectImageRequest("créame una foto del mar al atardecer")).toBe(true);
    expect(detectImageRequest("génerame una ilustración de montañas")).toBe(true);
    expect(detectImageRequest("hazme un logo para mi cafetería")).toBe(true);
    expect(detectImageRequest("dibújame un dragón medieval")).toBe(true);
    expect(detectImageRequest("píntame la torre eiffel de noche")).toBe(true);
    expect(detectImageRequest("quiero una imagen de un gato astronauta")).toBe(true);
    expect(detectImageRequest("muéstrame una imagen de la vía láctea")).toBe(true);
  });

  it("detects English variants", async () => {
    const { detectImageRequest } = await import("../services/imageGeneration");
    expect(detectImageRequest("draw me a dragon flying over a city")).toBe(true);
    expect(detectImageRequest("I want a picture of a sunset")).toBe(true);
    expect(detectImageRequest("generate an image of a cyberpunk street")).toBe(true);
    expect(detectImageRequest("make me an avatar for my profile")).toBe(true);
  });

  it("does not misfire on figurative or analytical phrasing", async () => {
    const { detectImageRequest } = await import("../services/imageGeneration");
    expect(detectImageRequest("esto pinta mal para la economía")).toBe(false);
    expect(detectImageRequest("draw conclusions from this dataset")).toBe(false);
    expect(detectImageRequest("crea un plan de negocio detallado")).toBe(false);
    expect(detectImageRequest("hazme un resumen del documento")).toBe(false);
  });

  it("extracts clean prompts from clitic phrasings", async () => {
    const { extractImagePrompt } = await import("../services/imageGeneration");
    expect(extractImagePrompt("creame una imagen de un perro")).toBe("un perro");
    expect(extractImagePrompt("dibújame un dragón medieval")).toBe("un dragón medieval");
  });
});
