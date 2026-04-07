import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ANTHROPIC_SKILLS_REPO_DIRS_ENV,
  isAnthropicSkillFilePath,
  listAnthropicCatalogRuntimeSkills,
  listAnthropicSkillCatalog,
  resolveAnthropicSkillsRepoDirs,
} from "../lib/anthropicSkillsRepo";

describe("anthropic skills repo helper", () => {
  let tmpRoot: string | null = null;

  afterEach(async () => {
    delete process.env[ANTHROPIC_SKILLS_REPO_DIRS_ENV];
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true });
      tmpRoot = null;
    }
  });

  it("discovers nested skills from an Anthropic repo clone", async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "anthropic-skills-helper-"));
    const repoDir = path.join(tmpRoot, "anthropics-skills");
    const skillDir = path.join(repoDir, "skills", "meeting-brief");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: meeting-brief
description: Prepare a concise meeting brief
---

# Meeting Brief

Summarize the key context before a meeting.`,
      "utf8",
    );

    process.env[ANTHROPIC_SKILLS_REPO_DIRS_ENV] = repoDir;

    const repoDirs = resolveAnthropicSkillsRepoDirs(tmpRoot);
    expect(repoDirs).toEqual([path.resolve(repoDir)]);

    const catalog = listAnthropicSkillCatalog(tmpRoot);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      id: "meeting-brief",
      name: "meeting-brief",
      description: "Prepare a concise meeting brief",
      vendor: "anthropic",
    });

    const runtimeCatalog = listAnthropicCatalogRuntimeSkills(tmpRoot);
    expect(runtimeCatalog[0]).toMatchObject({
      id: "meeting-brief",
      status: "catalog_only",
      vendor: "anthropic",
    });

    expect(isAnthropicSkillFilePath(path.join(skillDir, "SKILL.md"), tmpRoot)).toBe(true);
  });
});
