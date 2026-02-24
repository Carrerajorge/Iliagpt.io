/**
 * Analysis Agent
 * 
 * Convierte evidencia en argumentos estructurados:
 * - ArgumentGraph (estructura de razonamiento)
 * - KeyFindings (hallazgos priorizados)
 * - Gaps/Contradicciones detectadas
 */

import OpenAI from 'openai';
import { z } from 'zod';
import type { EvidencePack, EvidenceNote } from './types';
import type { OutlineSpec } from './blueprintAgent';

const xaiClient = new OpenAI({
    baseURL: 'https://api.x.ai/v1',
    apiKey: process.env.XAI_API_KEY || "missing",
});

const MODEL = 'grok-4-1-fast-non-reasoning';

// ============================================================================
// Schemas
// ============================================================================

export const ArgumentTypeSchema = z.enum([
    'thesis',           // Tesis principal
    'claim',            // Afirmación
    'evidence',         // Evidencia que soporta
    'counter',          // Contraargumento
    'synthesis',        // Síntesis/conclusión
    'assumption',       // Supuesto declarado
    'implication',      // Implicación/consecuencia
    'recommendation',   // Recomendación
]);
export type ArgumentType = z.infer<typeof ArgumentTypeSchema>;

export const ArgumentNodeSchema = z.object({
    id: z.string(),
    type: ArgumentTypeSchema,
    content: z.string(),
    confidence: z.number().min(0).max(1),
    supportedBy: z.array(z.string()), // IDs de nodos que soportan este
    contradicts: z.array(z.string()).optional(),
    sourceIds: z.array(z.string()), // IDs de evidencia
    sectionId: z.string().optional(), // Sección donde aparecerá
});
export type ArgumentNode = z.infer<typeof ArgumentNodeSchema>;

export const ArgumentGraphSchema = z.object({
    thesis: z.string(),
    nodes: z.array(ArgumentNodeSchema),
    structure: z.object({
        mainClaims: z.array(z.string()), // IDs de claims principales
        evidenceChains: z.array(z.object({
            claimId: z.string(),
            evidenceIds: z.array(z.string()),
        })),
    }),
});
export type ArgumentGraph = z.infer<typeof ArgumentGraphSchema>;

export const FindingSeveritySchema = z.enum(['critical', 'major', 'notable', 'minor']);

export const KeyFindingSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    severity: FindingSeveritySchema,
    implications: z.array(z.string()),
    supportingEvidence: z.array(z.string()),
    recommendedAction: z.string().optional(),
    sectionId: z.string().optional(),
});
export type KeyFinding = z.infer<typeof KeyFindingSchema>;

export const GapSchema = z.object({
    id: z.string(),
    description: z.string(),
    impactedSections: z.array(z.string()),
    severity: z.enum(['blocking', 'significant', 'minor']),
    mitigation: z.string(),
});
export type Gap = z.infer<typeof GapSchema>;

export const ContradictionSchema = z.object({
    id: z.string(),
    description: z.string(),
    sources: z.array(z.string()),
    resolution: z.string().optional(),
});
export type Contradiction = z.infer<typeof ContradictionSchema>;

export interface AnalysisResult {
    argumentGraph: ArgumentGraph;
    keyFindings: KeyFinding[];
    gaps: Gap[];
    contradictions: Contradiction[];
    declaredAssumptions: string[];
    analysisQuality: {
        evidenceCoverage: number; // 0-100
        argumentStrength: number; // 0-100
        gapCount: number;
        contradictionCount: number;
    };
}

// ============================================================================
// Analysis Agent
// ============================================================================

export async function analyzeEvidence(
    evidence: EvidencePack,
    outline: OutlineSpec,
    topic: string
): Promise<AnalysisResult> {
    console.log(`[AnalysisAgent] Analyzing ${evidence.notes.length} notes for: ${topic}`);

    // 1. Build argument graph
    const argumentGraph = await buildArgumentGraph(evidence, topic);

    // 2. Extract key findings
    const keyFindings = await extractKeyFindings(evidence, argumentGraph, outline);

    // 3. Identify gaps
    const gaps = identifyGaps(evidence, outline);

    // 4. Detect contradictions
    const contradictions = await detectContradictions(evidence);

    // 5. Extract assumptions
    const declaredAssumptions = extractAssumptions(evidence, gaps);

    // 6. Calculate quality metrics
    const analysisQuality = calculateQuality(argumentGraph, keyFindings, gaps, contradictions);

    return {
        argumentGraph,
        keyFindings,
        gaps,
        contradictions,
        declaredAssumptions,
        analysisQuality,
    };
}

// ============================================================================
// Argument Graph Builder
// ============================================================================

async function buildArgumentGraph(
    evidence: EvidencePack,
    topic: string
): Promise<ArgumentGraph> {
    const notesText = evidence.notes
        .map(n => `[${n.id}] ${n.content} (Fuente: ${n.sourceId})`)
        .join('\n');

    const prompt = `Construye un grafo de argumentos basado en esta evidencia:

TEMA: ${topic}

NOTAS DE INVESTIGACIÓN:
${notesText}

Responde en JSON con esta estructura exacta:
{
  "thesis": "la tesis principal que emerge de la evidencia",
  "nodes": [
    {
      "id": "n1",
      "type": "thesis|claim|evidence|counter|synthesis|assumption|implication|recommendation",
      "content": "contenido del argumento",
      "confidence": 0.0-1.0,
      "supportedBy": ["ids de nodos que soportan este"],
      "sourceIds": ["ids de notas de evidencia"]
    }
  ],
  "structure": {
    "mainClaims": ["ids de claims principales"],
    "evidenceChains": [
      {"claimId": "n2", "evidenceIds": ["n3", "n4"]}
    ]
  }
}

Reglas:
- Cada claim debe tener al menos una evidence que lo soporte
- La tesis debe ser soportada por múltiples claims
- Si hay contraargumentos, inclúyelos como type="counter"
- Indica confianza baja (< 0.5) si la evidencia es débil`;

    try {
        const response = await xaiClient.chat.completions.create({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.2,
            max_tokens: 3000,
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
            return ArgumentGraphSchema.parse(JSON.parse(content));
        }
    } catch (error) {
        console.error('[AnalysisAgent] Failed to build argument graph:', error);
    }

    // Fallback
    return {
        thesis: `Análisis sobre ${topic} basado en ${evidence.notes.length} fuentes`,
        nodes: [{
            id: 'n1',
            type: 'thesis',
            content: `Análisis sobre ${topic}`,
            confidence: 0.5,
            supportedBy: [],
            sourceIds: evidence.notes.slice(0, 3).map(n => n.id),
        }],
        structure: {
            mainClaims: [],
            evidenceChains: [],
        },
    };
}

// ============================================================================
// Key Findings Extractor
// ============================================================================

async function extractKeyFindings(
    evidence: EvidencePack,
    argumentGraph: ArgumentGraph,
    outline: OutlineSpec
): Promise<KeyFinding[]> {
    const prompt = `Extrae los hallazgos clave de este análisis:

TESIS: ${argumentGraph.thesis}

CLAIMS PRINCIPALES:
${argumentGraph.nodes
            .filter(n => n.type === 'claim' || n.type === 'synthesis')
            .map(n => `- ${n.content} (confianza: ${n.confidence})`)
            .join('\n')}

DATOS NUMÉRICOS:
${evidence.dataPoints.map(d => `- ${d.label}: ${d.value} ${d.unit || ''}`).join('\n')}

SECCIONES DEL DOCUMENTO:
${outline.sections.map(s => `- ${s.id}: ${s.title}`).join('\n')}

Responde en JSON:
{
  "findings": [
    {
      "id": "f1",
      "title": "título conciso del hallazgo",
      "description": "explicación detallada",
      "severity": "critical|major|notable|minor",
      "implications": ["implicación 1", "implicación 2"],
      "supportingEvidence": ["ids de notas"],
      "recommendedAction": "acción recomendada",
      "sectionId": "id de sección donde aparecerá"
    }
  ]
}

Ordena por severidad (critical primero). Máximo 7 hallazgos.`;

    try {
        const response = await xaiClient.chat.completions.create({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.2,
            max_tokens: 2000,
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
            const parsed = JSON.parse(content);
            return z.array(KeyFindingSchema).parse(parsed.findings || parsed);
        }
    } catch (error) {
        console.error('[AnalysisAgent] Failed to extract findings:', error);
    }

    return [];
}

// ============================================================================
// Gap Identifier
// ============================================================================

function identifyGaps(evidence: EvidencePack, outline: OutlineSpec): Gap[] {
    const gaps: Gap[] = [];

    // Check which sections requiring research have no evidence
    const sectionsNeedingResearch = outline.sections.filter(s => s.requiresResearch);
    const coveredTopics = new Set(evidence.notes.map(n => n.topic.toLowerCase()));

    for (const section of sectionsNeedingResearch) {
        const sectionKeywords = section.title.toLowerCase().split(' ');
        const hasCoverage = sectionKeywords.some(kw =>
            Array.from(coveredTopics).some(topic => topic.includes(kw))
        );

        if (!hasCoverage) {
            gaps.push({
                id: `gap-${section.id}`,
                description: `Falta evidencia para la sección "${section.title}"`,
                impactedSections: [section.id],
                severity: section.type === 'analysis' || section.type === 'findings' ? 'significant' : 'minor',
                mitigation: 'Se usará síntesis basada en conocimiento general',
            });
        }
    }

    // Add explicit gaps from research
    for (const researchGap of evidence.gaps) {
        gaps.push({
            id: `gap-research-${gaps.length}`,
            description: researchGap,
            impactedSections: [],
            severity: 'minor',
            mitigation: 'Limitación declarada en el documento',
        });
    }

    return gaps;
}

// ============================================================================
// Contradiction Detector
// ============================================================================

async function detectContradictions(evidence: EvidencePack): Promise<Contradiction[]> {
    if (evidence.notes.length < 2) {
        return [];
    }

    const notesText = evidence.notes
        .slice(0, 20) // Limit for prompt size
        .map(n => `[${n.id}] ${n.content}`)
        .join('\n');

    const prompt = `Analiza estas notas de investigación y detecta contradicciones:

${notesText}

Responde en JSON:
{
  "contradictions": [
    {
      "id": "c1",
      "description": "descripción de la contradicción",
      "sources": ["ids de notas involucradas"],
      "resolution": "cómo se podría resolver (si es posible)"
    }
  ]
}

Si no hay contradicciones claras, devuelve un array vacío.`;

    try {
        const response = await xaiClient.chat.completions.create({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: 1000,
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
            const parsed = JSON.parse(content);
            return z.array(ContradictionSchema).parse(parsed.contradictions || []);
        }
    } catch (error) {
        console.error('[AnalysisAgent] Failed to detect contradictions:', error);
    }

    return [];
}

// ============================================================================
// Assumptions Extractor
// ============================================================================

function extractAssumptions(evidence: EvidencePack, gaps: Gap[]): string[] {
    const assumptions: string[] = [];

    // From evidence limitations
    for (const limitation of evidence.limitations) {
        assumptions.push(`Limitación de investigación: ${limitation}`);
    }

    // From gaps
    for (const gap of gaps) {
        if (gap.mitigation.includes('síntesis') || gap.mitigation.includes('conocimiento general')) {
            assumptions.push(`Supuesto: ${gap.description} - ${gap.mitigation}`);
        }
    }

    // Standard assumptions
    if (evidence.sources.length < 5) {
        assumptions.push('Supuesto: La muestra de fuentes puede no ser exhaustiva');
    }

    return assumptions;
}

// ============================================================================
// Quality Calculator
// ============================================================================

function calculateQuality(
    argumentGraph: ArgumentGraph,
    keyFindings: KeyFinding[],
    gaps: Gap[],
    contradictions: Contradiction[]
): AnalysisResult['analysisQuality'] {
    // Evidence coverage: how many claims have evidence
    const claimsWithEvidence = argumentGraph.nodes.filter(
        n => n.type === 'claim' && n.sourceIds.length > 0
    ).length;
    const totalClaims = argumentGraph.nodes.filter(n => n.type === 'claim').length;
    const evidenceCoverage = totalClaims > 0 ? (claimsWithEvidence / totalClaims) * 100 : 50;

    // Argument strength: average confidence
    const avgConfidence = argumentGraph.nodes.reduce((acc, n) => acc + n.confidence, 0) /
        Math.max(argumentGraph.nodes.length, 1);
    const argumentStrength = avgConfidence * 100;

    // Penalize for gaps and contradictions
    const gapPenalty = gaps.filter(g => g.severity === 'blocking' || g.severity === 'significant').length * 5;
    const contradictionPenalty = contradictions.length * 10;

    return {
        evidenceCoverage: Math.max(0, Math.min(100, evidenceCoverage - gapPenalty)),
        argumentStrength: Math.max(0, Math.min(100, argumentStrength - contradictionPenalty)),
        gapCount: gaps.length,
        contradictionCount: contradictions.length,
    };
}

// ============================================================================
// Helpers
// ============================================================================

export function getArgumentsForSection(
    argumentGraph: ArgumentGraph,
    sectionId: string
): ArgumentNode[] {
    return argumentGraph.nodes.filter(n => n.sectionId === sectionId);
}

export function getFindingsForSection(
    findings: KeyFinding[],
    sectionId: string
): KeyFinding[] {
    return findings.filter(f => f.sectionId === sectionId);
}

export function getCriticalFindings(findings: KeyFinding[]): KeyFinding[] {
    return findings.filter(f => f.severity === 'critical' || f.severity === 'major');
}
