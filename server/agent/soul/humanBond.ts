import { EventEmitter } from 'events';
import { Logger } from '../../lib/logger';
import { redis } from '../../lib/redis';

export type CommunicationStyle = 'formal' | 'casual' | 'technical' | 'mixed';
export type ExpertiseLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export interface HumanProfile {
  userId: string;
  communicationStyle: CommunicationStyle;
  expertiseLevel: ExpertiseLevel;
  interests: string[];
  goals: string[];
  schedulePatterns: SchedulePattern[];
  preferences: UserPreference[];
  relationshipDepth: number;
  totalInteractions: number;
  lastInteraction: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SchedulePattern {
  dayOfWeek: number;
  activeHours: number[];
  frequency: number;
}

export interface UserPreference {
  key: string;
  value: string;
  confidence: number;
  learnedAt: Date;
}

export interface ProactiveSuggestion {
  type: 'reminder' | 'optimization' | 'learning' | 'followup';
  title: string;
  description: string;
  priority: number;
  context: string;
  createdAt: Date;
}

const REDIS_KEY_PREFIX = 'agent:bond:';

export class HumanBond extends EventEmitter {
  private profiles: Map<string, HumanProfile> = new Map();
  private suggestions: Map<string, ProactiveSuggestion[]> = new Map();

  constructor() {
    super();
  }

  async getOrCreateProfile(userId: string): Promise<HumanProfile> {
    let profile = this.profiles.get(userId);
    if (profile) return profile;

    profile = await this.loadProfile(userId);
    if (profile) {
      this.profiles.set(userId, profile);
      return profile;
    }

    profile = this.createDefaultProfile(userId);
    this.profiles.set(userId, profile);
    await this.persistProfile(profile);
    return profile;
  }

  private createDefaultProfile(userId: string): HumanProfile {
    return {
      userId,
      communicationStyle: 'mixed',
      expertiseLevel: 'intermediate',
      interests: [],
      goals: [],
      schedulePatterns: [],
      preferences: [],
      relationshipDepth: 0,
      totalInteractions: 0,
      lastInteraction: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async recordInteraction(userId: string, message: string, context?: string): Promise<void> {
    const profile = await this.getOrCreateProfile(userId);
    profile.totalInteractions++;
    profile.lastInteraction = new Date();
    profile.relationshipDepth = Math.min(1, profile.relationshipDepth + 0.01);

    this.updateCommunicationStyle(profile, message);
    this.updateExpertiseLevel(profile, message);
    this.updateSchedulePatterns(profile);
    this.extractInterests(profile, message);

    profile.updatedAt = new Date();
    this.profiles.set(userId, profile);
    this.debouncedPersist(profile);

    this.emit('interaction-recorded', { userId, totalInteractions: profile.totalInteractions });
  }

  private updateCommunicationStyle(profile: HumanProfile, message: string): void {
    const lower = message.toLowerCase();
    const formalIndicators = /please|could you|would you|kindly|regarding|furthermore/i.test(lower);
    const casualIndicators = /hey|lol|btw|gonna|wanna|yeah|nah|cool/i.test(lower);
    const technicalIndicators = /api|function|class|deploy|database|algorithm|regex|docker|kubernetes/i.test(lower);

    if (technicalIndicators) {
      profile.communicationStyle = 'technical';
    } else if (formalIndicators && !casualIndicators) {
      profile.communicationStyle = 'formal';
    } else if (casualIndicators && !formalIndicators) {
      profile.communicationStyle = 'casual';
    } else {
      profile.communicationStyle = 'mixed';
    }
  }

  private updateExpertiseLevel(profile: HumanProfile, message: string): void {
    const lower = message.toLowerCase();
    const advancedTerms = /(?:microservices|kubernetes|ci\/cd|terraform|grpc|graphql|websocket|oauth2|jwt|redis|distributed|concurrency|sharding)/i;
    const beginnerTerms = /(?:what is|how do i|explain|tutorial|beginner|basic|simple|help me understand)/i;

    if (advancedTerms.test(lower)) {
      const levels: ExpertiseLevel[] = ['beginner', 'intermediate', 'advanced', 'expert'];
      const currentIdx = levels.indexOf(profile.expertiseLevel);
      if (currentIdx < levels.length - 1) {
        profile.expertiseLevel = levels[currentIdx + 1];
      }
    } else if (beginnerTerms.test(lower) && profile.totalInteractions < 10) {
      profile.expertiseLevel = 'beginner';
    }
  }

  private updateSchedulePatterns(profile: HumanProfile): void {
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();

    let pattern = profile.schedulePatterns.find(p => p.dayOfWeek === day);
    if (!pattern) {
      pattern = { dayOfWeek: day, activeHours: [], frequency: 0 };
      profile.schedulePatterns.push(pattern);
    }

    if (!pattern.activeHours.includes(hour)) {
      pattern.activeHours.push(hour);
      pattern.activeHours.sort((a, b) => a - b);
    }
    pattern.frequency++;
  }

  private extractInterests(profile: HumanProfile, message: string): void {
    const topicPatterns: Record<string, RegExp> = {
      'web-development': /react|vue|angular|nextjs|html|css|frontend|backend/i,
      'data-science': /machine learning|data|analytics|pandas|numpy|tensorflow|pytorch/i,
      'devops': /docker|kubernetes|ci\/cd|deploy|infrastructure|terraform|aws|gcp|azure/i,
      'security': /security|authentication|encryption|vulnerability|pentest/i,
      'mobile': /ios|android|react native|flutter|mobile app/i,
      'databases': /sql|postgres|mongodb|redis|database|query|orm/i,
      'ai-ml': /ai|gpt|llm|neural|model|training|fine-tune|embedding/i,
    };

    for (const [topic, pattern] of Object.entries(topicPatterns)) {
      if (pattern.test(message) && !profile.interests.includes(topic)) {
        profile.interests.push(topic);
        if (profile.interests.length > 20) {
          profile.interests = profile.interests.slice(-20);
        }
      }
    }
  }

  learnPreference(userId: string, key: string, value: string, confidence: number = 0.7): void {
    const profile = this.profiles.get(userId);
    if (!profile) return;

    const existing = profile.preferences.find(p => p.key === key);
    if (existing) {
      existing.value = value;
      existing.confidence = Math.min(1, (existing.confidence + confidence) / 2);
      existing.learnedAt = new Date();
    } else {
      profile.preferences.push({
        key,
        value,
        confidence: Math.max(0, Math.min(1, confidence)),
        learnedAt: new Date(),
      });
    }

    if (profile.preferences.length > 100) {
      profile.preferences.sort((a, b) => b.confidence - a.confidence);
      profile.preferences = profile.preferences.slice(0, 100);
    }

    this.debouncedPersist(profile);
  }

  getPreference(userId: string, key: string): string | null {
    const profile = this.profiles.get(userId);
    if (!profile) return null;
    const pref = profile.preferences.find(p => p.key === key);
    return pref ? pref.value : null;
  }

  generateSuggestions(userId: string): ProactiveSuggestion[] {
    const profile = this.profiles.get(userId);
    if (!profile) return [];

    const suggestions: ProactiveSuggestion[] = [];
    const now = new Date();

    if (profile.relationshipDepth > 0.3 && profile.interests.length > 0) {
      const topInterest = profile.interests[profile.interests.length - 1];
      suggestions.push({
        type: 'learning',
        title: `Explore more about ${topInterest}`,
        description: `Based on your recent activity, you seem interested in ${topInterest}. Would you like me to find relevant resources or best practices?`,
        priority: 0.6,
        context: topInterest,
        createdAt: now,
      });
    }

    if (profile.goals.length > 0) {
      suggestions.push({
        type: 'followup',
        title: 'Goal check-in',
        description: `Let's review your progress on: ${profile.goals[0]}. Any updates or blockers?`,
        priority: 0.7,
        context: 'goals',
        createdAt: now,
      });
    }

    const lastInteractionAge = now.getTime() - profile.lastInteraction.getTime();
    if (lastInteractionAge > 24 * 60 * 60 * 1000 && profile.relationshipDepth > 0.2) {
      suggestions.push({
        type: 'reminder',
        title: 'Welcome back',
        description: `It's been a while! Would you like a summary of what we were working on?`,
        priority: 0.5,
        context: 'return-user',
        createdAt: now,
      });
    }

    this.suggestions.set(userId, suggestions);
    return suggestions;
  }

  getRelationshipDepth(userId: string): number {
    return this.profiles.get(userId)?.relationshipDepth ?? 0;
  }

  getSystemPromptFragment(userId: string): string {
    const profile = this.profiles.get(userId);
    if (!profile || profile.totalInteractions === 0) {
      return 'This is a new user. Be welcoming and learn about their needs.';
    }

    const parts: string[] = [];

    parts.push(`User communication style: ${profile.communicationStyle}.`);
    parts.push(`Expertise level: ${profile.expertiseLevel}.`);

    if (profile.interests.length > 0) {
      parts.push(`Known interests: ${profile.interests.slice(-5).join(', ')}.`);
    }

    if (profile.goals.length > 0) {
      parts.push(`Active goals: ${profile.goals.slice(0, 3).join('; ')}.`);
    }

    const depth = profile.relationshipDepth;
    if (depth > 0.7) {
      parts.push('You have a deep working relationship with this user. Be personalized and anticipate needs.');
    } else if (depth > 0.3) {
      parts.push('You have a developing relationship. Reference past interactions when relevant.');
    }

    const highConfPrefs = profile.preferences.filter(p => p.confidence > 0.6);
    if (highConfPrefs.length > 0) {
      const prefsStr = highConfPrefs.slice(0, 5).map(p => `${p.key}: ${p.value}`).join(', ');
      parts.push(`Learned preferences: ${prefsStr}.`);
    }

    return parts.join('\n');
  }

  addGoal(userId: string, goal: string): void {
    const profile = this.profiles.get(userId);
    if (!profile) return;
    if (!profile.goals.includes(goal)) {
      profile.goals.push(goal);
      if (profile.goals.length > 10) {
        profile.goals = profile.goals.slice(-10);
      }
      this.debouncedPersist(profile);
    }
  }

  removeGoal(userId: string, goal: string): void {
    const profile = this.profiles.get(userId);
    if (!profile) return;
    profile.goals = profile.goals.filter(g => g !== goal);
    this.debouncedPersist(profile);
  }

  private persistTimeouts: Map<string, NodeJS.Timeout> = new Map();

  private debouncedPersist(profile: HumanProfile): void {
    const existing = this.persistTimeouts.get(profile.userId);
    if (existing) clearTimeout(existing);

    const timeout = setTimeout(() => {
      this.persistProfile(profile).catch(() => {});
      this.persistTimeouts.delete(profile.userId);
    }, 5000);

    this.persistTimeouts.set(profile.userId, timeout);
  }

  async persistProfile(profile: HumanProfile): Promise<void> {
    try {
      await redis.setex(
        `${REDIS_KEY_PREFIX}${profile.userId}`,
        86400 * 30,
        JSON.stringify(profile),
      );
    } catch (err) {
      Logger.error('[HumanBond] Failed to persist profile:', err);
    }
  }

  private async loadProfile(userId: string): Promise<HumanProfile | null> {
    try {
      const raw = await redis.get(`${REDIS_KEY_PREFIX}${userId}`);
      if (!raw) return null;

      const data = JSON.parse(raw);
      data.lastInteraction = new Date(data.lastInteraction);
      data.createdAt = new Date(data.createdAt);
      data.updatedAt = new Date(data.updatedAt);
      data.preferences = (data.preferences || []).map((p: any) => ({
        ...p,
        learnedAt: new Date(p.learnedAt),
      }));
      return data as HumanProfile;
    } catch (err) {
      Logger.error('[HumanBond] Failed to load profile:', err);
      return null;
    }
  }
}

export const humanBond = new HumanBond();
