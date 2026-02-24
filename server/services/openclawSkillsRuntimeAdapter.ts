import { BUNDLED_SKILLS } from "../data/bundledSkills";
import { getOpenClawConfig } from "../openclaw/config";
import { initSkills } from "../openclaw/skills/skillLoader";
import { skillRegistry } from "../openclaw/skills/skillRegistry";

type RuntimeSkill = {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  status: "available" | "disabled" | "unknown";
};

export interface OpenClawSkillsRuntimeSnapshot {
  runtimeAvailable: boolean;
  source: "remote_runtime" | "fallback" | "bundled";
  fallback: boolean;
  fetchedAt: string;
  skills: RuntimeSkill[];
  message?: string;
}

export async function getOpenClawSkillsRuntimeSnapshot(): Promise<OpenClawSkillsRuntimeSnapshot> {
  try {
    const config = getOpenClawConfig();
    if (config.skills.enabled && skillRegistry.list().length === 0) {
      await initSkills(config);
    }

    const runtimeSkills = skillRegistry.list();
    if (runtimeSkills.length > 0) {
      const skills: RuntimeSkill[] = runtimeSkills.map(skill => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        enabled: true,
        status: "available",
      }));

      return {
        runtimeAvailable: true,
        source: "remote_runtime",
        fallback: false,
        fetchedAt: new Date().toISOString(),
        skills,
      };
    }
  } catch {
    // Fall through to bundled fallback snapshot.
  }

  const skills: RuntimeSkill[] = BUNDLED_SKILLS.map(skill => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    enabled: true,
    status: "available"
  }));

  return {
    runtimeAvailable: true,
    source: "bundled",
    fallback: false,
    fetchedAt: new Date().toISOString(),
    skills,
  };
}
