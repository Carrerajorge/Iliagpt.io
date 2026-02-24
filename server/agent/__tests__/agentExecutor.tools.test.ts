import { describe, expect, it } from "vitest";
import { getToolsForIntent } from "../agentExecutor";

describe("agentExecutor tool selection", () => {
  it("includes local filesystem tools for local-computer prompts", () => {
    const tools = getToolsForIntent(
      "chat",
      "owner",
      "puedes analizar que carpetas hay en mi computadora y en mi escritorio",
    );
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("list_files");
    expect(names).toContain("read_file");
    expect(names).toContain("openclaw_clawi_status");
  });

  it("includes local filesystem tools for count questions with typo", () => {
    const tools = getToolsForIntent(
      "chat",
      "owner",
      "puedes decirme cuantas caprteas tengo en mi escritorio?",
    );
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("list_files");
    expect(names).toContain("read_file");
    expect(names).toContain("openclaw_clawi_status");
  });

  it("does not inject bundled skills by default when there is no skill signal", () => {
    const tools = getToolsForIntent("chat", "owner", "hola, dame un resumen corto");
    const names = tools.map((tool) => tool.name);

    expect(names.some((name) => name.startsWith("skill_"))).toBe(false);
  });
});
