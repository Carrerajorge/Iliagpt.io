import { BUNDLED_SKILLS } from "../data/bundledSkills";
import { listAnthropicCatalogRuntimeSkills } from "../lib/anthropicSkillsRepo";
import { getOpenClawConfig } from "../openclaw/config";
import { initSkills } from "../openclaw/skills/skillLoader";
import { skillRegistry } from "../openclaw/skills/skillRegistry";
import {
  createCatalogOnlyRuntimeSkill,
  normalizeOpenClawSkillStatus,
  type OpenClawSkillsRuntimeSnapshot,
  type RuntimeSkillDescriptor,
} from "@shared/skillsRuntime";

function buildCatalogFallbackSkills(workspaceDir?: string): RuntimeSkillDescriptor[] {
  const merged = new Map<string, RuntimeSkillDescriptor>();
  for (const skill of BUNDLED_SKILLS.map(createCatalogOnlyRuntimeSkill)) {
    merged.set(skill.id, skill);
  }
  for (const skill of listAnthropicCatalogRuntimeSkills(workspaceDir)) {
    merged.set(skill.id, skill);
  }
  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getOpenClawSkillsRuntimeSnapshot(): Promise<OpenClawSkillsRuntimeSnapshot> {
  try {
    const config = getOpenClawConfig();
    if (!config.skills.enabled) {
      return {
        runtimeAvailable: false,
        source: "fallback",
        fallback: true,
        fetchedAt: new Date().toISOString(),
        skills: buildCatalogFallbackSkills(config.skills.workspaceDirectory),
        message: "OpenClaw skills runtime is disabled; showing catalog metadata only.",
      };
    }

    if (config.skills.enabled && skillRegistry.list().length === 0) {
      await initSkills(config);
    }

    const runtimeSkills = skillRegistry.list();
    if (runtimeSkills.length > 0) {
      const registeredById = new Map<string, RuntimeSkillDescriptor>();

      for (const skill of runtimeSkills) {
        registeredById.set(skill.id, {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          enabled: skill.status !== "disabled",
          status: normalizeOpenClawSkillStatus(skill.status),
          certification: "runtime",
          source: skill.source === "filesystem" ? "filesystem" : "builtin",
          fallback: false,
          tools: skill.tools || [],
          filePath: skill.filePath,
          updatedAt: skill.updatedAt,
          vendor:
            typeof skill.metadata?.vendor === "string" ? (skill.metadata.vendor as string) : undefined,
          homepage:
            typeof skill.metadata?.homepage === "string"
              ? (skill.metadata.homepage as string)
              : undefined,
        });
      }

      // Promote bundled catalog skills to "ready" when the runtime is active,
      // so they show green in the UI instead of "catalog_only" (blue).
      for (const bundled of BUNDLED_SKILLS) {
        if (!registeredById.has(bundled.id)) {
          registeredById.set(bundled.id, {
            id: bundled.id,
            name: bundled.name,
            description: bundled.description,
            enabled: true,
            status: "ready",
            certification: "runtime",
            source: "catalog",
            fallback: false,
            vendor: bundled.vendor,
            homepage: bundled.homepage,
          });
        }
      }

      // Also include Anthropic catalog skills not yet registered.
      for (const catalogSkill of listAnthropicCatalogRuntimeSkills(config.skills.workspaceDirectory)) {
        if (!registeredById.has(catalogSkill.id)) {
          registeredById.set(catalogSkill.id, {
            ...catalogSkill,
            status: "ready",
            fallback: false,
          });
        }
      }

      const skills = Array.from(registeredById.values());

      return {
        runtimeAvailable: true,
        source: "remote_runtime",
        fallback: false,
        fetchedAt: new Date().toISOString(),
        skills,
      };
    }

    return {
      runtimeAvailable: false,
      source: "fallback",
      fallback: true,
      fetchedAt: new Date().toISOString(),
      skills: buildCatalogFallbackSkills(config.skills.workspaceDirectory),
      message: "OpenClaw skills runtime is enabled, but no skills were registered.",
    };
  } catch (error) {
    const config = getOpenClawConfig();
    return {
      runtimeAvailable: false,
      source: "fallback",
      fallback: true,
      fetchedAt: new Date().toISOString(),
      skills: buildCatalogFallbackSkills(config.skills.workspaceDirectory),
      message: error instanceof Error
        ? error.message
        : "Runtime unavailable; showing catalog metadata only.",
    };
  }
}
