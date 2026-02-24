/**
 * Production Mode Types
 * 
 * Core types for the agentic document production system.
 */

import { z } from 'zod';

// ============================================================================
// WorkOrder Schema - The contract for document production
// ============================================================================

export const DocumentIntentSchema = z.enum([
    'report',           // Informe
    'thesis',           // Tesis/Monografía
    'proposal',         // Propuesta
    'analysis',         // Análisis
    'presentation',     // Presentación
    'plan',             // Plan de trabajo
    'audit',            // Auditoría
    'comparison',       // Comparativa
    'executive_summary' // Resumen ejecutivo
]);
export type DocumentIntent = z.infer<typeof DocumentIntentSchema>;

export const AudienceSchema = z.enum([
    'executive',   // C-level, directivos
    'technical',   // Ingenieros, técnicos
    'academic',    // Profesores, revisores
    'operational', // Equipos operativos
    'general'      // Público general
]);
export type Audience = z.infer<typeof AudienceSchema>;

export const DeliverableSchema = z.enum(['word', 'excel', 'ppt', 'pdf']);
export type Deliverable = z.infer<typeof DeliverableSchema>;

export const ToneSchema = z.enum([
    'formal',         // Formal académico/corporativo
    'technical',      // Técnico con jerga
    'conversational', // Didáctico/accesible
    'executive'       // Conciso para ejecutivos
]);
export type Tone = z.infer<typeof ToneSchema>;

export const CitationStyleSchema = z.enum(['APA', 'IEEE', 'MLA', 'Chicago', 'none']);
export type CitationStyle = z.infer<typeof CitationStyleSchema>;

export const SourcePolicySchema = z.enum([
    'internal',  // Solo documentos del usuario
    'web',       // Solo búsqueda web
    'both',      // Interno + web
    'none'       // Síntesis sin fuentes
]);
export type SourcePolicy = z.infer<typeof SourcePolicySchema>;

export const WorkOrderSchema = z.object({
    id: z.string(),
    createdAt: z.date(),
    userId: z.string(),
    chatId: z.string().optional(),

    // Core intent
    intent: DocumentIntentSchema,
    topic: z.string().min(1).max(1000),
    description: z.string().optional(),

    // Output configuration
    audience: AudienceSchema.default('general'),
    deliverables: z.array(DeliverableSchema).min(1).default(['word']),
    tone: ToneSchema.default('formal'),
    citationStyle: CitationStyleSchema.default('none'),

    // Research configuration
    sourcePolicy: SourcePolicySchema.default('both'),
    uploadedDocuments: z.array(z.string()).optional(),

    // Constraints
    constraints: z.object({
        maxPages: z.number().min(1).max(500).optional(),
        maxSlides: z.number().min(1).max(100).optional(),
        deadline: z.date().optional(),
        language: z.string().default('es'),
        template: z.string().optional(),
        corporateStyle: z.boolean().default(false),
    }).default({}),

    // Budget limits (prevents runaway costs)
    budget: z.object({
        maxLLMCalls: z.number().default(50),
        maxSearchQueries: z.number().default(20),
        maxRetries: z.number().default(3),
        timeoutMinutes: z.number().default(10),
    }).default({}),

    // State
    status: z.enum(['pending', 'processing', 'qa', 'complete', 'failed']).default('pending'),
    currentStage: z.number().default(0),
    totalStages: z.number().default(10),

    // Dynamic/Intermediate State
    metadata: z.record(z.any()).optional(),
    excelData: z.array(z.array(z.any())).optional(),
    pptData: z.array(z.any()).optional(),
});
export type WorkOrder = z.infer<typeof WorkOrderSchema>;

// ============================================================================
// Pipeline Stages
// ============================================================================

export const PipelineStageSchema = z.enum([
    'intake',       // 1. Captura y normalización
    'blueprint',    // 2. Diseño de plan y estructura
    'research',     // 3. Investigación con evidencia
    'analysis',     // 4. Razonamiento y argumentos
    'writing',      // 5. Redacción por secciones
    'data',         // 6. Excel (si aplica)
    'slides',       // 7. PPT (si aplica)
    'qa',           // 8. QA + loop de corrección
    'consistency',  // 9. Coherencia cruzada
    'render'        // 10. Renderizado final
]);
export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export interface StageProgress {
    stage: PipelineStage;
    status: 'pending' | 'running' | 'complete' | 'failed' | 'skipped';
    progress: number; // 0-100
    message: string;
    startedAt?: Date;
    completedAt?: Date;
    error?: string;
}

// ============================================================================
// Evidence Pack - Research results
// ============================================================================

export interface EvidenceSource {
    id: string;
    type: 'web' | 'document' | 'internal' | 'user_upload';
    title: string;
    url?: string;
    content: string;
    excerpt: string;
    reliability: number; // 0-1
    retrievedAt: Date;
}

export interface EvidenceNote {
    id: string;
    sourceId: string;
    topic: string;
    content: string;
    isQuote: boolean;
    citationKey: string;
    page?: number;
}

export interface EvidencePack {
    sources: EvidenceSource[];
    notes: EvidenceNote[];
    dataPoints: Array<{
        label: string;
        value: number | string;
        unit?: string;
        sourceId: string;
    }>;
    gaps: string[]; // Topics that couldn't be researched
    limitations: string[];
}

// ============================================================================
// Content Spec - Canonical document structure
// ============================================================================

export interface Section {
    id: string;
    type: 'h1' | 'h2' | 'h3' | 'paragraph' | 'list' | 'table' | 'figure' | 'quote' | 'citation';
    content: string;
    title?: string;
    objective?: string;
    targetWordCount?: number;
    children?: Section[];
    metadata?: {
        citations?: string[];
        linkedData?: string[];
        wordCount?: number;
    };
}

export interface ContentSpec {
    title: string;
    subtitle?: string;
    authors: string[];
    date: string;
    abstract?: string;
    sections: Section[];
    bibliography: Array<{
        key: string;
        formatted: string;
        source: EvidenceSource;
    }>;
    appendices?: Section[];
}

// ============================================================================
// QA Rubric
// ============================================================================

export interface QACheck {
    name: string;
    passed: boolean;
    severity: 'critical' | 'major' | 'minor';
    message: string;
    fix?: string;
}

export interface QAReport {
    overallScore: number; // 0-100
    passed: boolean;
    checks: QACheck[];
    suggestions: string[];
    blockers: string[]; // Must fix before render
}

// ============================================================================
// Trace Map - Cross-document consistency
// ============================================================================

export interface TraceLink {
    claim: string;
    evidenceId: string;
    wordSection?: string;
    excelCell?: string;
    slideNumber?: number;
    verified: boolean;
}

export interface TraceMap {
    links: TraceLink[];
    inconsistencies: Array<{
        type: 'missing' | 'mismatch' | 'contradiction';
        description: string;
        locations: string[];
    }>;
    coverageScore: number; // 0-100
}

// ============================================================================
// Final Artifacts
// ============================================================================

export interface Artifact {
    type: Deliverable;
    filename: string;
    buffer: Buffer;
    mimeType: string;
    size: number;
    downloadUrl?: string; // URL for client download
    metadata: {
        pageCount?: number;
        slideCount?: number;
        sheetCount?: number;
        wordCount?: number;
    };
}

export interface ProductionResult {
    workOrderId: string;
    status: 'success' | 'partial' | 'failed';
    artifacts: Artifact[];
    summary: string;
    evidencePack: EvidencePack;
    traceMap: TraceMap;
    qaReport: QAReport;
    timing: {
        startedAt: Date;
        completedAt: Date;
        durationMs: number;
        stageTimings: Record<PipelineStage, number>;
    };
    costs: {
        llmCalls: number;
        searchQueries: number;
        tokensUsed: number;
    };
}

// ============================================================================
// Events
// ============================================================================

export interface ProductionEvent {
    type: 'stage_start' | 'stage_complete' | 'stage_error' | 'progress' | 'artifact' | 'complete';
    workOrderId: string;
    stage?: PipelineStage;
    progress?: number;
    message: string;
    data?: unknown;
    timestamp: Date;
}

export type ProductionEventHandler = (event: ProductionEvent) => void;
