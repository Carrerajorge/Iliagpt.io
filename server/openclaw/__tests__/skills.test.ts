import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { SkillRegistry } from '../skills/skillRegistry';
import { skillRegistry } from '../skills/skillRegistry';
import { initSkills } from '../skills/skillLoader';
import { getOpenClawConfig } from '../config';
import { ANTHROPIC_SKILLS_REPO_DIRS_ENV } from '../../lib/anthropicSkillsRepo';

describe('Skill Registry', () => {
  it('registers and retrieves skills', () => {
    const registry = new SkillRegistry();
    registry.register({
      id: 'test-skill',
      name: 'Test Skill',
      description: 'A test skill',
      prompt: 'You are a test assistant',
      tools: ['openclaw_exec'],
    });

    const skill = registry.get('test-skill');
    expect(skill).toBeTruthy();
    expect(skill!.name).toBe('Test Skill');
  });

  it('lists all skills', () => {
    const registry = new SkillRegistry();
    registry.register({ id: 's1', name: 'S1', description: '', prompt: '', tools: [] });
    registry.register({ id: 's2', name: 'S2', description: '', prompt: '', tools: [] });
    expect(registry.list()).toHaveLength(2);
  });

  it('returns skill prompt for agent context injection', () => {
    const registry = new SkillRegistry();
    registry.register({
      id: 'coding',
      name: 'Coding Agent',
      description: 'A coding assistant',
      prompt: 'You are an expert coder. Use exec and fs tools to write and run code.',
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write'],
    });

    const prompt = registry.getPromptForSkills(['coding']);
    expect(prompt).toContain('expert coder');
  });

  it('aggregates tools from multiple skills', () => {
    const registry = new SkillRegistry();
    registry.register({ id: 'a', name: 'A', description: '', prompt: '', tools: ['openclaw_exec', 'openclaw_read'] });
    registry.register({ id: 'b', name: 'B', description: '', prompt: '', tools: ['openclaw_read', 'openclaw_write'] });

    const tools = registry.getToolsForSkills(['a', 'b']);
    expect(tools).toContain('openclaw_exec');
    expect(tools).toContain('openclaw_read');
    expect(tools).toContain('openclaw_write');
    // No duplicates
    expect(tools.filter(t => t === 'openclaw_read')).toHaveLength(1);
  });

  it('removes skills', () => {
    const registry = new SkillRegistry();
    registry.register({ id: 'removable', name: 'R', description: '', prompt: '', tools: [] });
    expect(registry.get('removable')).toBeTruthy();

    registry.remove('removable');
    expect(registry.get('removable')).toBeUndefined();
  });

  it('loads SKILL.md files from filesystem and resolves prompt/tools', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-skills-'));
    const skillDir = path.join(tmpRoot, 'my-custom-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: my-custom-skill
description: Custom skill loaded from file
tools: [openclaw_exec, openclaw_read]
---

# My Custom Skill

Use this for local workflow automation.`,
      'utf-8',
    );

    const baseConfig = getOpenClawConfig();
    await initSkills({
      ...baseConfig,
      skills: {
        ...baseConfig.skills,
        enabled: true,
        includeBuiltins: false,
        autoImportClawi: false,
        directory: tmpRoot,
        extraDirectories: [],
        workspaceDirectory: tmpRoot,
      },
    });

    const loaded = skillRegistry.get('my-custom-skill');
    expect(loaded).toBeTruthy();
    expect(loaded?.source).toBe('filesystem');
    expect(loaded?.tools).toEqual(['openclaw_exec', 'openclaw_read']);

    const resolved = skillRegistry.resolve(['my-custom-skill']);
    expect(resolved.prompt).toContain('local workflow automation');
    expect(resolved.tools).toContain('openclaw_exec');
    expect(resolved.tools).toContain('openclaw_read');

    await fs.rm(tmpRoot, { recursive: true, force: true });
    skillRegistry.clear();
  });

  it('loads Anthropic repo skills from the configured repository path', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-anthropic-skills-'));
    const repoDir = path.join(tmpRoot, 'anthropics-skills');
    const skillDir = path.join(repoDir, 'skills', 'deck-review');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: deck-review
description: Review presentation decks
tools: [openclaw_read]
---

# Deck Review

Use this skill to review slide decks and presentation content.`,
      'utf-8',
    );

    process.env[ANTHROPIC_SKILLS_REPO_DIRS_ENV] = repoDir;

    try {
      const baseConfig = getOpenClawConfig();
      await initSkills({
        ...baseConfig,
        skills: {
          ...baseConfig.skills,
          enabled: true,
          includeBuiltins: false,
          autoImportClawi: false,
          directory: path.join(tmpRoot, 'empty-skills'),
          extraDirectories: [],
          workspaceDirectory: tmpRoot,
        },
      });

      const loaded = skillRegistry.get('deck-review');
      expect(loaded).toBeTruthy();
      expect(loaded?.source).toBe('filesystem');
      expect(loaded?.metadata?.vendor).toBe('anthropic');
      expect(loaded?.metadata?.homepage).toContain('github.com/anthropics/skills');
      expect(loaded?.prompt).toContain('review slide decks');
    } finally {
      delete process.env[ANTHROPIC_SKILLS_REPO_DIRS_ENV];
      await fs.rm(tmpRoot, { recursive: true, force: true });
      skillRegistry.clear();
    }
  });
});
