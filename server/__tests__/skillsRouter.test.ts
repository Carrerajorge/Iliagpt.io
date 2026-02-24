import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { createHttpTestClient } from "../../tests/helpers/httpTestClient";

const insertReturningQueue: any[] = [];
const updateReturningQueue: any[] = [];
const deleteReturningQueue: any[] = [];
let lastUpdatePatch: any | null = null;
const generateSkillFromPromptMock = vi.fn();
const getOpenClawSkillsRuntimeSnapshotMock = vi.fn();

const dbMock = {
  select: vi.fn(),
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(async () => {}),
      returning: vi.fn(async () => insertReturningQueue.shift() || []),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn((patch: any) => {
      lastUpdatePatch = patch;
      return {
        where: vi.fn(() => ({
          returning: vi.fn(async () => updateReturningQueue.shift() || []),
        })),
      };
    }),
  })),
  delete: vi.fn(() => ({
    where: vi.fn(() => ({
      returning: vi.fn(async () => deleteReturningQueue.shift() || []),
    })),
  })),
};

vi.mock("../db", () => ({ db: dbMock }));
vi.mock("../lib/anonUserHelper", () => ({
  getOrCreateSecureUserId: () => "user_test",
  getSecureUserId: () => "user_test",
}));
vi.mock("../services/skillGenerator", () => ({ generateSkillFromPrompt: generateSkillFromPromptMock }));
vi.mock("../services/openclawSkillsRuntimeAdapter", () => ({
  getOpenClawSkillsRuntimeSnapshot: getOpenClawSkillsRuntimeSnapshotMock,
}));

async function createTestApp() {
  const { createSkillsRouter } = await import("../routes/skillsRouter");
  const app = express();
  app.use(express.json());
  app.use("/api/skills", createSkillsRouter());
  return app;
}

describe("skillsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertReturningQueue.length = 0;
    updateReturningQueue.length = 0;
    deleteReturningQueue.length = 0;
    lastUpdatePatch = null;
    getOpenClawSkillsRuntimeSnapshotMock.mockResolvedValue({
      runtimeAvailable: false,
      source: "fallback",
      fallback: true,
      fetchedAt: new Date("2026-02-16T00:00:00.000Z").toISOString(),
      skills: [],
      message: "fallback",
    });
  });

  it("GET /api/skills returns skills (including triggers conversion)", async () => {
    const rows = [
      {
        id: "skill_1",
        userId: "user_test",
        name: "Mi Skill",
        description: "Desc",
        instructions: "Instr",
        category: "custom",
        enabled: true,
        features: ["f1"],
        triggers: [{ type: "keyword", value: "foo", priority: 0 }],
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-02T00:00:00.000Z"),
      },
    ];

    dbMock.select.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          orderBy: async () => rows,
        }),
      }),
    }));

    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.get("/api/skills");

      expect(res.status).toBe(200);
      expect(res.body.skills).toHaveLength(1);
      expect(res.body.skills[0].id).toBe("skill_1");
      expect(res.body.skills[0].triggers).toEqual(["foo"]);
    } finally {
      await close();
    }
  });

  it("GET /api/skills/active returns active skill id from user preferences", async () => {
    dbMock.select.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ preferences: { skills: { activeSkillId: "skill_active" } } }],
        }),
      }),
    }));

    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.get("/api/skills/active");

      expect(res.status).toBe(200);
      expect(res.body.activeSkillId).toBe("skill_active");
    } finally {
      await close();
    }
  });

  it("PUT /api/skills/active stores activeSkillId under preferences.skills.activeSkillId", async () => {
    dbMock.select.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ preferences: { other: 1, skills: { foo: "bar" } } }],
        }),
      }),
    }));
    updateReturningQueue.push([{ id: "user_test" }]);

    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client
        .put("/api/skills/active")
        .send({ activeSkillId: "skill_active_2" });

      expect(res.status).toBe(200);
      expect(res.body.activeSkillId).toBe("skill_active_2");

      expect(lastUpdatePatch?.preferences).toEqual({
        other: 1,
        skills: { foo: "bar", activeSkillId: "skill_active_2" },
      });
      expect(lastUpdatePatch?.updatedAt instanceof Date).toBe(true);
    } finally {
      await close();
    }
  });

  it("GET /api/skills/openclaw/runtime returns runtime snapshot (with fallback support)", async () => {
    getOpenClawSkillsRuntimeSnapshotMock.mockResolvedValueOnce({
      runtimeAvailable: false,
      source: "fallback",
      fallback: true,
      fetchedAt: new Date("2026-02-16T00:00:00.000Z").toISOString(),
      skills: [],
      message: "runtime unavailable",
    });

    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.get("/api/skills/openclaw/runtime");
      expect(res.status).toBe(200);
      expect(res.body.fallback).toBe(true);
      expect(Array.isArray(res.body.skills)).toBe(true);
    } finally {
      await close();
    }
  });

  it("POST /api/skills creates a skill", async () => {
    const createdRow = {
      id: "skill_2",
      userId: "user_test",
      name: "Nuevo",
      description: "Desc",
      instructions: "Instr",
      category: "custom",
      enabled: true,
      features: ["f1"],
      triggers: [{ type: "keyword", value: "t1", priority: 0 }],
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-02T00:00:00.000Z"),
    };
    insertReturningQueue.push([createdRow]);

    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.post("/api/skills").send({
        name: "Nuevo",
        description: "Desc",
        instructions: "Instr",
        category: "custom",
        enabled: true,
        features: ["f1"],
        triggers: ["t1"],
      });

      expect(res.status).toBe(201);
      expect(res.body.skill.id).toBe("skill_2");
      expect(res.body.skill.triggers).toEqual(["t1"]);
    } finally {
      await close();
    }
  });

  it("PUT /api/skills/:id returns 404 when skill not found", async () => {
    updateReturningQueue.push([]);
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.put("/api/skills/does-not-exist").send({ description: "x" });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Skill not found");
    } finally {
      await close();
    }
  });

  it("PUT /api/skills/:id converts triggers to DB shape", async () => {
    const updatedRow = {
      id: "skill_3",
      userId: "user_test",
      name: "Upd",
      description: "Desc",
      instructions: "Instr",
      category: "custom",
      enabled: true,
      features: [],
      triggers: [{ type: "keyword", value: "x", priority: 0 }],
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-03T00:00:00.000Z"),
    };
    updateReturningQueue.push([updatedRow]);

    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.put("/api/skills/skill_3").send({ triggers: ["x"] });

      expect(res.status).toBe(200);
      expect(res.body.skill.id).toBe("skill_3");
      expect(res.body.skill.triggers).toEqual(["x"]);
      expect(lastUpdatePatch?.triggers).toEqual([{ type: "keyword", value: "x", priority: 0 }]);
    } finally {
      await close();
    }
  });

  it("DELETE /api/skills/:id returns 404 when missing", async () => {
    deleteReturningQueue.push([]);
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.delete("/api/skills/skill_404");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Skill not found");
    } finally {
      await close();
    }
  });

	it("POST /api/skills/import skips duplicate names (case-insensitive)", async () => {
    dbMock.select.mockImplementationOnce(() => ({
      from: () => ({
        where: async () => [{ name: "dup" }],
      }),
    }));

    const insertedRow = {
      id: "skill_new",
      userId: "user_test",
      name: "New",
      description: "Desc",
      instructions: "Instr",
      category: "custom",
      enabled: true,
      features: [],
      triggers: [{ type: "keyword", value: "k", priority: 0 }],
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-02T00:00:00.000Z"),
    };
    insertReturningQueue.push([insertedRow]);

    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client
        .post("/api/skills/import")
        .send({
          skills: [
            { name: "Dup", description: "d", instructions: "i", category: "custom", enabled: true, features: [], triggers: [] },
            { name: "New", description: "d", instructions: "i", category: "custom", enabled: true, features: [], triggers: ["k"] },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.imported).toHaveLength(1);
      expect(res.body.imported[0].name).toBe("New");
		  expect(res.body.skipped).toBe(1);
    } finally {
      await close();
    }
	});

	it("POST /api/skills/ensure returns existing skill by name (case-insensitive)", async () => {
		const existingRow = {
			id: "skill_exist",
			userId: "user_test",
			name: "Mi Skill",
			description: "Desc",
			instructions: "Instr",
			category: "custom",
			enabled: true,
			features: [],
			triggers: [],
			createdAt: new Date("2024-01-01T00:00:00.000Z"),
			updatedAt: new Date("2024-01-02T00:00:00.000Z"),
		};

		dbMock.select.mockImplementationOnce(() => ({
			from: () => ({
				where: () => ({
					limit: async () => [existingRow],
				}),
			}),
		}));

		const app = await createTestApp();
		const { client, close } = await createHttpTestClient(app);
		try {
			const res = await client
				.post("/api/skills/ensure")
				.send({ name: "mi skill", prompt: "haz algo" });

			expect(res.status).toBe(200);
			expect(res.body.created).toBe(false);
			expect(res.body.skill?.id).toBe("skill_exist");
			expect(generateSkillFromPromptMock).not.toHaveBeenCalled();
		} finally {
			await close();
		}
	});

	it("POST /api/skills/ensure creates skill when missing", async () => {
		dbMock.select.mockImplementationOnce(() => ({
			from: () => ({
				where: () => ({
					limit: async () => [],
				}),
			}),
		}));

		generateSkillFromPromptMock.mockResolvedValueOnce({
			name: "Gen",
			description: "Desc",
			instructions: "Instr",
			category: "custom",
			features: [],
			triggers: [],
		});

		const createdRow = {
			id: "skill_created",
			userId: "user_test",
			name: "Mi Skill",
			description: "Desc",
			instructions: "Instr",
			category: "custom",
			enabled: true,
			features: [],
			triggers: [],
			createdAt: new Date("2024-01-01T00:00:00.000Z"),
			updatedAt: new Date("2024-01-02T00:00:00.000Z"),
		};
		insertReturningQueue.push([createdRow]);

		const app = await createTestApp();
		const { client, close } = await createHttpTestClient(app);
		try {
			const res = await client
				.post("/api/skills/ensure")
				.send({ name: "Mi Skill", prompt: "haz algo" });

			expect(res.status).toBe(201);
			expect(res.body.created).toBe(true);
			expect(res.body.skill?.id).toBe("skill_created");
			expect(generateSkillFromPromptMock).toHaveBeenCalledTimes(1);
		} finally {
			await close();
		}
	});
});
