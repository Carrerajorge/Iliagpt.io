/**
 * Quality Gates
 * 
 * Sistema de validación obligatorio antes de renderizar.
 * Ejecuta la rúbrica QA y bloquea si no pasa.
 */

import { z } from 'zod';
import type { QARubric, QACriterion } from './blueprintAgent';
import type { AnalysisResult } from './analysisAgent';
import type { WritingResult } from './writingAgent';
import type { SlideDeckSpec } from './slideArchitectAgent';
import type { TraceMap, ContentSpec, EvidencePack } from './types';

// ============================================================================
// Types
// ============================================================================

export const QACheckResultSchema = z.object({
    criterionId: z.string(),
    name: z.string(),
    passed: z.boolean(),
    score: z.number().min(0).max(100),
    weight: z.number(),
    weightedScore: z.number(),
    issues: z.array(z.string()),
    suggestions: z.array(z.string()),
});
export type QACheckResult = z.infer<typeof QACheckResultSchema>;

export const QAGateResultSchema = z.object({
    passed: z.boolean(),
    overallScore: z.number(),
    criticalPassed: z.boolean(),
    checkResults: z.array(QACheckResultSchema),
    blockers: z.array(z.string()),
    warnings: z.array(z.string()),
    recommendations: z.array(z.string()),
    canProceed: z.boolean(),
    requiresRemediation: z.boolean(),
});
export type QAGateResult = z.infer<typeof QAGateResultSchema>;

export interface QAContext {
    outline: { sections: { id: string; type: string; targetWordCount: number }[] };
    writing: WritingResult;
    analysis: AnalysisResult;
    slides?: SlideDeckSpec;
    traceMap?: TraceMap;
    evidence: EvidencePack;
}

// ============================================================================
// Quality Gate Executor
// ============================================================================

export function runQualityGate(
    rubric: QARubric,
    context: QAContext
): QAGateResult {
    console.log(`[QualityGate] Running ${rubric.criteria.length} criteria checks`);

    const checkResults: QACheckResult[] = [];

    for (const criterion of rubric.criteria) {
        const result = runCriterionCheck(criterion, context);
        checkResults.push(result);
    }

    // Calculate overall score
    const totalWeight = checkResults.reduce((acc, r) => acc + r.weight, 0);
    const overallScore = checkResults.reduce((acc, r) => acc + r.weightedScore, 0) / totalWeight;

    // Check critical criteria
    const criticalPassed = rubric.criticalCriteria.every(id => {
        const result = checkResults.find(r => r.criterionId === id);
        return result?.passed ?? false;
    });

    // Determine blockers and warnings
    const blockers = checkResults
        .filter(r => !r.passed && rubric.criticalCriteria.includes(r.criterionId))
        .flatMap(r => r.issues);

    const warnings = checkResults
        .filter(r => !r.passed && !rubric.criticalCriteria.includes(r.criterionId))
        .flatMap(r => r.issues);

    const recommendations = checkResults.flatMap(r => r.suggestions);

    const passed = overallScore >= rubric.passingScore && criticalPassed;

    return {
        passed,
        overallScore: Math.round(overallScore),
        criticalPassed,
        checkResults,
        blockers,
        warnings,
        recommendations,
        canProceed: passed || (warnings.length > 0 && blockers.length === 0),
        requiresRemediation: blockers.length > 0,
    };
}

// ============================================================================
// Individual Criterion Checks
// ============================================================================

function runCriterionCheck(
    criterion: QACriterion,
    context: QAContext
): QACheckResult {
    const checker = CRITERION_CHECKERS[criterion.id] || defaultChecker;
    const { score, issues, suggestions } = checker(context, criterion);

    const passed = score >= criterion.threshold;

    return {
        criterionId: criterion.id,
        name: criterion.name,
        passed,
        score,
        weight: criterion.weight,
        weightedScore: score * criterion.weight,
        issues,
        suggestions,
    };
}

// ============================================================================
// Criterion Checkers
// ============================================================================

type CheckerResult = { score: number; issues: string[]; suggestions: string[] };
type CriterionChecker = (context: QAContext, criterion: QACriterion) => CheckerResult;

const CRITERION_CHECKERS: Record<string, CriterionChecker> = {
    structure: (context) => {
        const issues: string[] = [];
        const suggestions: string[] = [];

        const expectedSections = context.outline.sections.length;
        const writtenSections = context.writing.sections.length;

        if (writtenSections < expectedSections) {
            issues.push(`Faltan ${expectedSections - writtenSections} secciones`);
        }

        // Check for empty sections
        const emptySections = context.writing.sections.filter(s => s.wordCount < 50);
        if (emptySections.length > 0) {
            issues.push(`${emptySections.length} secciones están vacías o muy cortas`);
            suggestions.push('Expandir secciones con contenido mínimo');
        }

        const completeness = (writtenSections / expectedSections) * 100;
        const emptyPenalty = (emptySections.length / expectedSections) * 50;

        return {
            score: Math.max(0, completeness - emptyPenalty),
            issues,
            suggestions,
        };
    },

    coherence: (context) => {
        // Check argument graph coherence
        const issues: string[] = [];
        const suggestions: string[] = [];

        const { argumentGraph } = context.analysis;

        // Has thesis
        if (!argumentGraph.thesis || argumentGraph.thesis.length < 20) {
            issues.push('Falta tesis principal clara');
            suggestions.push('Definir una tesis central que guíe el documento');
        }

        // Claims are supported
        const unsupportedClaims = argumentGraph.nodes.filter(
            n => n.type === 'claim' && n.sourceIds.length === 0 && n.confidence < 0.8
        );
        if (unsupportedClaims.length > 0) {
            issues.push(`${unsupportedClaims.length} afirmaciones sin soporte`);
        }

        // Has conclusions/recommendations
        const hasConclusions = argumentGraph.nodes.some(n =>
            n.type === 'synthesis' || n.type === 'recommendation'
        );
        if (!hasConclusions) {
            issues.push('Falta síntesis o recomendaciones');
        }

        const score = Math.max(0, 100 - (issues.length * 15));

        return { score, issues, suggestions };
    },

    citations: (context) => {
        const issues: string[] = [];
        const suggestions: string[] = [];

        const totalCitations = context.writing.sections.reduce(
            (acc, s) => acc + s.citations.length, 0
        );

        const researchSections = context.outline.sections.filter(
            s => s.type === 'analysis' || s.type === 'findings' || s.type === 'context'
        ).length;

        if (researchSections > 0 && totalCitations === 0) {
            issues.push('No hay citas en secciones que requieren investigación');
            suggestions.push('Agregar referencias a las fuentes de investigación');
        }

        // Check for sections needing citations
        const sectionsWithoutCitations = context.writing.sections.filter(s => {
            const outlineSection = context.outline.sections.find(os => os.id === s.sectionId);
            return outlineSection?.type === 'analysis' && s.citations.length === 0;
        });

        if (sectionsWithoutCitations.length > 0) {
            issues.push(`${sectionsWithoutCitations.length} secciones de análisis sin citas`);
        }

        const expectedCitations = researchSections * 2;
        const score = expectedCitations > 0
            ? Math.min(100, (totalCitations / expectedCitations) * 100)
            : 100;

        return { score, issues, suggestions };
    },

    completeness: (context) => {
        const issues: string[] = [];
        const suggestions: string[] = [];

        // Check word count compliance
        const nonCompliant = context.writing.sections.filter(s => !s.quality.lengthCompliant);
        if (nonCompliant.length > 0) {
            issues.push(`${nonCompliant.length} secciones no cumplen el límite de palabras`);
        }

        // Check quality scores
        const lowQuality = context.writing.sections.filter(s => s.quality.score < 70);
        if (lowQuality.length > 0) {
            issues.push(`${lowQuality.length} secciones con calidad baja`);
            suggestions.push('Revisar y mejorar secciones con puntuación < 70');
        }

        const avgQuality = context.writing.qualityReport.averageQuality;

        return {
            score: avgQuality,
            issues,
            suggestions,
        };
    },

    consistency: (context) => {
        const issues: string[] = [];
        const suggestions: string[] = [];

        if (!context.traceMap) {
            return { score: 80, issues: ['No hay mapa de trazabilidad'], suggestions: [] };
        }

        const { traceMap } = context;

        // Check inconsistencies
        for (const inconsistency of traceMap.inconsistencies) {
            if (inconsistency.type === 'contradiction') {
                issues.push(`Contradicción: ${inconsistency.description}`);
            } else if (inconsistency.type === 'mismatch') {
                issues.push(`Inconsistencia: ${inconsistency.description}`);
            }
        }

        // Check coverage
        if (traceMap.coverageScore < 70) {
            issues.push(`Baja trazabilidad: ${traceMap.coverageScore}%`);
            suggestions.push('Mejorar la vinculación entre claims y evidencia');
        }

        return {
            score: traceMap.coverageScore,
            issues,
            suggestions,
        };
    },

    tone: (context) => {
        // Simplified tone check
        const issues: string[] = [];
        const suggestions: string[] = [];

        // Check for inconsistent formality
        const allContent = context.writing.sections.map(s => s.content).join(' ');

        const informalMarkers = ['ok', 'super', 'genial', 'cool', 'básicamente'];
        const formalMarkers = ['por consiguiente', 'cabe destacar', 'se observa'];

        const hasInformal = informalMarkers.some(m => allContent.toLowerCase().includes(m));
        const hasFormal = formalMarkers.some(m => allContent.toLowerCase().includes(m));

        if (hasInformal && hasFormal) {
            issues.push('Tono inconsistente entre secciones');
            suggestions.push('Unificar el nivel de formalidad');
        }

        return {
            score: hasInformal ? 70 : 90,
            issues,
            suggestions,
        };
    },

    length: (context) => {
        const issues: string[] = [];
        const suggestions: string[] = [];

        const totalTargetWords = context.outline.sections.reduce(
            (acc, s) => acc + s.targetWordCount, 0
        );
        const actualWords = context.writing.totalWordCount;

        const ratio = actualWords / totalTargetWords;

        if (ratio < 0.7) {
            issues.push(`Documento muy corto: ${actualWords} palabras (esperado: ${totalTargetWords})`);
            suggestions.push('Expandir secciones para cumplir el objetivo');
        } else if (ratio > 1.3) {
            issues.push(`Documento muy largo: ${actualWords} palabras (esperado: ${totalTargetWords})`);
            suggestions.push('Reducir contenido redundante');
        }

        const score = ratio >= 0.8 && ratio <= 1.2 ? 100 : Math.max(0, 100 - Math.abs(1 - ratio) * 100);

        return { score, issues, suggestions };
    },

    visual_density: (context) => {
        const issues: string[] = [];
        const suggestions: string[] = [];

        if (!context.slides) {
            return { score: 100, issues: [], suggestions: [] };
        }

        // Check bullet density
        const overloadedSlides = context.slides.slides.filter(s =>
            (s.bullets?.length || 0) > 5
        );

        if (overloadedSlides.length > 0) {
            issues.push(`${overloadedSlides.length} slides con demasiados bullets`);
            suggestions.push('Reducir a máximo 5 bullets por slide');
        }

        // Check word count per slide
        const wordySlides = context.slides.slides.filter(s => {
            const bulletWords = s.bullets?.reduce((acc, b) => acc + b.text.split(' ').length, 0) || 0;
            return bulletWords > 75;
        });

        if (wordySlides.length > 0) {
            issues.push(`${wordySlides.length} slides con demasiado texto`);
        }

        const score = Math.max(0, 100 - (overloadedSlides.length + wordySlides.length) * 10);

        return { score, issues, suggestions };
    },
};

function defaultChecker(): CheckerResult {
    return { score: 80, issues: [], suggestions: [] };
}

// ============================================================================
// Remediation Runner
// ============================================================================

export interface RemediationAction {
    criterionId: string;
    type: 'rewrite' | 'expand' | 'reduce' | 'add_citations' | 'fix_consistency';
    targetSections: string[];
    details: string;
}

export function planRemediation(gateResult: QAGateResult): RemediationAction[] {
    const actions: RemediationAction[] = [];

    for (const check of gateResult.checkResults) {
        if (check.passed) continue;

        switch (check.criterionId) {
            case 'structure':
                actions.push({
                    criterionId: 'structure',
                    type: 'expand',
                    targetSections: [],
                    details: 'Completar secciones faltantes',
                });
                break;
            case 'citations':
                actions.push({
                    criterionId: 'citations',
                    type: 'add_citations',
                    targetSections: [],
                    details: 'Agregar referencias en secciones de análisis',
                });
                break;
            case 'length':
                const isShort = check.issues.some(i => i.includes('muy corto'));
                actions.push({
                    criterionId: 'length',
                    type: isShort ? 'expand' : 'reduce',
                    targetSections: [],
                    details: isShort ? 'Expandir contenido' : 'Reducir redundancia',
                });
                break;
            case 'consistency':
                actions.push({
                    criterionId: 'consistency',
                    type: 'fix_consistency',
                    targetSections: [],
                    details: 'Resolver inconsistencias detectadas',
                });
                break;
        }
    }

    return actions;
}

// ============================================================================
// Exports
// ============================================================================

export { CRITERION_CHECKERS };
