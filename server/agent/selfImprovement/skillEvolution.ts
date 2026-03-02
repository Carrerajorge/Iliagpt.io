import { EventEmitter } from 'events';
import { performanceTracker, type TaskComplexity } from './performanceTracker';

export type ProficiencyLevel = 'novice' | 'competent' | 'proficient' | 'expert' | 'master';

export interface Skill {
  id: string;
  name: string;
  category: string;
  proficiency: ProficiencyLevel;
  xp: number;
  xpToNext: number;
  totalUses: number;
  successStreak: number;
  longestStreak: number;
  unlockedCombinations: string[];
  lastUsed: number;
  createdAt: number;
}

export interface SkillCombination {
  id: string;
  skills: string[];
  name: string;
  description: string;
  requiredLevel: ProficiencyLevel;
  unlocked: boolean;
  effectiveness: number;
}

export interface SkillSnapshot {
  totalSkills: number;
  skillsByLevel: Record<ProficiencyLevel, number>;
  topSkills: Skill[];
  recentlyImproved: string[];
  availableCombinations: SkillCombination[];
  overallMastery: number;
}

const LEVEL_ORDER: ProficiencyLevel[] = ['novice', 'competent', 'proficient', 'expert', 'master'];

const XP_THRESHOLDS: Record<ProficiencyLevel, number> = {
  novice: 0,
  competent: 100,
  proficient: 350,
  expert: 800,
  master: 1500,
};

const COMPLEXITY_XP: Record<TaskComplexity, number> = {
  simple: 5,
  moderate: 15,
  complex: 35,
  expert: 60,
};

export class SkillEvolution extends EventEmitter {
  private skills: Map<string, Skill> = new Map();
  private combinations: Map<string, SkillCombination> = new Map();
  private recentlyImproved: string[] = [];

  constructor() {
    super();
    this.initializeCombinations();
  }

  private initializeCombinations(): void {
    const combos: Omit<SkillCombination, 'unlocked' | 'effectiveness'>[] = [
      {
        id: 'web_research_synthesis',
        skills: ['web_search', 'text_analysis'],
        name: 'Research Synthesis',
        description: 'Combine web search with deep text analysis for comprehensive research',
        requiredLevel: 'competent',
      },
      {
        id: 'code_debug_fix',
        skills: ['code_generation', 'error_analysis'],
        name: 'Autonomous Debugging',
        description: 'Automatically detect, diagnose, and fix code issues',
        requiredLevel: 'proficient',
      },
      {
        id: 'data_pipeline',
        skills: ['data_extraction', 'data_transformation', 'visualization'],
        name: 'Data Pipeline',
        description: 'End-to-end data extraction, transformation, and visualization',
        requiredLevel: 'proficient',
      },
      {
        id: 'full_stack_build',
        skills: ['code_generation', 'database_ops', 'api_design'],
        name: 'Full-Stack Builder',
        description: 'Design and implement complete full-stack features',
        requiredLevel: 'expert',
      },
      {
        id: 'multi_source_analysis',
        skills: ['web_search', 'document_analysis', 'data_extraction'],
        name: 'Multi-Source Intelligence',
        description: 'Aggregate and cross-reference information from multiple source types',
        requiredLevel: 'expert',
      },
    ];

    for (const c of combos) {
      this.combinations.set(c.id, { ...c, unlocked: false, effectiveness: 0 });
    }
  }

  getOrCreateSkill(name: string, category = 'general'): Skill {
    if (this.skills.has(name)) return this.skills.get(name)!;

    const skill: Skill = {
      id: `skill_${name}`,
      name,
      category,
      proficiency: 'novice',
      xp: 0,
      xpToNext: XP_THRESHOLDS.competent,
      totalUses: 0,
      successStreak: 0,
      longestStreak: 0,
      unlockedCombinations: [],
      lastUsed: Date.now(),
      createdAt: Date.now(),
    };
    this.skills.set(name, skill);
    return skill;
  }

  recordSkillUse(
    skillName: string,
    success: boolean,
    complexity: TaskComplexity = 'moderate',
    category = 'general',
  ): Skill {
    const skill = this.getOrCreateSkill(skillName, category);
    skill.totalUses++;
    skill.lastUsed = Date.now();

    if (success) {
      const baseXp = COMPLEXITY_XP[complexity];
      const streakBonus = Math.min(skill.successStreak * 2, 20);
      skill.xp += baseXp + streakBonus;
      skill.successStreak++;
      if (skill.successStreak > skill.longestStreak) {
        skill.longestStreak = skill.successStreak;
      }
    } else {
      skill.xp += 2;
      skill.successStreak = 0;
    }

    const previousLevel = skill.proficiency;
    this.recalculateLevel(skill);

    if (skill.proficiency !== previousLevel) {
      this.recentlyImproved.push(skillName);
      if (this.recentlyImproved.length > 20) this.recentlyImproved.shift();
      this.emit('skill:levelUp', {
        skill: skillName,
        from: previousLevel,
        to: skill.proficiency,
      });
      this.checkCombinationUnlocks();
    }

    this.skills.set(skillName, skill);
    return skill;
  }

  private recalculateLevel(skill: Skill): void {
    const levels = LEVEL_ORDER.slice().reverse();
    for (const level of levels) {
      if (skill.xp >= XP_THRESHOLDS[level]) {
        skill.proficiency = level;
        const nextIdx = LEVEL_ORDER.indexOf(level) + 1;
        skill.xpToNext =
          nextIdx < LEVEL_ORDER.length
            ? XP_THRESHOLDS[LEVEL_ORDER[nextIdx]] - skill.xp
            : 0;
        return;
      }
    }
  }

  private checkCombinationUnlocks(): void {
    for (const [id, combo] of this.combinations) {
      if (combo.unlocked) continue;

      const allMet = combo.skills.every(sName => {
        const s = this.skills.get(sName);
        if (!s) return false;
        const reqIdx = LEVEL_ORDER.indexOf(combo.requiredLevel);
        const curIdx = LEVEL_ORDER.indexOf(s.proficiency);
        return curIdx >= reqIdx;
      });

      if (allMet) {
        combo.unlocked = true;
        combo.effectiveness = 0.7;
        for (const sName of combo.skills) {
          const s = this.skills.get(sName);
          if (s) s.unlockedCombinations.push(combo.name);
        }
        this.emit('combination:unlocked', { combinationId: id, name: combo.name });
      }
    }
  }

  adaptStrategy(taskType: string, complexity: TaskComplexity): string[] {
    const suggestions: string[] = [];
    const taskStats = performanceTracker.getTaskTypeStats(taskType);

    if (taskStats) {
      const cb = taskStats.complexityBreakdown[complexity];
      if (cb.attempts > 0 && cb.successes / cb.attempts < 0.5) {
        suggestions.push(`Break "${taskType}" (${complexity}) into smaller sub-tasks for better results`);
      }
    }

    const unlockedCombos = [...this.combinations.values()].filter(c => c.unlocked);
    for (const combo of unlockedCombos) {
      const relevant = combo.skills.some(s => s.includes(taskType.toLowerCase()));
      if (relevant) {
        suggestions.push(`Use "${combo.name}" combination for enhanced capability`);
      }
    }

    const expertSkills = [...this.skills.values()]
      .filter(s => LEVEL_ORDER.indexOf(s.proficiency) >= LEVEL_ORDER.indexOf('expert'))
      .map(s => s.name);

    if (expertSkills.length > 0 && complexity === 'expert') {
      suggestions.push(`Leverage expert-level skills: ${expertSkills.join(', ')}`);
    }

    return suggestions;
  }

  getSnapshot(): SkillSnapshot {
    const byLevel: Record<ProficiencyLevel, number> = {
      novice: 0, competent: 0, proficient: 0, expert: 0, master: 0,
    };
    for (const s of this.skills.values()) byLevel[s.proficiency]++;

    const topSkills = [...this.skills.values()]
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 10);

    const totalPossible = this.skills.size * (LEVEL_ORDER.length - 1);
    let totalProgress = 0;
    for (const s of this.skills.values()) {
      totalProgress += LEVEL_ORDER.indexOf(s.proficiency);
    }

    return {
      totalSkills: this.skills.size,
      skillsByLevel: byLevel,
      topSkills,
      recentlyImproved: [...this.recentlyImproved],
      availableCombinations: [...this.combinations.values()],
      overallMastery: totalPossible > 0 ? totalProgress / totalPossible : 0,
    };
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  getAllSkills(): Skill[] {
    return [...this.skills.values()];
  }
}

export const skillEvolution = new SkillEvolution();
