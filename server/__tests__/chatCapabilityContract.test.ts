import { describe, expect, it } from "vitest";

import {
  CHAT_CAPABILITY_DEFINITIONS,
  CHAT_CAPABILITY_DOMAINS,
  getChatCapabilityById,
} from "../core/chatCapabilityContract";

describe("chat capability contract", () => {
  it("covers the 18 top-level capability domains required by the product", () => {
    expect(CHAT_CAPABILITY_DOMAINS).toHaveLength(18);
    expect(CHAT_CAPABILITY_DOMAINS.map((domain) => domain.domainId)).toEqual([
      "artifact_generation",
      "local_file_management",
      "data_science",
      "synthesis_research",
      "format_conversion",
      "browser_automation",
      "computer_use",
      "scheduled_tasks",
      "dispatch",
      "connectors",
      "plugins_customization",
      "code_execution",
      "subagents",
      "project_workspaces",
      "security_governance",
      "enterprise",
      "domain_packs",
      "availability",
    ]);
  });

  it("registers representative capabilities across every domain", () => {
    const domainCoverage = new Set(CHAT_CAPABILITY_DEFINITIONS.map((capability) => capability.domainId));
    for (const domain of CHAT_CAPABILITY_DOMAINS) {
      expect(domainCoverage.has(domain.domainId)).toBe(true);
    }
  });

  it("marks every capability as multi-llm ready", () => {
    expect(CHAT_CAPABILITY_DEFINITIONS.every((capability) => capability.multiLlm)).toBe(true);
  });

  it("exposes the key artifact capabilities expected from the chat", () => {
    expect(getChatCapabilityById("artifact.xlsx.professional")?.status).toBe("integrated");
    expect(getChatCapabilityById("artifact.pptx.professional")?.status).toBe("integrated");
    expect(getChatCapabilityById("artifact.docx.professional")?.status).toBe("integrated");
    expect(getChatCapabilityById("artifact.pdf.professional")?.status).toBe("integrated");
    expect(getChatCapabilityById("artifact.structured.outputs")?.status).toBe("partial");
  });

  it("flags approval-sensitive capabilities explicitly", () => {
    expect(getChatCapabilityById("files.local.management")?.requiresApproval).toBe(true);
    expect(getChatCapabilityById("browser.automation")?.requiresApproval).toBe(true);
    expect(getChatCapabilityById("desktop.computer.use")?.requiresApproval).toBe(true);
    expect(getChatCapabilityById("code.execution.sandbox")?.requiresApproval).toBe(true);
  });
});
