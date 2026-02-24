import { describe, it, expect } from "vitest";
import { buildNativeAgenticFusion, hasNativeAgenticSignal } from "../nativeAgenticFusion";

describe("nativeAgenticFusion", () => {
  it("detects planning/memory/skills signals", () => {
    expect(hasNativeAgenticSignal("Planifica esto paso a paso")).toBe(true);
    expect(hasNativeAgenticSignal("Recuerda lo que hablamos ayer")).toBe(true);
    expect(hasNativeAgenticSignal("Usa la skill $coding-agent")).toBe(true);
    expect(hasNativeAgenticSignal("Analiza que carpetas hay en mi Mac y en mi escritorio")).toBe(true);
    expect(hasNativeAgenticSignal("puedes decirme cuantas caprteas tengo en mi escritorio?")).toBe(true);
  });

  it("does not force fusion when there is no signal", async () => {
    expect(hasNativeAgenticSignal("Hola, como estas hoy?")).toBe(false);

    const result = await buildNativeAgenticFusion({
      userId: "test-user",
      chatId: "test-chat",
      message: "Hola, como estas hoy?",
    });

    expect(result.appliedModules).toEqual([]);
    expect(result.promptAddendum).toBe("");
  });
});
