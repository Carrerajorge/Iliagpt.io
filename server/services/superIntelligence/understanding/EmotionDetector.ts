/**
 * SUPERINTELLIGENCE - Emotion Detector
 * Sistema de detección de emociones en texto con análisis de sentimiento
 * Tarea 9: Implementar detección de emociones
 */

import { EventEmitter } from 'events';
import { Logger } from '../../../lib/logger';

// Tipos de emociones (basado en rueda de Plutchik)
export type PrimaryEmotion =
  | 'joy'           // Alegría
  | 'trust'         // Confianza
  | 'fear'          // Miedo
  | 'surprise'      // Sorpresa
  | 'sadness'       // Tristeza
  | 'disgust'       // Disgusto
  | 'anger'         // Ira
  | 'anticipation'; // Anticipación

export type SecondaryEmotion =
  | 'love'          // Alegría + Confianza
  | 'submission'    // Confianza + Miedo
  | 'awe'           // Miedo + Sorpresa
  | 'disapproval'   // Sorpresa + Tristeza
  | 'remorse'       // Tristeza + Disgusto
  | 'contempt'      // Disgusto + Ira
  | 'aggressiveness' // Ira + Anticipación
  | 'optimism';     // Anticipación + Alegría

export type SentimentPolarity = 'very_negative' | 'negative' | 'neutral' | 'positive' | 'very_positive';

export interface EmotionScore {
  emotion: PrimaryEmotion | SecondaryEmotion;
  intensity: number; // 0-1
  confidence: number; // 0-1
}

export interface EmotionAnalysis {
  primaryEmotion: EmotionScore | null;
  secondaryEmotions: EmotionScore[];
  sentiment: SentimentPolarity;
  sentimentScore: number; // -1 a 1
  arousal: number; // 0-1 (activación emocional)
  valence: number; // -1 a 1 (positivo/negativo)
  dominance: number; // 0-1 (control/poder)
  indicators: EmotionIndicator[];
  contextualFactors: ContextualFactor[];
  recommendedResponse: ResponseRecommendation;
  timestamp: Date;
}

export interface EmotionIndicator {
  type: IndicatorType;
  value: string;
  emotion: PrimaryEmotion;
  weight: number;
}

export type IndicatorType =
  | 'lexical'       // Palabras emocionales
  | 'punctuation'   // Puntuación (!, ?, ...)
  | 'caps'          // Mayúsculas
  | 'emoji'         // Emojis
  | 'intensifier'   // Intensificadores (muy, mucho, etc.)
  | 'negation'      // Negaciones
  | 'repetition';   // Repeticiones

export interface ContextualFactor {
  factor: string;
  impact: 'positive' | 'negative' | 'neutral';
  description: string;
}

export interface ResponseRecommendation {
  tone: ResponseTone;
  approach: ResponseApproach;
  suggestions: string[];
  avoidTopics: string[];
  prioritizeEmpathy: boolean;
}

export type ResponseTone = 'empathetic' | 'professional' | 'encouraging' | 'calm' | 'enthusiastic' | 'supportive';
export type ResponseApproach = 'solution-focused' | 'active-listening' | 'validation' | 'information' | 'celebration';

// Lexicón de emociones multilingüe
const EMOTION_LEXICON: Record<string, { emotion: PrimaryEmotion; intensity: number }[]> = {
  // Español - Alegría
  'feliz': [{ emotion: 'joy', intensity: 0.8 }],
  'contento': [{ emotion: 'joy', intensity: 0.7 }],
  'alegre': [{ emotion: 'joy', intensity: 0.8 }],
  'encantado': [{ emotion: 'joy', intensity: 0.9 }],
  'genial': [{ emotion: 'joy', intensity: 0.7 }],
  'excelente': [{ emotion: 'joy', intensity: 0.8 }],
  'maravilloso': [{ emotion: 'joy', intensity: 0.9 }],
  'fantástico': [{ emotion: 'joy', intensity: 0.85 }],
  'increíble': [{ emotion: 'joy', intensity: 0.8 }, { emotion: 'surprise', intensity: 0.5 }],

  // Español - Tristeza
  'triste': [{ emotion: 'sadness', intensity: 0.8 }],
  'deprimido': [{ emotion: 'sadness', intensity: 0.9 }],
  'desanimado': [{ emotion: 'sadness', intensity: 0.7 }],
  'decepcionado': [{ emotion: 'sadness', intensity: 0.75 }],
  'frustrado': [{ emotion: 'sadness', intensity: 0.6 }, { emotion: 'anger', intensity: 0.5 }],
  'aburrido': [{ emotion: 'sadness', intensity: 0.4 }],

  // Español - Ira
  'enojado': [{ emotion: 'anger', intensity: 0.8 }],
  'furioso': [{ emotion: 'anger', intensity: 0.95 }],
  'molesto': [{ emotion: 'anger', intensity: 0.6 }],
  'irritado': [{ emotion: 'anger', intensity: 0.7 }],
  'indignado': [{ emotion: 'anger', intensity: 0.8 }],
  'harto': [{ emotion: 'anger', intensity: 0.7 }, { emotion: 'disgust', intensity: 0.5 }],

  // Español - Miedo
  'miedo': [{ emotion: 'fear', intensity: 0.8 }],
  'asustado': [{ emotion: 'fear', intensity: 0.8 }],
  'preocupado': [{ emotion: 'fear', intensity: 0.6 }],
  // Can mean both anxious (fear) and eager (anticipation) depending on context.
  'ansioso': [{ emotion: 'fear', intensity: 0.7 }, { emotion: 'anticipation', intensity: 0.6 }],
  'nervioso': [{ emotion: 'fear', intensity: 0.6 }],
  'aterrorizado': [{ emotion: 'fear', intensity: 0.95 }],

  // Español - Sorpresa
  'sorprendido': [{ emotion: 'surprise', intensity: 0.8 }],
  'asombrado': [{ emotion: 'surprise', intensity: 0.85 }],
  'impactado': [{ emotion: 'surprise', intensity: 0.9 }],
  'inesperado': [{ emotion: 'surprise', intensity: 0.7 }],

  // Español - Confianza
  'seguro': [{ emotion: 'trust', intensity: 0.7 }],
  'confiado': [{ emotion: 'trust', intensity: 0.8 }],
  'tranquilo': [{ emotion: 'trust', intensity: 0.6 }],

  // Español - Disgusto
  'asqueroso': [{ emotion: 'disgust', intensity: 0.9 }],
  'horrible': [{ emotion: 'disgust', intensity: 0.8 }],
  'desagradable': [{ emotion: 'disgust', intensity: 0.7 }],

  // Español - Anticipación
  'emocionado': [{ emotion: 'anticipation', intensity: 0.8 }, { emotion: 'joy', intensity: 0.5 }],
  'esperando': [{ emotion: 'anticipation', intensity: 0.5 }],

  // English - Joy
  'happy': [{ emotion: 'joy', intensity: 0.8 }],
  'glad': [{ emotion: 'joy', intensity: 0.7 }],
  'joyful': [{ emotion: 'joy', intensity: 0.85 }],
  'delighted': [{ emotion: 'joy', intensity: 0.9 }],
  'great': [{ emotion: 'joy', intensity: 0.7 }],
  'excellent': [{ emotion: 'joy', intensity: 0.8 }],
  'wonderful': [{ emotion: 'joy', intensity: 0.9 }],
  'fantastic': [{ emotion: 'joy', intensity: 0.85 }],
  'amazing': [{ emotion: 'joy', intensity: 0.8 }, { emotion: 'surprise', intensity: 0.5 }],
  'love': [{ emotion: 'joy', intensity: 0.9 }, { emotion: 'trust', intensity: 0.8 }],
  'awesome': [{ emotion: 'joy', intensity: 0.85 }],

  // English - Sadness
  'sad': [{ emotion: 'sadness', intensity: 0.8 }],
  'depressed': [{ emotion: 'sadness', intensity: 0.9 }],
  'disappointed': [{ emotion: 'sadness', intensity: 0.75 }],
  'frustrated': [{ emotion: 'sadness', intensity: 0.6 }, { emotion: 'anger', intensity: 0.5 }],
  'bored': [{ emotion: 'sadness', intensity: 0.4 }],
  'unhappy': [{ emotion: 'sadness', intensity: 0.75 }],

  // English - Anger
  'angry': [{ emotion: 'anger', intensity: 0.8 }],
  'furious': [{ emotion: 'anger', intensity: 0.95 }],
  'annoyed': [{ emotion: 'anger', intensity: 0.6 }],
  'irritated': [{ emotion: 'anger', intensity: 0.7 }],
  'mad': [{ emotion: 'anger', intensity: 0.75 }],
  'hate': [{ emotion: 'anger', intensity: 0.9 }, { emotion: 'disgust', intensity: 0.7 }],

  // English - Fear
  'afraid': [{ emotion: 'fear', intensity: 0.8 }],
  'scared': [{ emotion: 'fear', intensity: 0.8 }],
  'worried': [{ emotion: 'fear', intensity: 0.6 }],
  'anxious': [{ emotion: 'fear', intensity: 0.7 }],
  'nervous': [{ emotion: 'fear', intensity: 0.6 }],
  'terrified': [{ emotion: 'fear', intensity: 0.95 }],

  // English - Surprise
  'surprised': [{ emotion: 'surprise', intensity: 0.8 }],
  'amazed': [{ emotion: 'surprise', intensity: 0.85 }],
  'shocked': [{ emotion: 'surprise', intensity: 0.9 }],
  'unexpected': [{ emotion: 'surprise', intensity: 0.7 }],
  'wow': [{ emotion: 'surprise', intensity: 0.75 }, { emotion: 'joy', intensity: 0.5 }],

  // English - Trust
  'confident': [{ emotion: 'trust', intensity: 0.8 }],
  'secure': [{ emotion: 'trust', intensity: 0.7 }],
  'calm': [{ emotion: 'trust', intensity: 0.6 }],

  // English - Disgust
  'disgusted': [{ emotion: 'disgust', intensity: 0.9 }],
  'awful': [{ emotion: 'disgust', intensity: 0.75 }],
  'gross': [{ emotion: 'disgust', intensity: 0.7 }],

  // English - Anticipation
  'excited': [{ emotion: 'anticipation', intensity: 0.8 }, { emotion: 'joy', intensity: 0.5 }],
  'eager': [{ emotion: 'anticipation', intensity: 0.7 }],
  'looking forward': [{ emotion: 'anticipation', intensity: 0.7 }],
};

// Emoji a emoción
const EMOJI_EMOTIONS: Record<string, { emotion: PrimaryEmotion; intensity: number }> = {
  '😊': { emotion: 'joy', intensity: 0.7 },
  '😄': { emotion: 'joy', intensity: 0.8 },
  '😁': { emotion: 'joy', intensity: 0.75 },
  '🎉': { emotion: 'joy', intensity: 0.8 },
  '❤️': { emotion: 'joy', intensity: 0.85 },
  '💕': { emotion: 'joy', intensity: 0.85 },
  '🥰': { emotion: 'joy', intensity: 0.9 },
  '😍': { emotion: 'joy', intensity: 0.85 },
  '👍': { emotion: 'joy', intensity: 0.6 },
  '🙏': { emotion: 'trust', intensity: 0.7 },

  '😢': { emotion: 'sadness', intensity: 0.8 },
  '😭': { emotion: 'sadness', intensity: 0.9 },
  '😞': { emotion: 'sadness', intensity: 0.7 },
  '😔': { emotion: 'sadness', intensity: 0.65 },
  '💔': { emotion: 'sadness', intensity: 0.85 },

  '😠': { emotion: 'anger', intensity: 0.8 },
  '😡': { emotion: 'anger', intensity: 0.9 },
  '🤬': { emotion: 'anger', intensity: 0.95 },
  '😤': { emotion: 'anger', intensity: 0.7 },
  '👎': { emotion: 'anger', intensity: 0.5 },

  '😨': { emotion: 'fear', intensity: 0.8 },
  '😱': { emotion: 'fear', intensity: 0.9 },
  '😰': { emotion: 'fear', intensity: 0.7 },
  '😥': { emotion: 'fear', intensity: 0.6 },

  '😮': { emotion: 'surprise', intensity: 0.7 },
  '😲': { emotion: 'surprise', intensity: 0.8 },
  '🤯': { emotion: 'surprise', intensity: 0.9 },
  '😳': { emotion: 'surprise', intensity: 0.75 },

  '🤢': { emotion: 'disgust', intensity: 0.8 },
  '🤮': { emotion: 'disgust', intensity: 0.9 },
  '😒': { emotion: 'disgust', intensity: 0.5 },
};

// Intensificadores
const INTENSIFIERS: Record<string, number> = {
  // Español
  'muy': 1.3,
  'mucho': 1.25,
  'bastante': 1.2,
  'extremadamente': 1.5,
  'increíblemente': 1.4,
  'totalmente': 1.35,
  'completamente': 1.35,
  'absolutamente': 1.4,
  'super': 1.3,
  'súper': 1.3,
  'demasiado': 1.3,
  // English
  'very': 1.3,
  'really': 1.25,
  'extremely': 1.5,
  'incredibly': 1.4,
  'totally': 1.35,
  'completely': 1.35,
  'absolutely': 1.4,
  'so': 1.2,
  'too': 1.25,
  'quite': 1.15,
};

// Negaciones
const NEGATIONS = new Set([
  // Español
  'no', 'nunca', 'jamás', 'tampoco', 'ninguno', 'ninguna', 'nada', 'nadie', 'sin',
  // English
  'not', 'never', "n't", "don't", "doesn't", "didn't", "won't", "wouldn't", "can't", "couldn't", 'no', 'none', 'nothing', 'nobody', 'without',
]);

export class EmotionDetector extends EventEmitter {
  private static instance: EmotionDetector;

  private constructor() {
    super();
  }

  static getInstance(): EmotionDetector {
    if (!EmotionDetector.instance) {
      EmotionDetector.instance = new EmotionDetector();
    }
    return EmotionDetector.instance;
  }

  // Analizar emociones en texto
  analyze(text: string, context?: { previousEmotions?: EmotionAnalysis[] }): EmotionAnalysis {
    const indicators: EmotionIndicator[] = [];
    const emotionScores = new Map<PrimaryEmotion, { total: number; count: number }>();

    // Normalizar texto
    const normalizedText = text.toLowerCase();
    const words = this.tokenize(normalizedText);

    // 1. Análisis léxico
    let negationActive = false;
    let intensifierMultiplier = 1;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];

      // Detectar negación
      if (NEGATIONS.has(word)) {
        negationActive = true;
        continue;
      }

      // Detectar intensificador
      if (INTENSIFIERS[word]) {
        intensifierMultiplier = INTENSIFIERS[word];
        continue;
      }

      // Buscar en lexicón
      const emotions = EMOTION_LEXICON[word];
      if (emotions) {
        for (const { emotion, intensity } of emotions) {
          let finalIntensity = intensity * intensifierMultiplier;

          // Invertir si hay negación
          if (negationActive) {
            const oppositeEmotion = this.getOppositeEmotion(emotion);
            this.addToEmotionScore(emotionScores, oppositeEmotion, finalIntensity * 0.5);
            indicators.push({
              type: 'negation',
              value: word,
              emotion: oppositeEmotion,
              weight: finalIntensity * 0.5,
            });
          } else {
            this.addToEmotionScore(emotionScores, emotion, finalIntensity);
            indicators.push({
              type: 'lexical',
              value: word,
              emotion,
              weight: finalIntensity,
            });
          }
        }
      }

      // Reset después de procesar palabra significativa
      if (emotions) {
        negationActive = false;
        intensifierMultiplier = 1;
      }
    }

    // 2. Análisis de emojis
    const emojiMatches = text.match(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/gu) || [];
    for (const emoji of emojiMatches) {
      const emojiEmotion = EMOJI_EMOTIONS[emoji];
      if (emojiEmotion) {
        this.addToEmotionScore(emotionScores, emojiEmotion.emotion, emojiEmotion.intensity);
        indicators.push({
          type: 'emoji',
          value: emoji,
          emotion: emojiEmotion.emotion,
          weight: emojiEmotion.intensity,
        });
      }
    }

    // 3. Análisis de puntuación
    const exclamations = (text.match(/!/g) || []).length;
    const questions = (text.match(/\?/g) || []).length;

    if (exclamations > 0) {
      const intensity = Math.min(0.5, exclamations * 0.15);
      // Exclamaciones amplifican la emoción dominante o indican emoción fuerte
      const dominantEmotion = this.getDominantEmotion(emotionScores);
      if (dominantEmotion) {
        this.addToEmotionScore(emotionScores, dominantEmotion, intensity);
        indicators.push({
          type: 'punctuation',
          value: '!'.repeat(exclamations),
          emotion: dominantEmotion,
          weight: intensity,
        });
      }
    }

    if (questions > 1) {
      this.addToEmotionScore(emotionScores, 'surprise', 0.2);
      indicators.push({
        type: 'punctuation',
        value: '?'.repeat(questions),
        emotion: 'surprise',
        weight: 0.2,
      });
    }

    // 4. Análisis de mayúsculas
    const capsRatio = this.calculateCapsRatio(text);
    if (capsRatio > 0.3) {
      const intensity = Math.min(0.4, capsRatio * 0.5);
      this.addToEmotionScore(emotionScores, 'anger', intensity);
      indicators.push({
        type: 'caps',
        value: `${Math.round(capsRatio * 100)}% caps`,
        emotion: 'anger',
        weight: intensity,
      });
    }

    // 5. Análisis de repeticiones
    const repetitions = this.detectRepetitions(text);
    for (const rep of repetitions) {
      this.addToEmotionScore(emotionScores, 'anticipation', 0.2);
      indicators.push({
        type: 'repetition',
        value: rep,
        emotion: 'anticipation',
        weight: 0.2,
      });
    }

    // Calcular emociones finales
    const emotionResults = this.calculateFinalEmotions(emotionScores);

    // Calcular sentiment
    const sentimentScore = this.calculateSentiment(emotionResults);
    const sentiment = this.sentimentToPolarity(sentimentScore);

    // Calcular VAD (Valence, Arousal, Dominance)
    const valence = sentimentScore;
    const arousal = this.calculateArousal(emotionResults);
    const dominance = this.calculateDominance(emotionResults);

    // Factores contextuales
    const contextualFactors = this.analyzeContextualFactors(text, context);

    // Recomendación de respuesta
    const recommendedResponse = this.generateResponseRecommendation(emotionResults, sentiment, contextualFactors);

    const analysis: EmotionAnalysis = {
      primaryEmotion: emotionResults[0] || null,
      secondaryEmotions: emotionResults.slice(1),
      sentiment,
      sentimentScore,
      arousal,
      valence,
      dominance,
      indicators,
      contextualFactors,
      recommendedResponse,
      timestamp: new Date(),
    };

    this.emit('emotion-detected', analysis);

    return analysis;
  }

  // Helpers
  private tokenize(text: string): string[] {
    return text
      .replace(/[^\w\sáéíóúñü]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1);
  }

  private addToEmotionScore(
    scores: Map<PrimaryEmotion, { total: number; count: number }>,
    emotion: PrimaryEmotion,
    intensity: number
  ): void {
    const current = scores.get(emotion) || { total: 0, count: 0 };
    current.total += intensity;
    current.count++;
    scores.set(emotion, current);
  }

  private getDominantEmotion(scores: Map<PrimaryEmotion, { total: number; count: number }>): PrimaryEmotion | null {
    let maxEmotion: PrimaryEmotion | null = null;
    let maxScore = 0;

    for (const [emotion, { total }] of scores) {
      if (total > maxScore) {
        maxScore = total;
        maxEmotion = emotion;
      }
    }

    return maxEmotion;
  }

  private getOppositeEmotion(emotion: PrimaryEmotion): PrimaryEmotion {
    const opposites: Record<PrimaryEmotion, PrimaryEmotion> = {
      'joy': 'sadness',
      'sadness': 'joy',
      'trust': 'disgust',
      'disgust': 'trust',
      'fear': 'anger',
      'anger': 'fear',
      'surprise': 'anticipation',
      'anticipation': 'surprise',
    };
    return opposites[emotion];
  }

  private calculateCapsRatio(text: string): number {
    const letters = text.match(/[a-zA-ZáéíóúñüÁÉÍÓÚÑÜ]/g) || [];
    const caps = text.match(/[A-ZÁÉÍÓÚÑÜ]/g) || [];
    return letters.length > 0 ? caps.length / letters.length : 0;
  }

  private detectRepetitions(text: string): string[] {
    const repetitions: string[] = [];
    const words = text.toLowerCase().split(/\s+/);

    // Detectar palabras repetidas consecutivas
    for (let i = 1; i < words.length; i++) {
      if (words[i] === words[i - 1] && words[i].length > 2) {
        repetitions.push(words[i]);
      }
    }

    // Detectar letras repetidas (e.g., "nooooo")
    const repeatedLetters = text.match(/(.)\1{2,}/g) || [];
    repetitions.push(...repeatedLetters);

    return repetitions;
  }

  private calculateFinalEmotions(
    scores: Map<PrimaryEmotion, { total: number; count: number }>
  ): EmotionScore[] {
    const results: EmotionScore[] = [];

    for (const [emotion, { total, count }] of scores) {
      if (total > 0) {
        results.push({
          emotion,
          intensity: Math.min(1, total / count), // Normalizar
          confidence: Math.min(1, count * 0.2), // Más menciones = más confianza
        });
      }
    }

    return results.sort((a, b) => b.intensity - a.intensity);
  }

  private calculateSentiment(emotions: EmotionScore[]): number {
    const positiveEmotions = new Set<PrimaryEmotion | SecondaryEmotion>(['joy', 'trust', 'anticipation', 'love', 'optimism']);
    const negativeEmotions = new Set<PrimaryEmotion | SecondaryEmotion>(['sadness', 'anger', 'fear', 'disgust', 'remorse', 'contempt']);

    let positiveScore = 0;
    let negativeScore = 0;

    for (const { emotion, intensity } of emotions) {
      if (positiveEmotions.has(emotion)) {
        positiveScore += intensity;
      } else if (negativeEmotions.has(emotion)) {
        negativeScore += intensity;
      }
    }

    const total = positiveScore + negativeScore;
    if (total === 0) return 0;

    return (positiveScore - negativeScore) / total;
  }

  private sentimentToPolarity(score: number): SentimentPolarity {
    if (score >= 0.5) return 'very_positive';
    if (score >= 0.2) return 'positive';
    if (score <= -0.5) return 'very_negative';
    if (score <= -0.2) return 'negative';
    return 'neutral';
  }

  private calculateArousal(emotions: EmotionScore[]): number {
    const highArousal = new Set<PrimaryEmotion | SecondaryEmotion>(['anger', 'fear', 'joy', 'surprise', 'anticipation']);

    let arousal = 0;
    for (const { emotion, intensity } of emotions) {
      if (highArousal.has(emotion)) {
        arousal += intensity;
      }
    }

    return Math.min(1, arousal / 2);
  }

  private calculateDominance(emotions: EmotionScore[]): number {
    const highDominance = new Set<PrimaryEmotion | SecondaryEmotion>(['anger', 'trust', 'joy']);
    const lowDominance = new Set<PrimaryEmotion | SecondaryEmotion>(['fear', 'sadness', 'surprise']);

    let dominance = 0.5; // Neutral

    for (const { emotion, intensity } of emotions) {
      if (highDominance.has(emotion)) {
        dominance += intensity * 0.25;
      } else if (lowDominance.has(emotion)) {
        dominance -= intensity * 0.25;
      }
    }

    return Math.max(0, Math.min(1, dominance));
  }

  private analyzeContextualFactors(
    text: string,
    context?: { previousEmotions?: EmotionAnalysis[] }
  ): ContextualFactor[] {
    const factors: ContextualFactor[] = [];

    // Detectar urgencia
    if (/urgente|inmediato|ahora|rápido|urgent|asap|now|quick/i.test(text)) {
      factors.push({
        factor: 'urgency',
        impact: 'negative',
        description: 'User indicates urgency',
      });
    }

    // Detectar frustración repetida
    if (context?.previousEmotions) {
      const recentNegative = context.previousEmotions
        .slice(-3)
        .filter(e => e.sentiment === 'negative' || e.sentiment === 'very_negative');

      if (recentNegative.length >= 2) {
        factors.push({
          factor: 'repeated_frustration',
          impact: 'negative',
          description: 'User has shown frustration in recent messages',
        });
      }
    }

    // Detectar agradecimiento
    if (/gracias|thank|appreciate|agradezco/i.test(text)) {
      factors.push({
        factor: 'gratitude',
        impact: 'positive',
        description: 'User is expressing gratitude',
      });
    }

    // Detectar confusión
    if (/no entiendo|confundido|confused|don't understand|what do you mean/i.test(text)) {
      factors.push({
        factor: 'confusion',
        impact: 'neutral',
        description: 'User appears confused',
      });
    }

    return factors;
  }

  private generateResponseRecommendation(
    emotions: EmotionScore[],
    sentiment: SentimentPolarity,
    contextualFactors: ContextualFactor[]
  ): ResponseRecommendation {
    const primaryEmotion = emotions[0]?.emotion;
    const hasUrgency = contextualFactors.some(f => f.factor === 'urgency');
    const hasFrustration = contextualFactors.some(f => f.factor === 'repeated_frustration');
    const hasConfusion = contextualFactors.some(f => f.factor === 'confusion');

    let tone: ResponseTone = 'professional';
    let approach: ResponseApproach = 'information';
    const suggestions: string[] = [];
    const avoidTopics: string[] = [];
    let prioritizeEmpathy = false;

    // Determinar tono basado en emoción
    switch (primaryEmotion) {
      case 'anger':
        tone = 'calm';
        approach = 'validation';
        prioritizeEmpathy = true;
        suggestions.push('Acknowledge the user\'s frustration');
        suggestions.push('Offer concrete solutions');
        avoidTopics.push('Avoid defensive language');
        break;
      case 'sadness':
        tone = 'empathetic';
        approach = 'active-listening';
        prioritizeEmpathy = true;
        suggestions.push('Show understanding');
        suggestions.push('Offer support without being patronizing');
        break;
      case 'fear':
        tone = 'supportive';
        approach = 'validation';
        prioritizeEmpathy = true;
        suggestions.push('Provide reassurance');
        suggestions.push('Break down complex information');
        break;
      case 'joy':
        tone = 'enthusiastic';
        approach = 'celebration';
        suggestions.push('Match the positive energy');
        suggestions.push('Build on the momentum');
        break;
      case 'surprise':
        tone = 'calm';
        approach = 'information';
        suggestions.push('Provide clear explanations');
        suggestions.push('Give context');
        break;
      default:
        tone = 'professional';
        approach = 'information';
    }

    // Ajustar por factores contextuales
    if (hasUrgency) {
      suggestions.push('Prioritize quick, actionable information');
      approach = 'solution-focused';
    }

    if (hasFrustration) {
      prioritizeEmpathy = true;
      suggestions.push('Extra attention to validation');
      suggestions.push('Consider offering escalation options');
    }

    if (hasConfusion) {
      suggestions.push('Use simpler language');
      suggestions.push('Provide examples');
      approach = 'information';
    }

    return {
      tone,
      approach,
      suggestions,
      avoidTopics,
      prioritizeEmpathy,
    };
  }

  // Analizar cambio emocional
  analyzeEmotionalShift(current: EmotionAnalysis, previous: EmotionAnalysis): {
    direction: 'improving' | 'worsening' | 'stable';
    magnitude: number;
    interpretation: string;
  } {
    const currentSentiment = current.sentimentScore;
    const previousSentiment = previous.sentimentScore;
    const diff = currentSentiment - previousSentiment;

    let direction: 'improving' | 'worsening' | 'stable';
    if (diff > 0.2) direction = 'improving';
    else if (diff < -0.2) direction = 'worsening';
    else direction = 'stable';

    const magnitude = Math.abs(diff);

    let interpretation = '';
    if (direction === 'improving') {
      interpretation = 'User\'s emotional state appears to be improving';
    } else if (direction === 'worsening') {
      interpretation = 'User may be becoming more frustrated or upset';
    } else {
      interpretation = 'User\'s emotional state is relatively stable';
    }

    return { direction, magnitude, interpretation };
  }
}

// Singleton export
export const emotionDetector = EmotionDetector.getInstance();
