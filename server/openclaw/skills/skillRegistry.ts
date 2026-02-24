import type { Skill } from '../types';

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  registerMany(skills: Skill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  getPromptForSkills(skillIds: string[]): string {
    const prompts: string[] = [];
    for (const id of skillIds) {
      const skill = this.skills.get(id);
      if (skill?.prompt) {
        prompts.push(`## Skill: ${skill.name}\n${skill.prompt}`);
      }
    }
    return prompts.join('\n\n');
  }

  getToolsForSkills(skillIds: string[]): string[] {
    const tools = new Set<string>();
    for (const id of skillIds) {
      const skill = this.skills.get(id);
      if (skill?.tools) {
        for (const t of skill.tools) tools.add(t);
      }
    }
    return Array.from(tools);
  }

  remove(id: string): boolean {
    return this.skills.delete(id);
  }

  clear(): void {
    this.skills.clear();
  }

  resolve(skillIds?: string[]): { skills: Skill[]; prompt: string; tools: string[] } {
    const selected = skillIds?.length
      ? skillIds.map(id => this.skills.get(id)).filter(Boolean) as Skill[]
      : this.list();

    return {
      skills: selected,
      prompt: this.getPromptForSkills(selected.map(s => s.id)),
      tools: Array.from(new Set(selected.flatMap(s => s.tools || []))),
    };
  }
}

export const skillRegistry = new SkillRegistry();
