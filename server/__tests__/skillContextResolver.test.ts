import { describe, it, expect, vi } from "vitest";
import { resolveSkillContextFromRequest, type SkillStore } from "../services/skillContextResolver";

describe("skillContextResolver", () => {
  it("prefers skillId (DB) and tracks usage (fire-and-forget)", async () => {
    const now = new Date("2024-01-01T00:00:00.000Z");
    const store: SkillStore = {
      getSkillForUser: vi.fn().mockResolvedValue({
        id: "skill_1",
        name: "Reviewer",
        instructions: "Revisa codigo y sugiere refactors seguros.",
        enabled: true,
      }),
      trackSkillUsed: vi.fn().mockResolvedValue(undefined),
    };

    const ctx = await resolveSkillContextFromRequest(store, {
      userId: "user_1",
      skillId: "skill_1",
      skill: { name: "Client", instructions: "IGNORAR" },
      now,
    });

    expect(ctx).toEqual({
      source: "custom_skill",
      id: "skill_1",
      name: "Reviewer",
      instructions: "Revisa codigo y sugiere refactors seguros.",
    });
    expect(store.getSkillForUser).toHaveBeenCalledWith("user_1", "skill_1");
    expect(store.trackSkillUsed).toHaveBeenCalledWith("user_1", "skill_1", now);
  });

  it("falls back to client skill when DB skill is disabled", async () => {
    const store: SkillStore = {
      getSkillForUser: vi.fn().mockResolvedValue({
        id: "skill_1",
        name: "Disabled",
        instructions: "No deberia usarse.",
        enabled: false,
      }),
      trackSkillUsed: vi.fn().mockResolvedValue(undefined),
    };

    const ctx = await resolveSkillContextFromRequest(store, {
      userId: "user_1",
      skillId: "skill_1",
      skill: { name: "Client", instructions: "Usa estas instrucciones." },
    });

    expect(ctx).toEqual({
      source: "client",
      name: "Client",
      instructions: "Usa estas instrucciones.",
    });
    expect(store.trackSkillUsed).not.toHaveBeenCalled();
  });

  it("falls back to activeSkillId from user preferences when request does not provide skillId", async () => {
    const store: SkillStore = {
      getSkillForUser: vi.fn().mockResolvedValue({
        id: "skill_active",
        name: "Active Skill",
        instructions: "Usa formato ejecutivo.",
        enabled: true,
      }),
      getActiveSkillIdForUser: vi.fn().mockResolvedValue("skill_active"),
      trackSkillUsed: vi.fn().mockResolvedValue(undefined),
    };

    const ctx = await resolveSkillContextFromRequest(store, {
      userId: "user_1",
      skill: { name: "Client", instructions: "Legacy" },
    });

    expect(store.getActiveSkillIdForUser).toHaveBeenCalledWith("user_1");
    expect(ctx).toEqual({
      source: "custom_skill",
      id: "skill_active",
      name: "Active Skill",
      instructions: "Usa formato ejecutivo.",
    });
  });

  it("bounds client instructions length (max 8000 chars)", async () => {
    const store: SkillStore = {
      getSkillForUser: vi.fn().mockResolvedValue(null),
      getActiveSkillIdForUser: vi.fn().mockResolvedValue(null),
    };

    const long = "a".repeat(9000);
    const ctx = await resolveSkillContextFromRequest(store, {
      userId: "user_1",
      skill: { name: "Largo", instructions: long },
    });

    expect(ctx?.instructions.length).toBe(8000);
    expect(ctx?.name).toBe("Largo");
  });
});

