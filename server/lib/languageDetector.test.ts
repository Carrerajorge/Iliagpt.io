import { describe, it, expect } from "vitest";
import {
  detectLanguage,
  detectLanguageFromHistory,
  getLanguageName,
  shouldRespondInLanguage,
} from "./languageDetector";

describe("detectLanguage", () => {
  it("detects Spanish text", () => {
    const result = detectLanguage("Hola, ¿cómo estás? Yo estoy muy bien, gracias por preguntar");
    expect(result.detected).toBe("es");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects English text", () => {
    const result = detectLanguage("The quick brown fox jumps over the lazy dog and they have fun");
    expect(result.detected).toBe("en");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects Portuguese text", () => {
    const result = detectLanguage("Eu não sei onde está o livro que você comprou na livraria");
    expect(result.detected).toBe("pt");
  });

  it("detects French text", () => {
    const result = detectLanguage("Je suis allé au marché pour acheter des fruits et du fromage");
    expect(result.detected).toBe("fr");
  });

  it("detects German text", () => {
    const result = detectLanguage("Ich bin heute in der Schule und wir haben viel gelernt");
    expect(result.detected).toBe("de");
  });

  it("returns default 'es' for empty input", () => {
    const result = detectLanguage("");
    expect(result.detected).toBe("es");
    expect(result.confidence).toBe(0);
  });

  it("returns alternatives", () => {
    const result = detectLanguage("Hello world, this is a test message in English");
    expect(result.alternatives).toBeDefined();
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  it("alternatives are sorted by score descending", () => {
    const result = detectLanguage("The quick brown fox jumps over the lazy dog");
    for (let i = 0; i < result.alternatives.length - 1; i++) {
      expect(result.alternatives[i].score).toBeGreaterThanOrEqual(result.alternatives[i + 1].score);
    }
  });

  it("handles whitespace-only input", () => {
    const result = detectLanguage("   ");
    expect(result.detected).toBe("es");
    expect(result.confidence).toBe(0);
  });

  it("handles special characters like ñ for Spanish", () => {
    const result = detectLanguage("El niño come piña y año nuevo");
    expect(result.detected).toBe("es");
  });
});

describe("detectLanguageFromHistory", () => {
  it("detects language from combined messages", () => {
    const messages = [
      "Hello, how are you?",
      "I am doing fine, thank you",
      "What is the weather like today?",
    ];
    const result = detectLanguageFromHistory(messages);
    expect(result).toBe("en");
  });

  it("detects Spanish from history", () => {
    const messages = [
      "Hola, ¿cómo estás?",
      "Estoy bien, gracias",
      "¿Qué hora es?",
      "Son las tres de la tarde",
    ];
    const result = detectLanguageFromHistory(messages);
    expect(result).toBe("es");
  });

  it("returns 'es' default for empty messages", () => {
    const result = detectLanguageFromHistory([]);
    expect(result).toBe("es");
  });

  it("considers only last 5 messages for combined detection", () => {
    const messages = Array(20).fill("The weather is very nice today");
    const result = detectLanguageFromHistory(messages);
    expect(result).toBe("en");
  });
});

describe("getLanguageName", () => {
  it("returns correct names for known codes", () => {
    expect(getLanguageName("es")).toBe("Español");
    expect(getLanguageName("en")).toBe("English");
    expect(getLanguageName("pt")).toBe("Português");
    expect(getLanguageName("fr")).toBe("Français");
    expect(getLanguageName("de")).toBe("Deutsch");
  });

  it("returns uppercased code for unknown language", () => {
    expect(getLanguageName("ja")).toBe("JA");
    expect(getLanguageName("zh")).toBe("ZH");
  });
});

describe("shouldRespondInLanguage", () => {
  it("returns detected language when confidence is high", () => {
    const result = shouldRespondInLanguage("Hello, how are you doing today? I would like to ask you something.");
    expect(result).toBe("en");
  });

  it("falls back to conversation history when message confidence is low", () => {
    const history = [
      "Hola, buenos días",
      "¿Cómo estás hoy?",
      "Estoy muy bien",
    ];
    const result = shouldRespondInLanguage("ok", history);
    expect(result).toBe("es");
  });

  it("returns detected language for clear single message", () => {
    const result = shouldRespondInLanguage("Je suis très content de vous rencontrer aujourd'hui");
    expect(result).toBe("fr");
  });
});
