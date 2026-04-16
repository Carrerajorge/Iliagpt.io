/**
 * SUPERINTELLIGENCE - User Profile System
 * Sistema de perfil de usuario persistente con preferencias y comportamiento
 * Tarea 8: Desarrollar perfil de usuario persistente
 */

import { EventEmitter } from 'events';
import { Logger } from '../../../lib/logger';
import { redis } from '../../../lib/redis';
import { db } from '../../../db';
import { sql } from 'drizzle-orm';

// Tipos
export interface UserProfile {
  userId: string;
  basicInfo: BasicInfo;
  preferences: UserPreferences;
  expertise: ExpertiseProfile;
  behavior: BehaviorProfile;
  communication: CommunicationProfile;
  interests: InterestProfile;
  history: InteractionHistory;
  goals: UserGoals;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface BasicInfo {
  displayName?: string;
  timezone?: string;
  locale?: string;
  industry?: string;
  role?: string;
  company?: string;
}

export interface UserPreferences {
  responseStyle: ResponseStyle;
  detailLevel: DetailLevel;
  codeStyle: CodeStylePreferences;
  formatting: FormattingPreferences;
  notifications: NotificationPreferences;
  accessibility: AccessibilityPreferences;
}

export type ResponseStyle = 'concise' | 'detailed' | 'conversational' | 'technical' | 'adaptive';
export type DetailLevel = 'minimal' | 'moderate' | 'comprehensive';

export interface CodeStylePreferences {
  preferredLanguages: string[];
  indentation: 'spaces' | 'tabs';
  indentSize: number;
  quoteStyle: 'single' | 'double';
  semicolons: boolean;
  includeComments: boolean;
  includeTypes: boolean; // TypeScript types
}

export interface FormattingPreferences {
  useMarkdown: boolean;
  useBulletPoints: boolean;
  useCodeBlocks: boolean;
  useEmoji: boolean;
  preferredDateFormat: string;
  preferredNumberFormat: string;
}

export interface NotificationPreferences {
  emailSummaries: boolean;
  taskReminders: boolean;
  progressUpdates: boolean;
}

export interface AccessibilityPreferences {
  highContrast: boolean;
  largeText: boolean;
  screenReaderOptimized: boolean;
  reduceMotion: boolean;
}

export interface ExpertiseProfile {
  level: ExpertiseLevel;
  domains: DomainExpertise[];
  knownTechnologies: Technology[];
  learningPath: LearningItem[];
}

export type ExpertiseLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export interface DomainExpertise {
  domain: string;
  level: ExpertiseLevel;
  confidence: number;
  lastAssessed: Date;
}

export interface Technology {
  name: string;
  proficiency: number; // 0-1
  lastUsed: Date;
  projectCount: number;
}

export interface LearningItem {
  topic: string;
  status: 'interested' | 'learning' | 'learned';
  startedAt?: Date;
  completedAt?: Date;
}

export interface BehaviorProfile {
  activityPatterns: ActivityPatterns;
  usageMetrics: UsageMetrics;
  workflowPreferences: WorkflowPreferences;
}

export interface ActivityPatterns {
  mostActiveHours: number[]; // 0-23
  mostActiveDays: number[]; // 0-6 (Sunday = 0)
  averageSessionDuration: number; // minutes
  peakProductivityTime?: string;
}

export interface UsageMetrics {
  totalSessions: number;
  totalMessages: number;
  totalTokensUsed: number;
  averageMessagesPerSession: number;
  featuresUsed: Record<string, number>;
  lastSessionAt: Date;
}

export interface WorkflowPreferences {
  preferredAgents: string[];
  commonTasks: string[];
  shortcuts: UserShortcut[];
  templates: UserTemplate[];
}

export interface UserShortcut {
  trigger: string;
  action: string;
  description: string;
}

export interface UserTemplate {
  name: string;
  content: string;
  category: string;
  usageCount: number;
}

export interface CommunicationProfile {
  preferredLanguage: string;
  formalityLevel: FormalityLevel;
  responseLength: ResponseLengthPreference;
  explanationStyle: ExplanationStyle;
  feedbackStyle: FeedbackStyle;
}

export type FormalityLevel = 'casual' | 'neutral' | 'formal' | 'professional';
export type ResponseLengthPreference = 'short' | 'medium' | 'long' | 'adaptive';
export type ExplanationStyle = 'step-by-step' | 'overview-first' | 'examples-first' | 'theory-first';
export type FeedbackStyle = 'direct' | 'encouraging' | 'balanced' | 'socratic';

export interface InterestProfile {
  topics: TopicInterest[];
  categories: CategoryInterest[];
  recentSearches: string[];
  bookmarkedContent: string[];
}

export interface TopicInterest {
  topic: string;
  weight: number; // 0-1
  lastEngaged: Date;
  engagementCount: number;
}

export interface CategoryInterest {
  category: string;
  weight: number;
  subtopics: string[];
}

export interface InteractionHistory {
  recentTopics: string[];
  frequentQuestions: FrequentQuestion[];
  satisfactionHistory: SatisfactionRecord[];
  feedbackGiven: FeedbackRecord[];
}

export interface FrequentQuestion {
  question: string;
  count: number;
  lastAsked: Date;
  wasResolved: boolean;
}

export interface SatisfactionRecord {
  sessionId: string;
  rating: number; // 1-5
  feedback?: string;
  timestamp: Date;
}

export interface FeedbackRecord {
  type: 'positive' | 'negative' | 'suggestion';
  content: string;
  context?: string;
  timestamp: Date;
}

export interface UserGoals {
  shortTerm: Goal[];
  longTerm: Goal[];
  completedGoals: CompletedGoal[];
}

export interface Goal {
  id: string;
  title: string;
  description?: string;
  targetDate?: Date;
  progress: number; // 0-100
  milestones: Milestone[];
  createdAt: Date;
}

export interface Milestone {
  title: string;
  completed: boolean;
  completedAt?: Date;
}

export interface CompletedGoal extends Goal {
  completedAt: Date;
  reflection?: string;
}

// Eventos de actualización
export interface ProfileUpdateEvent {
  userId: string;
  field: string;
  oldValue: any;
  newValue: any;
  timestamp: Date;
}

export class UserProfileManager extends EventEmitter {
  private static instance: UserProfileManager;
  private profiles: Map<string, UserProfile> = new Map();
  private readonly REDIS_PREFIX = 'user:profile:';
  private readonly CACHE_TTL = 3600; // 1 hour

  private constructor() {
    super();
  }

  static getInstance(): UserProfileManager {
    if (!UserProfileManager.instance) {
      UserProfileManager.instance = new UserProfileManager();
    }
    return UserProfileManager.instance;
  }

  // Obtener o crear perfil
  async getOrCreateProfile(userId: string): Promise<UserProfile> {
    // Intentar desde cache en memoria
    let profile = this.profiles.get(userId);
    if (profile) return profile;

    // Intentar desde Redis
    profile = await this.loadFromRedis(userId);
    if (profile) {
      this.profiles.set(userId, profile);
      return profile;
    }

    // Intentar desde base de datos
    profile = await this.loadFromDatabase(userId);
    if (profile) {
      this.profiles.set(userId, profile);
      await this.saveToRedis(profile);
      return profile;
    }

    // Crear nuevo perfil
    profile = this.createDefaultProfile(userId);
    this.profiles.set(userId, profile);
    await this.saveProfile(profile);

    return profile;
  }

  // Crear perfil por defecto
  private createDefaultProfile(userId: string): UserProfile {
    return {
      userId,
      basicInfo: {},
      preferences: {
        responseStyle: 'adaptive',
        detailLevel: 'moderate',
        codeStyle: {
          preferredLanguages: ['typescript', 'javascript'],
          indentation: 'spaces',
          indentSize: 2,
          quoteStyle: 'single',
          semicolons: true,
          includeComments: true,
          includeTypes: true,
        },
        formatting: {
          useMarkdown: true,
          useBulletPoints: true,
          useCodeBlocks: true,
          useEmoji: false,
          preferredDateFormat: 'YYYY-MM-DD',
          preferredNumberFormat: 'en-US',
        },
        notifications: {
          emailSummaries: false,
          taskReminders: true,
          progressUpdates: true,
        },
        accessibility: {
          highContrast: false,
          largeText: false,
          screenReaderOptimized: false,
          reduceMotion: false,
        },
      },
      expertise: {
        level: 'intermediate',
        domains: [],
        knownTechnologies: [],
        learningPath: [],
      },
      behavior: {
        activityPatterns: {
          mostActiveHours: [],
          mostActiveDays: [],
          averageSessionDuration: 0,
        },
        usageMetrics: {
          totalSessions: 0,
          totalMessages: 0,
          totalTokensUsed: 0,
          averageMessagesPerSession: 0,
          featuresUsed: {},
          lastSessionAt: new Date(),
        },
        workflowPreferences: {
          preferredAgents: [],
          commonTasks: [],
          shortcuts: [],
          templates: [],
        },
      },
      communication: {
        preferredLanguage: 'es',
        formalityLevel: 'neutral',
        responseLength: 'adaptive',
        explanationStyle: 'step-by-step',
        feedbackStyle: 'balanced',
      },
      interests: {
        topics: [],
        categories: [],
        recentSearches: [],
        bookmarkedContent: [],
      },
      history: {
        recentTopics: [],
        frequentQuestions: [],
        satisfactionHistory: [],
        feedbackGiven: [],
      },
      goals: {
        shortTerm: [],
        longTerm: [],
        completedGoals: [],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    };
  }

  // Actualizar perfil
  async updateProfile(
    userId: string,
    updates: Partial<UserProfile>
  ): Promise<UserProfile> {
    const profile = await this.getOrCreateProfile(userId);

    // Aplicar actualizaciones
    const updatedProfile = this.deepMerge(profile, updates);
    updatedProfile.updatedAt = new Date();
    updatedProfile.version++;

    this.profiles.set(userId, updatedProfile);
    await this.saveProfile(updatedProfile);

    this.emit('profile-updated', {
      userId,
      updates,
      timestamp: new Date(),
    });

    return updatedProfile;
  }

  // Actualizar preferencias
  async updatePreferences(
    userId: string,
    preferences: Partial<UserPreferences>
  ): Promise<UserProfile> {
    return this.updateProfile(userId, { preferences } as any);
  }

  // Registrar actividad
  async recordActivity(
    userId: string,
    activity: {
      type: 'message' | 'session_start' | 'session_end' | 'feature_use';
      feature?: string;
      tokens?: number;
      duration?: number;
    }
  ): Promise<void> {
    const profile = await this.getOrCreateProfile(userId);
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    // Actualizar patrones de actividad
    if (!profile.behavior.activityPatterns.mostActiveHours.includes(hour)) {
      profile.behavior.activityPatterns.mostActiveHours.push(hour);
      profile.behavior.activityPatterns.mostActiveHours =
        profile.behavior.activityPatterns.mostActiveHours.slice(-24);
    }
    if (!profile.behavior.activityPatterns.mostActiveDays.includes(day)) {
      profile.behavior.activityPatterns.mostActiveDays.push(day);
    }

    // Actualizar métricas
    switch (activity.type) {
      case 'message':
        profile.behavior.usageMetrics.totalMessages++;
        if (activity.tokens) {
          profile.behavior.usageMetrics.totalTokensUsed += activity.tokens;
        }
        break;
      case 'session_start':
        profile.behavior.usageMetrics.totalSessions++;
        profile.behavior.usageMetrics.lastSessionAt = now;
        break;
      case 'session_end':
        if (activity.duration) {
          const currentAvg = profile.behavior.activityPatterns.averageSessionDuration;
          const sessions = profile.behavior.usageMetrics.totalSessions;
          profile.behavior.activityPatterns.averageSessionDuration =
            (currentAvg * (sessions - 1) + activity.duration) / sessions;
        }
        break;
      case 'feature_use':
        if (activity.feature) {
          profile.behavior.usageMetrics.featuresUsed[activity.feature] =
            (profile.behavior.usageMetrics.featuresUsed[activity.feature] || 0) + 1;
        }
        break;
    }

    // Actualizar promedio de mensajes por sesión
    if (profile.behavior.usageMetrics.totalSessions > 0) {
      profile.behavior.usageMetrics.averageMessagesPerSession =
        profile.behavior.usageMetrics.totalMessages / profile.behavior.usageMetrics.totalSessions;
    }

    profile.updatedAt = now;
    this.profiles.set(userId, profile);

    // Guardar en Redis (debounced)
    this.debouncedSaveToRedis(profile);
  }

  // Registrar interés en tema
  async recordTopicInterest(userId: string, topic: string): Promise<void> {
    const profile = await this.getOrCreateProfile(userId);

    const existingTopic = profile.interests.topics.find(t => t.topic === topic);
    if (existingTopic) {
      existingTopic.weight = Math.min(1, existingTopic.weight + 0.1);
      existingTopic.lastEngaged = new Date();
      existingTopic.engagementCount++;
    } else {
      profile.interests.topics.push({
        topic,
        weight: 0.5,
        lastEngaged: new Date(),
        engagementCount: 1,
      });
    }

    // Limitar y ordenar por peso
    profile.interests.topics.sort((a, b) => b.weight - a.weight);
    profile.interests.topics = profile.interests.topics.slice(0, 50);

    // Actualizar temas recientes
    profile.history.recentTopics = [
      topic,
      ...profile.history.recentTopics.filter(t => t !== topic),
    ].slice(0, 20);

    this.profiles.set(userId, profile);
    this.debouncedSaveToRedis(profile);
  }

  // Detectar y actualizar expertise
  async updateExpertise(
    userId: string,
    domain: string,
    indicators: {
      usesAdvancedTerminology?: boolean;
      asksBeginneerQuestions?: boolean;
      solvesProblemIndependently?: boolean;
      complexityOfQueries?: 'low' | 'medium' | 'high';
    }
  ): Promise<void> {
    const profile = await this.getOrCreateProfile(userId);

    let domainExpertise = profile.expertise.domains.find(d => d.domain === domain);
    if (!domainExpertise) {
      domainExpertise = {
        domain,
        level: 'intermediate',
        confidence: 0.5,
        lastAssessed: new Date(),
      };
      profile.expertise.domains.push(domainExpertise);
    }

    // Ajustar nivel basado en indicadores
    let levelScore = this.levelToScore(domainExpertise.level);

    if (indicators.usesAdvancedTerminology) levelScore += 0.1;
    if (indicators.asksBeginneerQuestions) levelScore -= 0.15;
    if (indicators.solvesProblemIndependently) levelScore += 0.05;

    if (indicators.complexityOfQueries === 'high') levelScore += 0.1;
    else if (indicators.complexityOfQueries === 'low') levelScore -= 0.05;

    domainExpertise.level = this.scoreToLevel(levelScore);
    domainExpertise.confidence = Math.min(1, domainExpertise.confidence + 0.05);
    domainExpertise.lastAssessed = new Date();

    // Actualizar nivel general
    const avgScore = profile.expertise.domains.reduce(
      (sum, d) => sum + this.levelToScore(d.level),
      0
    ) / Math.max(profile.expertise.domains.length, 1);
    profile.expertise.level = this.scoreToLevel(avgScore);

    this.profiles.set(userId, profile);
    this.debouncedSaveToRedis(profile);
  }

  // Registrar tecnología usada
  async recordTechnologyUse(userId: string, technology: string): Promise<void> {
    const profile = await this.getOrCreateProfile(userId);

    let tech = profile.expertise.knownTechnologies.find(t => t.name === technology);
    if (tech) {
      tech.proficiency = Math.min(1, tech.proficiency + 0.05);
      tech.lastUsed = new Date();
      tech.projectCount++;
    } else {
      profile.expertise.knownTechnologies.push({
        name: technology,
        proficiency: 0.3,
        lastUsed: new Date(),
        projectCount: 1,
      });
    }

    // Actualizar preferencias de código
    if (!profile.preferences.codeStyle.preferredLanguages.includes(technology)) {
      profile.preferences.codeStyle.preferredLanguages.push(technology);
      profile.preferences.codeStyle.preferredLanguages =
        profile.preferences.codeStyle.preferredLanguages.slice(0, 10);
    }

    this.profiles.set(userId, profile);
    this.debouncedSaveToRedis(profile);
  }

  // Registrar feedback
  async recordFeedback(
    userId: string,
    feedback: {
      type: 'positive' | 'negative' | 'suggestion';
      content: string;
      context?: string;
      rating?: number;
      sessionId?: string;
    }
  ): Promise<void> {
    const profile = await this.getOrCreateProfile(userId);

    profile.history.feedbackGiven.push({
      type: feedback.type,
      content: feedback.content,
      context: feedback.context,
      timestamp: new Date(),
    });

    if (feedback.rating && feedback.sessionId) {
      profile.history.satisfactionHistory.push({
        sessionId: feedback.sessionId,
        rating: feedback.rating,
        feedback: feedback.content,
        timestamp: new Date(),
      });
    }

    // Limitar historial
    profile.history.feedbackGiven = profile.history.feedbackGiven.slice(-100);
    profile.history.satisfactionHistory = profile.history.satisfactionHistory.slice(-50);

    this.profiles.set(userId, profile);
    await this.saveProfile(profile);
  }

  // Obtener recomendaciones de personalización
  getPersonalizationRecommendations(profile: UserProfile): {
    responseStyle: ResponseStyle;
    detailLevel: DetailLevel;
    language: string;
    includeCodeComments: boolean;
    useExamples: boolean;
    formality: FormalityLevel;
  } {
    return {
      responseStyle: profile.preferences.responseStyle,
      detailLevel: profile.preferences.detailLevel,
      language: profile.communication.preferredLanguage,
      includeCodeComments: profile.preferences.codeStyle.includeComments,
      useExamples: profile.communication.explanationStyle === 'examples-first',
      formality: profile.communication.formalityLevel,
    };
  }

  // Calcular score de satisfacción
  calculateSatisfactionScore(userId: string): number {
    const profile = this.profiles.get(userId);
    if (!profile || profile.history.satisfactionHistory.length === 0) {
      return 0.8; // Default positivo
    }

    // Promedio ponderado (más peso a recientes)
    const history = profile.history.satisfactionHistory.slice(-20);
    let weightedSum = 0;
    let weightSum = 0;

    history.forEach((record, index) => {
      const weight = index + 1; // Más reciente = más peso
      weightedSum += record.rating * weight;
      weightSum += weight;
    });

    return weightedSum / weightSum / 5; // Normalizar a 0-1
  }

  // Helpers
  private levelToScore(level: ExpertiseLevel): number {
    const scores: Record<ExpertiseLevel, number> = {
      'beginner': 0.2,
      'intermediate': 0.5,
      'advanced': 0.75,
      'expert': 1.0,
    };
    return scores[level];
  }

  private scoreToLevel(score: number): ExpertiseLevel {
    if (score >= 0.85) return 'expert';
    if (score >= 0.6) return 'advanced';
    if (score >= 0.35) return 'intermediate';
    return 'beginner';
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else if (source[key] !== undefined) {
        result[key] = source[key];
      }
    }

    return result;
  }

  // Persistencia
  private saveTimeouts: Map<string, NodeJS.Timeout> = new Map();

  private debouncedSaveToRedis(profile: UserProfile): void {
    const existing = this.saveTimeouts.get(profile.userId);
    if (existing) clearTimeout(existing);

    const timeout = setTimeout(() => {
      this.saveToRedis(profile);
      this.saveTimeouts.delete(profile.userId);
    }, 5000); // Debounce 5 segundos

    this.saveTimeouts.set(profile.userId, timeout);
  }

  private async saveToRedis(profile: UserProfile): Promise<void> {
    try {
      await redis.setex(
        `${this.REDIS_PREFIX}${profile.userId}`,
        this.CACHE_TTL,
        JSON.stringify(profile)
      );
    } catch (error) {
      Logger.error('[UserProfile] Error saving to Redis:', error);
    }
  }

  private async loadFromRedis(userId: string): Promise<UserProfile | null> {
    try {
      const data = await redis.get(`${this.REDIS_PREFIX}${userId}`);
      if (!data) return null;

      const profile = JSON.parse(data);
      // Restaurar fechas
      profile.createdAt = new Date(profile.createdAt);
      profile.updatedAt = new Date(profile.updatedAt);
      return profile;
    } catch (error) {
      Logger.error('[UserProfile] Error loading from Redis:', error);
      return null;
    }
  }

  private async loadFromDatabase(userId: string): Promise<UserProfile | null> {
    try {
      const result = await db.execute(
        sql`SELECT profile_data FROM user_profiles WHERE user_id = ${userId}`
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0] as any;
      return JSON.parse(row.profile_data);
    } catch (error) {
      // Tabla puede no existir
      Logger.debug('[UserProfile] Error loading from DB (may not exist):', error);
      return null;
    }
  }

  private async saveProfile(profile: UserProfile): Promise<void> {
    await this.saveToRedis(profile);

    // También guardar en DB para persistencia a largo plazo
    try {
      await db.execute(sql`
        INSERT INTO user_profiles (user_id, profile_data, updated_at)
        VALUES (${profile.userId}, ${JSON.stringify(profile)}::jsonb, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET profile_data = ${JSON.stringify(profile)}::jsonb, updated_at = NOW()
      `);
    } catch (error) {
      // Ignorar si la tabla no existe
      Logger.debug('[UserProfile] Could not save to DB:', error);
    }
  }

  // Exportar perfil
  exportProfile(userId: string): UserProfile | null {
    return this.profiles.get(userId) || null;
  }

  // Eliminar perfil
  async deleteProfile(userId: string): Promise<void> {
    this.profiles.delete(userId);
    await redis.del(`${this.REDIS_PREFIX}${userId}`);

    try {
      await db.execute(sql`DELETE FROM user_profiles WHERE user_id = ${userId}`);
    } catch (error) {
      Logger.debug('[UserProfile] Could not delete from DB:', error);
    }
  }
}

// Singleton export
export const userProfileManager = UserProfileManager.getInstance();
