/**
 * SUPERINTELLIGENCE - Reasoning Engine
 * Motor de razonamiento híbrido simbólico-neuronal
 * Fase 3: Arquitectura Cognitiva - Componente de Razonamiento
 */

import { EventEmitter } from 'events';
import { Logger } from '../../../lib/logger';

// Tipos de razonamiento
export type ReasoningType =
  | 'deductive'      // De premisas generales a conclusiones específicas
  | 'inductive'      // De casos específicos a generalizaciones
  | 'abductive'      // Mejor explicación para observaciones
  | 'analogical'     // Comparación con casos similares
  | 'causal'         // Causa y efecto
  | 'counterfactual' // Qué pasaría si...
  | 'probabilistic'  // Basado en probabilidades
  | 'heuristic';     // Reglas aproximadas

export interface ReasoningStep {
  id: string;
  type: ReasoningType;
  premise: string;
  inference: string;
  conclusion: string;
  confidence: number;
  evidence: Evidence[];
  timestamp: Date;
}

export interface Evidence {
  source: string;
  content: string;
  reliability: number;
  relevance: number;
}

export interface ReasoningChain {
  id: string;
  goal: string;
  steps: ReasoningStep[];
  finalConclusion: string;
  overallConfidence: number;
  alternativeConclusions: AlternativeConclusion[];
  assumptions: string[];
  limitations: string[];
  startedAt: Date;
  completedAt?: Date;
}

export interface AlternativeConclusion {
  conclusion: string;
  confidence: number;
  reasoning: string;
}

export interface LogicalRule {
  id: string;
  name: string;
  condition: (context: ReasoningContext) => boolean;
  action: (context: ReasoningContext) => ReasoningStep;
  priority: number;
  domain?: string;
}

export interface ReasoningContext {
  query: string;
  facts: Fact[];
  goals: string[];
  constraints: string[];
  previousSteps: ReasoningStep[];
  memory: Map<string, any>;
}

export interface Fact {
  id: string;
  statement: string;
  confidence: number;
  source: string;
  timestamp: Date;
  tags: string[];
}

export interface InferenceResult {
  success: boolean;
  conclusion: string;
  confidence: number;
  reasoning: ReasoningChain;
  suggestedActions: string[];
  uncertainties: Uncertainty[];
}

export interface Uncertainty {
  aspect: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  mitigation?: string;
}

// Reglas lógicas predefinidas
const DEFAULT_RULES: LogicalRule[] = [
  // Modus Ponens: Si P entonces Q, P es verdadero, entonces Q
  {
    id: 'modus_ponens',
    name: 'Modus Ponens',
    condition: (ctx) => {
      return ctx.facts.some(f => f.statement.includes('si') || f.statement.includes('if'));
    },
    action: (ctx) => ({
      id: `step_${Date.now()}`,
      type: 'deductive',
      premise: 'Si P entonces Q, y P es verdadero',
      inference: 'Aplicando modus ponens',
      conclusion: 'Q es verdadero',
      confidence: 0.95,
      evidence: [],
      timestamp: new Date(),
    }),
    priority: 10,
  },
  // Generalización inductiva
  {
    id: 'inductive_generalization',
    name: 'Generalización Inductiva',
    condition: (ctx) => {
      const similarFacts = ctx.facts.filter(f => f.tags.some(t => t === 'observation'));
      return similarFacts.length >= 3;
    },
    action: (ctx) => ({
      id: `step_${Date.now()}`,
      type: 'inductive',
      premise: 'Múltiples observaciones similares',
      inference: 'Generalizando desde casos específicos',
      conclusion: 'Patrón probable identificado',
      confidence: 0.7,
      evidence: [],
      timestamp: new Date(),
    }),
    priority: 8,
  },
  // Razonamiento causal
  {
    id: 'causal_inference',
    name: 'Inferencia Causal',
    condition: (ctx) => {
      return ctx.query.includes('por qué') || ctx.query.includes('why') || ctx.query.includes('causa');
    },
    action: (ctx) => ({
      id: `step_${Date.now()}`,
      type: 'causal',
      premise: 'Búsqueda de relación causa-efecto',
      inference: 'Analizando cadena causal',
      conclusion: 'Causa probable identificada',
      confidence: 0.75,
      evidence: [],
      timestamp: new Date(),
    }),
    priority: 9,
  },
];

export class ReasoningEngine extends EventEmitter {
  private static instance: ReasoningEngine;
  private rules: LogicalRule[] = [...DEFAULT_RULES];
  private activeChains: Map<string, ReasoningChain> = new Map();
  private factBase: Map<string, Fact> = new Map();
  private readonly MAX_REASONING_DEPTH = 10;
  private readonly MIN_CONFIDENCE_THRESHOLD = 0.3;

  private constructor() {
    super();
  }

  static getInstance(): ReasoningEngine {
    if (!ReasoningEngine.instance) {
      ReasoningEngine.instance = new ReasoningEngine();
    }
    return ReasoningEngine.instance;
  }

  /**
   * Realizar inferencia sobre una consulta
   */
  async reason(
    query: string,
    context: Partial<ReasoningContext> = {}
  ): Promise<InferenceResult> {
    const chainId = this.generateId();
    const startTime = new Date();

    Logger.info(`[ReasoningEngine] Starting reasoning chain ${chainId} for: ${query.slice(0, 50)}...`);

    // Construir contexto completo
    const fullContext: ReasoningContext = {
      query,
      facts: context.facts || Array.from(this.factBase.values()),
      goals: context.goals || [query],
      constraints: context.constraints || [],
      previousSteps: [],
      memory: context.memory || new Map(),
    };

    // Crear cadena de razonamiento
    const chain: ReasoningChain = {
      id: chainId,
      goal: query,
      steps: [],
      finalConclusion: '',
      overallConfidence: 0,
      alternativeConclusions: [],
      assumptions: [],
      limitations: [],
      startedAt: startTime,
    };

    this.activeChains.set(chainId, chain);

    try {
      // Ejecutar pasos de razonamiento
      await this.executeReasoningLoop(chain, fullContext);

      // Calcular conclusión final
      const result = this.synthesizeConclusion(chain, fullContext);

      chain.completedAt = new Date();
      this.emit('reasoning-complete', { chainId, result });

      return result;
    } catch (error) {
      Logger.error(`[ReasoningEngine] Error in chain ${chainId}:`, error);
      return {
        success: false,
        conclusion: 'No se pudo completar el razonamiento',
        confidence: 0,
        reasoning: chain,
        suggestedActions: ['Proporcionar más contexto', 'Reformular la consulta'],
        uncertainties: [{
          aspect: 'error',
          description: (error as Error).message,
          impact: 'high',
        }],
      };
    }
  }

  /**
   * Bucle principal de razonamiento
   */
  private async executeReasoningLoop(
    chain: ReasoningChain,
    context: ReasoningContext
  ): Promise<void> {
    let depth = 0;

    while (depth < this.MAX_REASONING_DEPTH) {
      // Seleccionar regla aplicable
      const applicableRule = this.selectBestRule(context);

      if (!applicableRule) {
        Logger.debug('[ReasoningEngine] No more applicable rules');
        break;
      }

      // Ejecutar regla
      const step = applicableRule.action(context);

      // Validar paso
      if (step.confidence < this.MIN_CONFIDENCE_THRESHOLD) {
        Logger.debug(`[ReasoningEngine] Step confidence too low: ${step.confidence}`);
        break;
      }

      // Agregar evidencia del contexto
      step.evidence = this.gatherEvidence(step, context);

      // Agregar paso a la cadena
      chain.steps.push(step);
      context.previousSteps.push(step);

      // Emitir evento de progreso
      this.emit('reasoning-step', { chainId: chain.id, step });

      // Verificar si alcanzamos la meta
      if (this.isGoalAchieved(chain, context)) {
        Logger.debug('[ReasoningEngine] Goal achieved');
        break;
      }

      depth++;
    }

    // Identificar suposiciones y limitaciones
    chain.assumptions = this.identifyAssumptions(chain, context);
    chain.limitations = this.identifyLimitations(chain, context);
  }

  /**
   * Seleccionar la mejor regla aplicable
   */
  private selectBestRule(context: ReasoningContext): LogicalRule | null {
    const applicableRules = this.rules
      .filter(rule => {
        try {
          return rule.condition(context);
        } catch {
          return false;
        }
      })
      .sort((a, b) => b.priority - a.priority);

    return applicableRules[0] || null;
  }

  /**
   * Recopilar evidencia relevante
   */
  private gatherEvidence(step: ReasoningStep, context: ReasoningContext): Evidence[] {
    const evidence: Evidence[] = [];

    // Buscar hechos relacionados
    for (const fact of context.facts) {
      const relevance = this.calculateRelevance(step.premise, fact.statement);
      if (relevance > 0.3) {
        evidence.push({
          source: fact.source,
          content: fact.statement,
          reliability: fact.confidence,
          relevance,
        });
      }
    }

    return evidence.slice(0, 5); // Limitar a 5 evidencias más relevantes
  }

  /**
   * Calcular relevancia entre textos
   */
  private calculateRelevance(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    return intersection.size / Math.max(words1.size, words2.size);
  }

  /**
   * Verificar si se alcanzó la meta
   */
  private isGoalAchieved(chain: ReasoningChain, context: ReasoningContext): boolean {
    if (chain.steps.length === 0) return false;

    const lastStep = chain.steps[chain.steps.length - 1];

    // Verificar si la conclusión responde a la consulta
    const goalRelevance = this.calculateRelevance(lastStep.conclusion, context.query);

    // Verificar si tenemos suficiente confianza
    const avgConfidence = chain.steps.reduce((sum, s) => sum + s.confidence, 0) / chain.steps.length;

    return goalRelevance > 0.5 && avgConfidence > 0.6;
  }

  /**
   * Sintetizar conclusión final
   */
  private synthesizeConclusion(chain: ReasoningChain, context: ReasoningContext): InferenceResult {
    if (chain.steps.length === 0) {
      return {
        success: false,
        conclusion: 'No se pudieron derivar conclusiones',
        confidence: 0,
        reasoning: chain,
        suggestedActions: ['Proporcionar más información'],
        uncertainties: [{
          aspect: 'insufficient_data',
          description: 'No hay suficiente información para razonar',
          impact: 'high',
        }],
      };
    }

    // Calcular confianza general
    const overallConfidence = chain.steps.reduce((sum, s) => sum + s.confidence, 0) / chain.steps.length;
    chain.overallConfidence = overallConfidence;

    // Construir conclusión final
    const lastStep = chain.steps[chain.steps.length - 1];
    chain.finalConclusion = lastStep.conclusion;

    // Generar conclusiones alternativas
    chain.alternativeConclusions = this.generateAlternatives(chain, context);

    // Identificar incertidumbres
    const uncertainties = this.identifyUncertainties(chain);

    // Sugerir acciones
    const suggestedActions = this.suggestActions(chain, context);

    return {
      success: true,
      conclusion: chain.finalConclusion,
      confidence: overallConfidence,
      reasoning: chain,
      suggestedActions,
      uncertainties,
    };
  }

  /**
   * Generar conclusiones alternativas
   */
  private generateAlternatives(chain: ReasoningChain, context: ReasoningContext): AlternativeConclusion[] {
    const alternatives: AlternativeConclusion[] = [];

    // Buscar pasos con baja confianza que podrían tener otras interpretaciones
    for (const step of chain.steps) {
      if (step.confidence < 0.8) {
        alternatives.push({
          conclusion: `Alternativa: ${step.conclusion} (con diferente interpretación)`,
          confidence: step.confidence * 0.7,
          reasoning: `Basado en ${step.type} con evidencia limitada`,
        });
      }
    }

    return alternatives.slice(0, 3);
  }

  /**
   * Identificar suposiciones
   */
  private identifyAssumptions(chain: ReasoningChain, context: ReasoningContext): string[] {
    const assumptions: string[] = [];

    // Suposiciones implícitas en el razonamiento
    if (chain.steps.some(s => s.type === 'inductive')) {
      assumptions.push('Se asume que los casos observados son representativos');
    }
    if (chain.steps.some(s => s.type === 'causal')) {
      assumptions.push('Se asume que la correlación implica causalidad');
    }
    if (context.facts.length < 5) {
      assumptions.push('Se asume que la información disponible es suficiente');
    }

    return assumptions;
  }

  /**
   * Identificar limitaciones
   */
  private identifyLimitations(chain: ReasoningChain, context: ReasoningContext): string[] {
    const limitations: string[] = [];

    if (chain.steps.length >= this.MAX_REASONING_DEPTH) {
      limitations.push('Se alcanzó el límite máximo de profundidad de razonamiento');
    }
    if (chain.overallConfidence < 0.7) {
      limitations.push('La confianza general del razonamiento es moderada');
    }
    if (context.facts.filter(f => f.confidence > 0.8).length < 3) {
      limitations.push('Hay pocos hechos con alta confiabilidad');
    }

    return limitations;
  }

  /**
   * Identificar incertidumbres
   */
  private identifyUncertainties(chain: ReasoningChain): Uncertainty[] {
    const uncertainties: Uncertainty[] = [];

    // Por pasos con baja confianza
    const lowConfidenceSteps = chain.steps.filter(s => s.confidence < 0.7);
    if (lowConfidenceSteps.length > 0) {
      uncertainties.push({
        aspect: 'confidence',
        description: `${lowConfidenceSteps.length} pasos tienen confianza menor al 70%`,
        impact: lowConfidenceSteps.length > 2 ? 'high' : 'medium',
        mitigation: 'Buscar más evidencia de soporte',
      });
    }

    // Por falta de evidencia
    const noEvidenceSteps = chain.steps.filter(s => s.evidence.length === 0);
    if (noEvidenceSteps.length > 0) {
      uncertainties.push({
        aspect: 'evidence',
        description: `${noEvidenceSteps.length} pasos sin evidencia directa`,
        impact: 'medium',
        mitigation: 'Validar con fuentes adicionales',
      });
    }

    return uncertainties;
  }

  /**
   * Sugerir acciones basadas en el razonamiento
   */
  private suggestActions(chain: ReasoningChain, context: ReasoningContext): string[] {
    const actions: string[] = [];

    if (chain.overallConfidence > 0.8) {
      actions.push('Proceder con la conclusión');
    } else if (chain.overallConfidence > 0.5) {
      actions.push('Considerar la conclusión con precaución');
      actions.push('Buscar validación adicional');
    } else {
      actions.push('Recopilar más información antes de decidir');
    }

    if (chain.alternativeConclusions.length > 0) {
      actions.push('Considerar conclusiones alternativas');
    }

    return actions;
  }

  // Gestión de reglas
  addRule(rule: LogicalRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  removeRule(ruleId: string): boolean {
    const index = this.rules.findIndex(r => r.id === ruleId);
    if (index >= 0) {
      this.rules.splice(index, 1);
      return true;
    }
    return false;
  }

  // Gestión de hechos
  addFact(statement: string, confidence: number, source: string, tags: string[] = []): Fact {
    const fact: Fact = {
      id: this.generateId(),
      statement,
      confidence,
      source,
      timestamp: new Date(),
      tags,
    };
    this.factBase.set(fact.id, fact);
    return fact;
  }

  removeFact(factId: string): boolean {
    return this.factBase.delete(factId);
  }

  getFacts(): Fact[] {
    return Array.from(this.factBase.values());
  }

  // Utilidades
  private generateId(): string {
    return `rsn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Estado
  getActiveChains(): ReasoningChain[] {
    return Array.from(this.activeChains.values());
  }

  getChain(chainId: string): ReasoningChain | undefined {
    return this.activeChains.get(chainId);
  }

  clearCompletedChains(): void {
    for (const [id, chain] of this.activeChains) {
      if (chain.completedAt) {
        this.activeChains.delete(id);
      }
    }
  }
}

// Singleton export
export const reasoningEngine = ReasoningEngine.getInstance();
