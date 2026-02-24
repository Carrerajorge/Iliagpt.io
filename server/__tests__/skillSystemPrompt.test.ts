import { describe, expect, it } from "vitest";
import { buildSkillSystemPromptSection, type SkillContext } from "../services/skillContextResolver";

describe("buildSkillSystemPromptSection", () => {
  it("returns empty string when skill is null", () => {
    expect(buildSkillSystemPromptSection(null)).toBe("");
  });

  it("sanitizes control characters and bounds instructions", () => {
    const skill: SkillContext = {
      source: "client",
      name: "My Skill\u0000",
      instructions: `Line 1\u0001\n\n\n${"a".repeat(5000)}`,
    };

    const out = buildSkillSystemPromptSection(skill);

    expect(out).toContain("[SKILL_CONTEXT]");
    expect(out).not.toContain("\u0000");
    expect(out).not.toContain("\u0001");
    expect(out.length).toBeLessThan(4600);
  });
});
