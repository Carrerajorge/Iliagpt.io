/**
 * Writing Agent
 * 
 * Redacción por secciones (no "todo junto"):
 * - Respeta límites por sección
 * - Inserta citas con keys
 * - Usa el ArgumentGraph
 * - Valida estructura interna
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { EvidencePack, EvidenceNote, ContentSpec, Section } from './types';
import type { OutlineSpec, Section as OutlineSection } from './blueprintAgent';
import type { AnalysisResult, ArgumentNode, KeyFinding } from './analysisAgent';

const xaiClient = new OpenAI({
    baseURL: 'https://api.x.ai/v1',
    apiKey: process.env.XAI_API_KEY || "missing",
});

const MODEL = 'grok-4-1-fast-non-reasoning';

// ============================================================================
// Types
// ============================================================================

export interface SectionDraft {
    sectionId: string;
    title: string;
    content: string;
    wordCount: number;
    citations: string[];
    quality: {
        objectiveMet: boolean;
        lengthCompliant: boolean;
        hasCitations: boolean;
        score: number;
    };
}

export interface WritingResult {
    sections: SectionDraft[];
    totalWordCount: number;
    bibliography: Array<{
        key: string;
        formatted: string;
        sourceId: string;
    }>;
    qualityReport: {
        sectionsCompleted: number;
        sectionsFailed: number;
        averageQuality: number;
    };
}

export interface WritingContext {
    tone: string;
    audience: string;
    citationStyle: string;
    language: string;
}

// ============================================================================
// Writing Agent
// ============================================================================

export async function writeSections(
    outline: OutlineSpec,
    analysis: AnalysisResult,
    evidence: EvidencePack,
    context: WritingContext
): Promise<WritingResult> {
    console.log(`[WritingAgent] Writing ${outline.sections.length} sections`);

    const sections: SectionDraft[] = [];
    const citationsUsed: Set<string> = new Set();

    // Write sections sequentially for coherence
    for (let i = 0; i < outline.sections.length; i++) {
        const outlineSection = outline.sections[i];
        console.log(`[WritingAgent] Writing section ${i + 1}/${outline.sections.length}: ${outlineSection.title}`);

        const previousSections = sections.slice(-2); // Context from last 2 sections

        // Get relevant arguments and findings for this section
        const relevantArguments = getRelevantArguments(analysis, outlineSection.id);
        const relevantFindings = getRelevantFindings(analysis, outlineSection);
        const relevantNotes = getRelevantNotes(evidence, outlineSection);

        // Draft the section
        let draft = await draftSection(
            outlineSection,
            relevantArguments,
            relevantFindings,
            relevantNotes,
            previousSections,
            context
        );

        // Validate and retry if needed
        const validation = validateSection(draft, outlineSection);
        if (!validation.passed) {
            console.log(`[WritingAgent] Section failed validation, retrying...`);
            draft = await retrySection(draft, outlineSection, validation.feedback, context);
        }

        // Track citations
        draft.citations.forEach(c => citationsUsed.add(c));

        sections.push(draft);
    }

    // Build bibliography
    const bibliography = buildBibliography(evidence, citationsUsed, context.citationStyle);

    // Calculate quality report
    const qualityReport = calculateQualityReport(sections);

    return {
        sections,
        totalWordCount: sections.reduce((acc, s) => acc + s.wordCount, 0),
        bibliography,
        qualityReport,
    };
}

// ============================================================================
// Section Drafting
// ============================================================================

async function draftSection(
    section: OutlineSection,
    arguments_: ArgumentNode[],
    findings: KeyFinding[],
    notes: EvidenceNote[],
    previousSections: SectionDraft[],
    context: WritingContext
): Promise<SectionDraft> {
    const previousContext = previousSections.length > 0
        ? `SECCIONES ANTERIORES (para coherencia):\n${previousSections.map(s => `- ${s.title}: ${s.content.substring(0, 200)}...`).join('\n')}`
        : '';

    const argumentsText = arguments_.length > 0
        ? `ARGUMENTOS A INCLUIR:\n${arguments_.map(a => `- [${a.type}] ${a.content} (confianza: ${a.confidence})`).join('\n')}`
        : '';

    const findingsText = findings.length > 0
        ? `HALLAZGOS A MENCIONAR:\n${findings.map(f => `- ${f.title}: ${f.description}`).join('\n')}`
        : '';

    const notesText = notes.length > 0
        ? `NOTAS DE INVESTIGACIÓN (citar con [key]):\n${notes.map(n => `- [${n.citationKey}] ${n.content}`).join('\n')}`
        : '';

    const prompt = `Redacta la sección "${section.title}" para un documento formal.

OBJETIVO DE LA SECCIÓN: ${section.objective}
TIPO: ${section.type}
LÍMITE DE PALABRAS: ${section.targetWordCount} (±20%)
TONO: ${context.tone}
AUDIENCIA: ${context.audience}
IDIOMA: ${context.language}
ESTILO DE CITAS: ${context.citationStyle}

${previousContext}

${argumentsText}

${findingsText}

${notesText}

INSTRUCCIONES:
1. Cumple el objetivo de la sección
2. Respeta el límite de palabras
3. Usa las notas de investigación y cita con [key] donde corresponda
4. Mantén coherencia con las secciones anteriores
5. Usa un tono ${context.tone} apropiado para ${context.audience}
6. Si hay hallazgos relevantes, intégralos naturalmente
7. No inventes datos ni fuentes

Responde en JSON:
{
  "title": "${section.title}",
  "content": "Texto completo de la sección en formato Markdown...",
  "citations": ["key1", "key2"],
  "wordCount": número_aproximado
}`;

    try {
        const response = await xaiClient.chat.completions.create({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.4,
            max_tokens: 4000,
        });

        const responseContent = response.choices[0]?.message?.content;
        if (responseContent) {
            const parsed = JSON.parse(responseContent);
            const wordCount = parsed.content.split(/\s+/).length;

            return {
                sectionId: section.id,
                title: parsed.title || section.title,
                content: parsed.content,
                wordCount,
                citations: parsed.citations || [],
                quality: {
                    objectiveMet: true, // Will be validated
                    lengthCompliant: isLengthCompliant(wordCount, section.targetWordCount),
                    hasCitations: (parsed.citations || []).length > 0,
                    score: 0, // Will be calculated
                },
            };
        }
    } catch (error) {
        console.error(`[WritingAgent] Failed to draft section ${section.title}:`, error);
    }

    // Fallback
    return {
        sectionId: section.id,
        title: section.title,
        content: `[Contenido pendiente para: ${section.title}]\n\nObjetivo: ${section.objective}`,
        wordCount: 0,
        citations: [],
        quality: {
            objectiveMet: false,
            lengthCompliant: false,
            hasCitations: false,
            score: 0,
        },
    };
}

async function retrySection(
    originalDraft: SectionDraft,
    section: OutlineSection,
    feedback: string,
    context: WritingContext
): Promise<SectionDraft> {
    const prompt = `Mejora esta sección que no pasó la validación:

SECCIÓN ORIGINAL:
${originalDraft.content}

FEEDBACK:
${feedback}

OBJETIVO: ${section.objective}
LÍMITE: ${section.targetWordCount} palabras

Responde en JSON:
{
  "content": "texto mejorado...",
  "citations": ["keys"],
  "wordCount": número
}`;

    try {
        const response = await xaiClient.chat.completions.create({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.3,
            max_tokens: 3000,
        });

        const responseContent = response.choices[0]?.message?.content;
        if (responseContent) {
            const parsed = JSON.parse(responseContent);
            const wordCount = parsed.content.split(/\s+/).length;

            return {
                ...originalDraft,
                content: parsed.content,
                wordCount,
                citations: parsed.citations || originalDraft.citations,
                quality: {
                    objectiveMet: true,
                    lengthCompliant: isLengthCompliant(wordCount, section.targetWordCount),
                    hasCitations: (parsed.citations || []).length > 0,
                    score: 70, // Retry version
                },
            };
        }
    } catch (error) {
        console.error(`[WritingAgent] Retry failed for ${section.title}:`, error);
    }

    return originalDraft;
}

// ============================================================================
// Validation
// ============================================================================

interface ValidationResult {
    passed: boolean;
    feedback: string;
    issues: string[];
}

function validateSection(draft: SectionDraft, section: OutlineSection): ValidationResult {
    const issues: string[] = [];

    // Check length
    const minWords = section.targetWordCount * 0.8;
    const maxWords = section.targetWordCount * 1.2;

    if (draft.wordCount < minWords) {
        issues.push(`Muy corto: ${draft.wordCount} palabras (mínimo: ${Math.round(minWords)})`);
    }
    if (draft.wordCount > maxWords) {
        issues.push(`Muy largo: ${draft.wordCount} palabras (máximo: ${Math.round(maxWords)})`);
    }

    // Check for placeholder content
    if (draft.content.includes('[Contenido pendiente') || draft.content.includes('TODO')) {
        issues.push('Contiene contenido placeholder');
    }

    // Check for empty content
    if (draft.content.trim().length < 50) {
        issues.push('Contenido insuficiente');
    }

    // Check citations for research sections
    if (section.requiresResearch && draft.citations.length === 0) {
        issues.push('Sección de investigación sin citas');
    }

    // Update quality
    draft.quality.lengthCompliant = draft.wordCount >= minWords && draft.wordCount <= maxWords;
    draft.quality.objectiveMet = issues.length === 0;
    draft.quality.score = Math.max(0, 100 - (issues.length * 20));

    return {
        passed: issues.length === 0,
        feedback: issues.join('. '),
        issues,
    };
}

// ============================================================================
// Helpers
// ============================================================================

function getRelevantArguments(analysis: AnalysisResult, sectionId: string): ArgumentNode[] {
    return analysis.argumentGraph.nodes.filter(n => n.sectionId === sectionId);
}

function getRelevantFindings(analysis: AnalysisResult, section: OutlineSection): KeyFinding[] {
    // Match by section type or ID
    return analysis.keyFindings.filter(f =>
        f.sectionId === section.id ||
        (section.type === 'findings' || section.type === 'results') ||
        (section.type === 'conclusions' && (f.severity === 'critical' || f.severity === 'major'))
    );
}

function getRelevantNotes(evidence: EvidencePack, section: OutlineSection): EvidenceNote[] {
    const sectionKeywords = section.title.toLowerCase().split(' ');

    return evidence.notes.filter(note => {
        const noteTopic = note.topic.toLowerCase();
        return sectionKeywords.some(kw => kw.length > 3 && noteTopic.includes(kw));
    });
}

function isLengthCompliant(wordCount: number, target: number): boolean {
    return wordCount >= target * 0.8 && wordCount <= target * 1.2;
}

function buildBibliography(
    evidence: EvidencePack,
    citationsUsed: Set<string>,
    citationStyle: string
): WritingResult['bibliography'] {
    const bibliography: WritingResult['bibliography'] = [];

    for (const note of evidence.notes) {
        if (citationsUsed.has(note.citationKey)) {
            const source = evidence.sources.find(s => s.id === note.sourceId);
            if (source) {
                bibliography.push({
                    key: note.citationKey,
                    formatted: formatCitation(source, citationStyle),
                    sourceId: source.id,
                });
            }
        }
    }

    // Sort alphabetically
    return bibliography.sort((a, b) => a.key.localeCompare(b.key));
}

function formatCitation(source: { title: string; url?: string }, style: string): string {
    switch (style) {
        case 'APA':
            return `${source.title}. ${source.url ? `Recuperado de ${source.url}` : ''}`;
        case 'IEEE':
            return `"${source.title}," ${source.url ? `[Online]. Available: ${source.url}` : ''}`;
        case 'MLA':
            return `"${source.title}." ${source.url ? `Web. ${source.url}` : ''}`;
        default:
            return source.title;
    }
}

function calculateQualityReport(sections: SectionDraft[]): WritingResult['qualityReport'] {
    const completed = sections.filter(s => s.quality.score >= 70).length;
    const failed = sections.length - completed;
    const avgQuality = sections.reduce((acc, s) => acc + s.quality.score, 0) / sections.length;

    return {
        sectionsCompleted: completed,
        sectionsFailed: failed,
        averageQuality: Math.round(avgQuality),
    };
}

// ============================================================================
// Content Spec Builder
// ============================================================================

export function buildContentSpec(
    writingResult: WritingResult,
    outline: OutlineSpec
): ContentSpec {
    const sections: Section[] = writingResult.sections.map(draft => ({
        id: draft.sectionId,
        type: 'paragraph' as const,
        content: draft.content,
        metadata: {
            citations: draft.citations,
            wordCount: draft.wordCount,
        },
    }));

    return {
        title: outline.title,
        subtitle: outline.subtitle,
        authors: ['ILIAGPT AI'],
        date: new Date().toISOString().split('T')[0],
        abstract: sections.find(s =>
            outline.sections.find(os => os.id === s.id)?.type === 'executive_summary'
        )?.content,
        sections,
        bibliography: writingResult.bibliography.map(b => ({
            key: b.key,
            formatted: b.formatted,
            source: { id: b.sourceId } as any,
        })),
    };
}
