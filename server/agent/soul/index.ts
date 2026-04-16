import { Logger } from '../../lib/logger';
import { AgentIdentity, agentIdentity, type EmotionalState } from './agentIdentity';
import { HumanBond, humanBond, type ProactiveSuggestion } from './humanBond';
import { InitiativeEngine, initiativeEngine, type Insight, type Opportunity } from './initiative';

export interface SoulContext {
  identityPrompt: string;
  bondPrompt: string;
  initiativePrompt: string;
  fullPrompt: string;
}

export interface SoulState {
  agentName: string;
  emotionalState: EmotionalState;
  moodIntensity: number;
  relationshipDepth: number;
  topOpportunities: Opportunity[];
  pendingSuggestions: ProactiveSuggestion[];
}

export class SoulEngine {
  private identity: AgentIdentity;
  private bond: HumanBond;
  private initiative: InitiativeEngine;
  private initialized = false;

  constructor(
    identity?: AgentIdentity,
    bond?: HumanBond,
    initiative?: InitiativeEngine,
  ) {
    this.identity = identity || agentIdentity;
    this.bond = bond || humanBond;
    this.initiative = initiative || initiativeEngine;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await Promise.all([
        this.identity.loadState(),
        this.initiative.loadState(),
      ]);
      this.initialized = true;
      Logger.info('[SoulEngine] Initialized successfully');
    } catch (err) {
      Logger.error('[SoulEngine] Initialization error:', err);
      this.initialized = true;
    }
  }

  async processMessage(userId: string, message: string, context?: string): Promise<SoulContext> {
    if (!this.initialized) {
      await this.initialize();
    }

    this.identity.inferMoodFromMessage(message);
    await this.bond.recordInteraction(userId, message, context);

    const identityPrompt = this.identity.getSystemPromptFragment();
    const bondPrompt = this.bond.getSystemPromptFragment(userId);
    const initiativePrompt = this.initiative.getSystemPromptFragment();

    const fullPrompt = [
      '--- Agent Soul Context ---',
      identityPrompt,
      '',
      '--- User Understanding ---',
      bondPrompt,
      '',
      '--- Proactive Intelligence ---',
      initiativePrompt,
      '--- End Soul Context ---',
    ].join('\n');

    return {
      identityPrompt,
      bondPrompt,
      initiativePrompt,
      fullPrompt,
    };
  }

  getState(userId: string): SoulState {
    return {
      agentName: this.identity.getName(),
      emotionalState: this.identity.getEmotionalState(),
      moodIntensity: this.identity.getMoodIntensity(),
      relationshipDepth: this.bond.getRelationshipDepth(userId),
      topOpportunities: this.initiative.getTopOpportunities(3),
      pendingSuggestions: this.bond.generateSuggestions(userId),
    };
  }

  setAgentName(name: string): void {
    this.identity.setName(name);
  }

  getAgentName(): string {
    return this.identity.getName();
  }

  observe(context: string, data: Record<string, any>): void {
    this.initiative.observe(context, data);
  }

  generateDailyInsight(): Insight {
    return this.initiative.generateInsight('daily');
  }

  generateWeeklyInsight(): Insight {
    return this.initiative.generateInsight('weekly');
  }

  addUserGoal(userId: string, goal: string): void {
    this.bond.addGoal(userId, goal);
  }

  removeUserGoal(userId: string, goal: string): void {
    this.bond.removeGoal(userId, goal);
  }

  learnUserPreference(userId: string, key: string, value: string, confidence?: number): void {
    this.bond.learnPreference(userId, key, value, confidence);
  }

  getIdentity(): AgentIdentity {
    return this.identity;
  }

  getBond(): HumanBond {
    return this.bond;
  }

  getInitiative(): InitiativeEngine {
    return this.initiative;
  }

  async persist(): Promise<void> {
    await Promise.all([
      this.identity.persistState(),
      this.initiative.persistState(),
    ]);
  }
}

export const soulEngine = new SoulEngine();

export { agentIdentity } from './agentIdentity';
export { humanBond } from './humanBond';
export { initiativeEngine } from './initiative';
export type { AgentIdentityConfig, PersonalityTrait, EmotionalState, MoodContext } from './agentIdentity';
export type { HumanProfile, CommunicationStyle, ProactiveSuggestion } from './humanBond';
export type { Opportunity, OpportunityType, ProactiveAction, Insight, InsightPeriod } from './initiative';
