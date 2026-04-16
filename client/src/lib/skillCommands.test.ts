import { describe, expect, it } from "vitest";
import { findEnabledSkillByName, parseSkillCreateCommand, parseSkillInvocation } from "./skillCommands";

describe("parseSkillCreateCommand", () => {
  it("returns null when not a /skill command", () => {
    expect(parseSkillCreateCommand("hola")).toBeNull();
  });

  it("parses /skill with prompt", () => {
    expect(parseSkillCreateCommand("/skill crear un skill para resumir emails")).toBe("un skill para resumir emails");
  });

  it("parses /skill:create with prompt", () => {
    expect(parseSkillCreateCommand("/skill: crear skill de tablas")).toBe("skill de tablas");
  });

  it("returns empty string when /skill has no prompt", () => {
    expect(parseSkillCreateCommand("/skill")).toBe("");
  });
});

describe("parseSkillInvocation", () => {
  it("returns null when no @ at start", () => {
    expect(parseSkillInvocation("hola @x")).toBeNull();
  });

  it("parses @{Skill Name}", () => {
    expect(parseSkillInvocation("@{Mi Skill} haz algo")).toEqual({ raw: "@{Mi Skill}", name: "Mi Skill" });
  });

  it("parses @SkillName token", () => {
    expect(parseSkillInvocation("@Skill1 haz algo")).toEqual({ raw: "@Skill1", name: "Skill1" });
  });
});

describe("findEnabledSkillByName", () => {
  it("matches case-insensitively and only enabled", () => {
    const skills = [
      { name: "A", instructions: "x", enabled: false },
      { name: "Mi Skill", instructions: "ok", enabled: true },
    ];
    expect(findEnabledSkillByName("mi skill", skills as any)).toEqual(skills[1]);
  });
});

