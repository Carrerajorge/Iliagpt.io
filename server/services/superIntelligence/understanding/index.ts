/**
 * SUPERINTELLIGENCE - User Understanding Module
 * Sistema completo de entendimiento del usuario
 *
 * Componentes:
 * - IntentDetector: Detección de intenciones multi-idioma
 * - LongContextMemory: Memoria de contexto largo (>100k tokens)
 * - UserProfile: Perfil de usuario persistente
 * - EmotionDetector: Detección de emociones y sentimientos
 */

// Intent Detection
export {
  IntentDetector,
  intentDetector,
  type Intent,
  type IntentCategory,
  type IntentComplexity,
  type IntentAnalysisResult,
  type ExtractedEntity,
  type EntityType,
  type Language,
  type UserSentiment,
  type LanguageDetectionResult,
} from './IntentDetector';

// Long Context Memory
export {
  LongContextMemory,
  longContextMemory,
  type MemorySegment,
  type SegmentType,
  type SegmentMetadata,
  type ConversationContext,
  type ContextSummary,
  type KeyFact,
  type ContextWindow,
  type MemoryConfig,
  type CompressionStrategy,
} from './LongContextMemory';

// User Profile
export {
  UserProfileManager,
  userProfileManager,
  type UserProfile,
  type BasicInfo,
  type UserPreferences,
  type ResponseStyle,
  type DetailLevel,
  type CodeStylePreferences,
  type FormattingPreferences,
  type ExpertiseProfile,
  type ExpertiseLevel,
  type DomainExpertise,
  type Technology,
  type BehaviorProfile,
  type ActivityPatterns,
  type UsageMetrics,
  type CommunicationProfile,
  type FormalityLevel,
  type InterestProfile,
  type TopicInterest,
  type UserGoals,
  type Goal,
} from './UserProfile';

// Emotion Detection
export {
  EmotionDetector,
  emotionDetector,
  type PrimaryEmotion,
  type SecondaryEmotion,
  type SentimentPolarity,
  type EmotionScore,
  type EmotionAnalysis,
  type EmotionIndicator,
  type IndicatorType,
  type ContextualFactor,
  type ResponseRecommendation,
  type ResponseTone,
  type ResponseApproach,
} from './EmotionDetector';

// Initialization
import { intentDetector } from './IntentDetector';
import { longContextMemory } from './LongContextMemory';
import { userProfileManager } from './UserProfile';
import { emotionDetector } from './EmotionDetector';
import { Logger } from '../../../lib/logger';

export interface UnderstandingAnalysis {
  intent: ReturnType<typeof intentDetector.analyze> extends Promise<infer T> ? T : never;
  emotion: ReturnType<typeof emotionDetector.analyze>;
  userId: string;
  sessionId: string;
  timestamp: Date;
}

/**
 * Servicio unificado de análisis de usuario
 */
export class UserUnderstandingService {
  private static instance: UserUnderstandingService;

  private constructor() {}

  static getInstance(): UserUnderstandingService {
    if (!UserUnderstandingService.instance) {
      UserUnderstandingService.instance = new UserUnderstandingService();
    }
    return UserUnderstandingService.instance;
  }

  /**
   * Análisis completo de un mensaje de usuario
   */
  async analyzeMessage(
    text: string,
    userId: string,
    sessionId: string
  ): Promise<{
    intent: Awaited<ReturnType<typeof intentDetector.analyze>>;
    emotion: ReturnType<typeof emotionDetector.analyze>;
    profile: Awaited<ReturnType<typeof userProfileManager.getOrCreateProfile>>;
    context: Awaited<ReturnType<typeof longContextMemory.getContextWindow>>;
  }> {
    // Análisis en paralelo
    const [intent, profile] = await Promise.all([
      intentDetector.analyze(text, userId),
      userProfileManager.getOrCreateProfile(userId),
    ]);

    // Análisis de emoción (síncrono)
    const emotion = emotionDetector.analyze(text);

    // Obtener contexto
    const context = await longContextMemory.getContextWindow(sessionId);

    // Registrar actividad
    await userProfileManager.recordActivity(userId, {
      type: 'message',
      tokens: intent.estimatedTokens,
    });

    // Registrar tema de interés
    if (intent.primaryIntent.keywords.length > 0) {
      await userProfileManager.recordTopicInterest(userId, intent.primaryIntent.keywords[0]);
    }

    // Agregar mensaje a memoria
    await longContextMemory.addSegment(
      sessionId,
      text,
      'user_message',
      {
        topic: intent.primaryIntent.category,
        entities: intent.primaryIntent.entities.map(e => e.value),
        sentiment: emotion.sentiment,
        isKeyPoint: intent.primaryIntent.complexity === 'complex',
      }
    );

    return { intent, emotion, profile, context };
  }

  /**
   * Obtener recomendaciones de personalización
   */
  async getPersonalization(userId: string): Promise<{
    responseStyle: string;
    detailLevel: string;
    language: string;
    formality: string;
    expertise: string;
  }> {
    const profile = await userProfileManager.getOrCreateProfile(userId);
    const recommendations = userProfileManager.getPersonalizationRecommendations(profile);

    return {
      responseStyle: recommendations.responseStyle,
      detailLevel: recommendations.detailLevel,
      language: recommendations.language,
      formality: recommendations.formality,
      expertise: profile.expertise.level,
    };
  }

  /**
   * Procesar respuesta del asistente
   */
  async processAssistantResponse(
    sessionId: string,
    response: string,
    tokens: number
  ): Promise<void> {
    await longContextMemory.addSegment(
      sessionId,
      response,
      'assistant_response',
      { isKeyPoint: tokens > 500 }
    );
  }
}

// Singleton
export const userUnderstandingService = UserUnderstandingService.getInstance();

/**
 * Inicializar sistema de entendimiento
 */
export async function initializeUnderstandingSystem(): Promise<void> {
  Logger.info('[Understanding] Initializing SuperIntelligence Understanding System...');

  try {
    await intentDetector.restore();
    Logger.info('[Understanding] Intent detector initialized');

    Logger.info('[Understanding] Emotion detector initialized');
    Logger.info('[Understanding] User profile manager initialized');
    Logger.info('[Understanding] Long context memory initialized');

    Logger.info('[Understanding] SuperIntelligence Understanding System ready');
  } catch (error) {
    Logger.error('[Understanding] Error initializing understanding system:', error);
  }
}

/**
 * Shutdown sistema de entendimiento
 */
export async function shutdownUnderstandingSystem(): Promise<void> {
  Logger.info('[Understanding] Shutting down Understanding System...');

  try {
    await intentDetector.persist();
    Logger.info('[Understanding] Understanding System shutdown complete');
  } catch (error) {
    Logger.error('[Understanding] Error during shutdown:', error);
  }
}
