import { createLogger } from "../../utils/logger";
import * as fs from "fs/promises";
import * as path from "path";

const log = createLogger("openclaw-marketplace");
const CLAWHUB_API = "https://clawhub.openclaw.dev/api/v1";

export interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  downloads: number;
  rating: number;
  tags: string[];
  installUrl: string;
}

export async function searchSkills(query: string, limit: number = 20): Promise<MarketplaceSkill[]> {
  try {
    const res = await fetch(
      `${CLAWHUB_API}/skills/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    );
    if (!res.ok) return [];
    return (await res.json()) as MarketplaceSkill[];
  } catch (e) {
    log.warn("Marketplace search failed", { error: (e as Error).message });
    return [];
  }
}

export async function getPopularSkills(limit: number = 10): Promise<MarketplaceSkill[]> {
  try {
    const res = await fetch(`${CLAWHUB_API}/skills/popular?limit=${limit}`);
    if (!res.ok) return [];
    return (await res.json()) as MarketplaceSkill[];
  } catch {
    return [];
  }
}

export async function installSkill(
  skillId: string,
  targetDir: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const res = await fetch(`${CLAWHUB_API}/skills/${encodeURIComponent(skillId)}/download`);
    if (!res.ok) return { success: false, error: `Download failed: ${res.status}` };

    const skillDir = path.join(targetDir, skillId);
    await fs.mkdir(skillDir, { recursive: true });

    const content = await res.text();
    const skillFile = path.join(skillDir, "SKILL.md");
    await fs.writeFile(skillFile, content, "utf-8");

    log.info("Skill installed", { skillId, path: skillFile });
    return { success: true, path: skillFile };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function getInstalledSkills(skillsDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
