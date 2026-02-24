import { describe, it, expect } from 'vitest';
import { getOpenClawConfig } from '../config';

describe('OpenClaw Config', () => {
  it('returns disabled by default when env vars are not set', () => {
    const config = getOpenClawConfig();
    expect(config.gateway.enabled).toBe(false);
    expect(config.tools.enabled).toBe(false);
    expect(config.plugins.enabled).toBe(false);
    expect(config.skills.enabled).toBe(false);
    expect(config.streaming.enabled).toBe(false);
  });

  it('reads safe-bins from env', () => {
    process.env.OPENCLAW_SAFE_BINS = 'python,node,git';
    const config = getOpenClawConfig();
    expect(config.tools.safeBins).toEqual(['python', 'node', 'git']);
    delete process.env.OPENCLAW_SAFE_BINS;
  });

  it('returns default safe-bins when env is not set', () => {
    delete process.env.OPENCLAW_SAFE_BINS;
    const config = getOpenClawConfig();
    expect(config.tools.safeBins).toContain('python');
    expect(config.tools.safeBins).toContain('node');
    expect(config.tools.safeBins).toContain('git');
    expect(config.tools.safeBins.length).toBeGreaterThan(10);
  });

  it('reads gateway path from env', () => {
    process.env.OPENCLAW_WS_PATH = '/custom/ws';
    const config = getOpenClawConfig();
    expect(config.gateway.path).toBe('/custom/ws');
    delete process.env.OPENCLAW_WS_PATH;
  });

  it('reads skills extra dirs and toggles from env', () => {
    process.env.OPENCLAW_SKILLS_EXTRA_DIRS = '/tmp/s1,/tmp/s2';
    process.env.OPENCLAW_SKILLS_INCLUDE_BUILTINS = 'false';
    process.env.OPENCLAW_SKILLS_AUTO_IMPORT_CLAWI = 'false';
    process.env.OPENCLAW_SKILL_MAX_BYTES = '12345';

    const config = getOpenClawConfig();
    expect(config.skills.extraDirectories).toEqual(['/tmp/s1', '/tmp/s2']);
    expect(config.skills.includeBuiltins).toBe(false);
    expect(config.skills.autoImportClawi).toBe(false);
    expect(config.skills.maxSkillFileBytes).toBe(12345);

    delete process.env.OPENCLAW_SKILLS_EXTRA_DIRS;
    delete process.env.OPENCLAW_SKILLS_INCLUDE_BUILTINS;
    delete process.env.OPENCLAW_SKILLS_AUTO_IMPORT_CLAWI;
    delete process.env.OPENCLAW_SKILL_MAX_BYTES;
  });
});
