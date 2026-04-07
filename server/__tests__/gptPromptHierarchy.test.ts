import { describe, expect, it } from "vitest";

import {
  buildInstructionHierarchyPrompt,
  buildSystemPromptWithContext,
  type GptSessionContract,
} from "../services/gptSessionService";
import { extractSystemMessages } from "../services/chatPromptUtils";

function makeContract(overrides: Partial<GptSessionContract> = {}): GptSessionContract {
  return {
    sessionId: "session-1",
    gptId: "gpt-1",
    configVersion: 3,
    systemPrompt: "Responde siempre como asesor fiscal y en español.",
    enforcedModelId: null,
    modelFallbacks: [],
    capabilities: {
      webBrowsing: true,
      codeInterpreter: false,
      imageGeneration: false,
      fileUpload: false,
      dataAnalysis: true,
    },
    toolPermissions: {
      mode: "allowlist",
      allowedTools: [],
      actionsEnabled: true,
    },
    runtimePolicy: {
      enforceModel: false,
      modelFallbacks: [],
      allowClientOverride: false,
    },
    knowledgeContext: "La empresa opera en Bolivia y Perú.",
    temperature: 0.3,
    topP: 1,
    maxTokens: 4096,
    ...overrides,
  };
}

describe("GPT prompt hierarchy", () => {
  it("keeps the custom GPT contract as the highest-priority section", () => {
    const out = buildInstructionHierarchyPrompt("Habla solo en español.", {
      lowerPrioritySections: [
        { title: "Preferred Response Style", content: "muy conciso" },
      ],
    });

    expect(out).toContain("[CUSTOM GPT CONTRACT - HIGHEST PRIORITY]");
    expect(out).toContain("Habla solo en español.");
    expect(out).toContain("[LOWER PRIORITY PLATFORM AND USER CONTEXT]");
    expect(out).toContain("muy conciso");
    expect(out.indexOf("Habla solo en español.")).toBeLessThan(out.indexOf("muy conciso"));
  });

  it("includes GPT capabilities and knowledge as supporting context", () => {
    const out = buildSystemPromptWithContext(makeContract(), {
      lowerPrioritySections: [
        { title: "Additional System Guidance", content: "Usa tablas si ayuda." },
      ],
    });

    expect(out).toContain("[GPT SUPPORTING CONTEXT]");
    expect(out).toContain("[Enabled Capabilities]");
    expect(out).toContain("web browsing and search");
    expect(out).toContain("data analysis");
    expect(out).toContain("[Knowledge Base]");
    expect(out).toContain("La empresa opera en Bolivia y Perú.");
    expect(out).toContain("Usa tablas si ayuda.");
  });
});

describe("extractSystemMessages", () => {
  it("separates system messages and preserves conversation order", () => {
    const result = extractSystemMessages([
      { role: "system", content: "Skill A" },
      { role: "user", content: "Hola" },
      { role: "assistant", content: "Qué necesitas?" },
      { role: "system", content: "Skill B" },
      { role: "user", content: "Haz un resumen" },
    ]);

    expect(result.systemMessages).toEqual(["Skill A", "Skill B"]);
    expect(result.conversationMessages).toEqual([
      { role: "user", content: "Hola" },
      { role: "assistant", content: "Qué necesitas?" },
      { role: "user", content: "Haz un resumen" },
    ]);
  });
});
