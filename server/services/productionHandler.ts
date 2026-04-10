/**
 * Production Handler
 * 
 * Handles document production requests (Word, Excel, PPT, PDF)
 * by intercepting CREATE_* intents and executing the production pipeline.
 */

import type { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { StepStreamer } from "../agent/stepStreamer";
import { officeEngine } from "../lib/office/engine/OfficeEngine";
import {
    markOfficeRunSessionFinished,
    registerOfficeRunSession,
    type OfficeRunSession,
} from "../lib/office/runSessionRegistry";
import type { IntentResult } from './intentRouter';
import { libraryService } from "./libraryService";
import { storage } from "../storage";
import { conversationStateService } from "./conversationStateService";
import { buildAssistantMessage, buildAssistantMessageMetadata } from "@shared/assistantMessage";
import {
    startProductionPipeline,
    type ProductionEvent,
    type ProductionResult,
    type Artifact,
    type DocumentIntent,
} from '../agent/production';
import { exportAcademicArticlesFromPrompt } from './academicArticlesExport';
import { generateFilePreview } from './filePreviewService';
import {
    generateProfessionalPptx,
    type PptxRequest,
    type PptxSlide,
} from "./documentGenerators/professionalPptxGenerator";

// ============================================================================
// Types
// ============================================================================

export interface ProductionRequest {
    message: string;
    userId: string;
    chatId: string;
    conversationId?: string | null;
    requestId?: string;
    assistantMessageId?: string | null;
    intentResult: IntentResult;
    locale?: string;
}

interface ProductionPresentationHints {
    template?: string;
    theme?: string;
    brand?: string;
}

type ArtifactGenerationDocKind = "docx" | "xlsx" | "pptx" | "pdf";
type ArtifactGenerationEngine = "office-engine" | "artifact-engine" | "artifact-pipeline";

interface ArtifactGenerationSpec {
    workflow: "artifact_generation";
    engine: ArtifactGenerationEngine;
    requestedDocKind: ArtifactGenerationDocKind;
}

function extractPresentationHints(message: string): ProductionPresentationHints {
    const lower = String(message || '').toLowerCase();

    const templates = [
        'corporate',
        'modern',
        'gradient',
        'academic',
        'minimal',
        'tech',
        'creative',
        'executive',
    ];

    const matchedTemplate = templates.find((template) => lower.includes(template));

    const brandMatch = message.match(/(?:branding|marca|brand)(?:\s*[:=-]|\s+de\s+|\s+)([A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ&().,'\- ]{2,80})/i);
    const themeMatch = message.match(/(?:tema|theme|paleta)(?:\s*[:=-]|\s+)([A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ&().,'\- ]{2,60})/i);

    return {
        template: matchedTemplate,
        theme: themeMatch?.[1]?.trim(),
        brand: brandMatch?.[1]?.trim(),
    };
}

function resolveRequestedDocKind(intentResult: IntentResult, message?: string): ArtifactGenerationDocKind {
    const requestedFormat = intentResult.output_format;
    if (requestedFormat === "docx" || requestedFormat === "xlsx" || requestedFormat === "pptx" || requestedFormat === "pdf") {
        return requestedFormat;
    }

    const lower = String(message || "").toLowerCase();
    if (/\b(pdf)\b/i.test(lower)) return "pdf";
    if (/\b(excel|xlsx|spreadsheet|hoja de c[aá]lculo)\b/i.test(lower)) return "xlsx";
    if (/\b(ppt|pptx|powerpoint|presentaci[oó]n|slides?)\b/i.test(lower)) return "pptx";
    return intentResult.intent === "CREATE_SPREADSHEET"
        ? "xlsx"
        : intentResult.intent === "CREATE_PRESENTATION"
            ? "pptx"
            : "docx";
}

function resolveArtifactGenerationEngine(
    requestedDocKind: ArtifactGenerationDocKind,
    deliverables: Array<'word' | 'excel' | 'ppt' | 'pdf'>,
): ArtifactGenerationEngine {
    if (requestedDocKind === "docx" && deliverables.length === 1 && deliverables[0] === "word") {
        return "office-engine";
    }

    if (requestedDocKind === "pptx" && deliverables.length === 1 && deliverables[0] === "ppt") {
        return "artifact-engine";
    }

    return "artifact-pipeline";
}

function resolveArtifactGenerationSpec(
    intentResult: IntentResult,
    deliverables: Array<'word' | 'excel' | 'ppt' | 'pdf'>,
    message?: string,
): ArtifactGenerationSpec {
    const requestedDocKind = resolveRequestedDocKind(intentResult, message);
    return {
        workflow: "artifact_generation",
        engine: resolveArtifactGenerationEngine(requestedDocKind, deliverables),
        requestedDocKind,
    };
}

function shouldUseOfficeEngine(spec: ArtifactGenerationSpec): boolean {
    return spec.engine === "office-engine";
}

function shouldUseProfessionalPptxEngine(
    spec: ArtifactGenerationSpec,
    deliverables: Array<'word' | 'excel' | 'ppt' | 'pdf'>,
): boolean {
    return spec.engine === "artifact-engine"
        && spec.requestedDocKind === "pptx"
        && deliverables.length === 1
        && deliverables[0] === "ppt";
}

const OFFICE_STAGE_PROGRESS: Record<string, number> = {
    plan: 8,
    unpack: 16,
    parse: 26,
    map: 38,
    edit: 54,
    validate: 68,
    repack: 80,
    roundtrip_diff: 88,
    preview: 94,
    export: 100,
};

function inferOfficeStageFromStep(step: { title?: string; type?: string }): string {
    const title = String(step.title || "").toLowerCase();
    if (title.includes("plan")) return "plan";
    if (title.includes("descompr")) return "unpack";
    if (title.includes("parse")) return "parse";
    if (title.includes("mapa")) return "map";
    if (title.includes("edici")) return "edit";
    if (title.includes("valid")) return "validate";
    if (title.includes("repack")) return "repack";
    if (title.includes("round-trip") || title.includes("roundtrip")) return "roundtrip_diff";
    if (title.includes("vista previa") || title.includes("preview")) return "preview";
    if (title.includes("export")) return "export";
    return step.type === "reading" ? "unpack" : step.type === "editing" ? "edit" : "plan";
}

function normalizeArtifactTopic(raw: string): string {
    return String(raw || "")
        .replace(/\b(crea(?:r)?|genera(?:r)?|haz|hacer|arma(?:r)?|prepara(?:r)?|construye|elabora)\b/gi, " ")
        .replace(/\b(un|una|unos|unas|de|del|para|sobre|con)\b/gi, " ")
        .replace(/\b(pptx?|powerpoint|presentaci[oó]n(?:es)?|diapositivas?|slides?|deck)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function toTitleCase(input: string): string {
    return String(input || "")
        .split(/\s+/)
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(" ")
        .trim();
}

function resolveArtifactTopic(intentResult: IntentResult, message: string, fallback: string): string {
    const slotTopic = [
        intentResult.slots.title,
        intentResult.slots.topic,
        intentResult.slots.subject,
    ].find((value) => typeof value === "string" && value.trim().length > 0);

    if (slotTopic) {
        return normalizeArtifactTopic(slotTopic);
    }

    const trailingTopicMatch = message.match(/(?:sobre|de|para)\s+(.+)$/i);
    if (trailingTopicMatch?.[1]) {
        const topic = normalizeArtifactTopic(trailingTopicMatch[1]);
        if (topic) return topic;
    }

    const normalizedFromMessage = normalizeArtifactTopic(message);
    return normalizedFromMessage || fallback;
}

function resolveProfessionalPptTheme(hints: ProductionPresentationHints, message: string): string {
    const normalized = `${hints.template || ""} ${hints.theme || ""} ${message}`.toLowerCase();

    if (/\b(executive|ejecutiv|board|directiv|geren)\b/.test(normalized)) return "executive-dark";
    if (/\b(minimal|minimalista|academic|academi)\b/.test(normalized)) return "minimal-gray";
    if (/\b(green|verde|sostenib|nature)\b/.test(normalized)) return "nature-green";
    if (/\b(creative|creativ|gradient|warm|amber|orange)\b/.test(normalized)) return "warm-amber";
    if (/\b(tech|tecnolog|dark)\b/.test(normalized)) return "executive-dark";

    return "corporate-blue";
}

function buildProfessionalPptSlides(topic: string, message: string): PptxSlide[] {
    const lower = String(message || "").toLowerCase();
    const wantsFormulas = /\b(f[oó]rmulas?|formulas?|kpi|kpis|m[eé]tricas?|metricas?|roi|cac|ltv)\b/.test(lower);
    const isSalesDeck = /\b(ventas?|sales|comercial|pipeline|funnel|pricing|revenue|ingresos?)\b/.test(lower);
    const subject = toTitleCase(topic || "Presentación Ejecutiva");

    const summaryBullets = isSalesDeck
        ? [
            `Marco ejecutivo para acelerar ${subject.toLowerCase()} con foco en margen, conversión y recurrencia.`,
            "Lectura rápida de prioridades, cuellos de botella y decisiones recomendadas para comité.",
            "Estructura lista para revisión con dirección comercial y operaciones.",
        ]
        : [
            `Visión ejecutiva del frente ${subject.toLowerCase()} con enfoque en impacto, control y ejecución.`,
            "Resumen listo para presentar a liderazgo con prioridades y riesgos críticos.",
            "Secuencia clara de implementación, seguimiento y gobierno del trabajo.",
        ];

    const leftBullets = isSalesDeck
        ? [
            "Captación con criterios de calidad y priorización por valor esperado.",
            "Seguimiento semanal de conversión por etapa del funnel.",
            "Estandarización del discurso comercial y política de descuentos.",
        ]
        : [
            "Definición de responsables, ritmo de seguimiento y tablero de control.",
            "Visibilidad de dependencias, hitos y puntos de decisión.",
            "Régimen de revisión para corregir desvíos temprano.",
        ];

    const rightBullets = isSalesDeck
        ? [
            "Descuento excesivo que erosiona margen y ticket promedio.",
            "Funnel inflado sin calidad comercial ni pronóstico confiable.",
            "Dependencia de pocas cuentas o de un solo canal de adquisición.",
        ]
        : [
            "Sobrecarga operativa por procesos manuales o poco estandarizados.",
            "Riesgo de retrabajo por criterios ambiguos o métricas inconsistentes.",
            "Pérdida de trazabilidad entre planeación, ejecución y control.",
        ];

    const metricRows = isSalesDeck
        ? [
            ["Ingresos", "Precio promedio x Unidades vendidas", "Monitorea ventas brutas por periodo"],
            ["Ticket promedio", "Ingresos / Número de pedidos", "Evalúa monetización por cliente"],
            ["Tasa de conversión", "Clientes cerrados / Leads calificados", "Mide eficiencia del funnel"],
            ["CAC", "Inversión comercial / Clientes nuevos", "Controla costo de adquisición"],
            ["Margen comercial", "(Ingresos - Costos directos) / Ingresos", "Protege rentabilidad"],
        ]
        : [
            ["Avance del plan", "Hitos completados / Hitos planificados", "Visibilidad de ejecución"],
            ["Cumplimiento SLA", "Casos dentro de SLA / Casos totales", "Control operativo"],
            ["Productividad", "Entregables completados / FTE", "Rendimiento del equipo"],
            ["Calidad", "Incidencias críticas / Entregables", "Control de retrabajo"],
        ];

    return [
        {
            type: "title",
            title: subject,
            subtitle: wantsFormulas
                ? "Presentación profesional con fórmulas, KPIs y narrativa ejecutiva"
                : "Presentación ejecutiva lista para revisión y descarga",
        },
        {
            type: "content",
            title: "Resumen ejecutivo",
            bullets: summaryBullets,
        },
        {
            type: "two-column",
            title: isSalesDeck ? "Palancas comerciales y riesgos a controlar" : "Pilares y riesgos de implementación",
            leftBullets,
            rightBullets,
        },
        {
            type: "table",
            title: wantsFormulas ? "Fórmulas y KPIs prioritarios" : "Indicadores de seguimiento",
            tableData: {
                headers: ["Métrica", "Fórmula", "Uso"],
                rows: metricRows,
            },
        },
        {
            type: "content",
            title: "Plan de 30-60-90 días",
            bullets: [
                `30 días: alinear objetivos, métricas y responsables para ${subject.toLowerCase()}.`,
                "60 días: ejecutar piloto, estabilizar datos y validar cadencia de seguimiento.",
                "90 días: escalar la operación, cerrar brechas y formalizar gobierno continuo.",
            ],
        },
        {
            type: "closing",
            title: "Siguientes pasos",
            subtitle: "Documento listo para comité, revisión interna o envío a dirección.",
        },
    ];
}

function buildProfessionalPptxRequest(
    intentResult: IntentResult,
    message: string,
    hints: ProductionPresentationHints,
): PptxRequest {
    const topic = resolveArtifactTopic(intentResult, message, "Presentación Ejecutiva");
    const title = toTitleCase(topic || "Presentación Ejecutiva");
    const subtitleParts = [
        hints.brand ? `Marca: ${hints.brand}` : null,
        "Generado automáticamente con PptxGenJS",
    ].filter(Boolean);

    return {
        title,
        subtitle: subtitleParts.join(" · "),
        author: "IliaGPT",
        theme: resolveProfessionalPptTheme(hints, message),
        slides: buildProfessionalPptSlides(title, message),
    };
}

async function buildArtifactPreview(artifact: Artifact): Promise<{ previewUrl?: string; previewHtml?: string } | null> {
    try {
        const preview = await generateFilePreview(artifact.filename, artifact.mimeType || '', artifact.buffer);
        if (preview.html) {
            return { previewHtml: preview.html };
        }
    } catch (error) {
        console.warn('[ProductionHandler] Preview generation failed:', error instanceof Error ? error.message : error);
    }

    return null;
}

export interface ProductionHandlerResult {
    handled: boolean;
    result?: ProductionResult;
    error?: string;
    assistantContent?: string;
    artifact?: {
        type: string;
        filename: string;
        downloadUrl: string;
        previewUrl?: string;
        previewHtml?: string;
        size?: number;
        mimeType?: string;
        metadata?: Record<string, unknown>;
    };
}

// ============================================================================
// Intent Detection
// ============================================================================

const PRODUCTION_INTENTS = [
    'CREATE_DOCUMENT',
    'CREATE_PRESENTATION',
    'CREATE_SPREADSHEET',
] as const;

// Patterns that indicate user wants to SEARCH first, not just create a document
const SEARCH_FIRST_PATTERNS = [
    // "buscame X articulos/papers"
    /buscame\s+\d+\s*(art[ií]culos?|papers?|estudios?|investigacion)/i,
    /buscarme\s+\d+\s*(art[ií]culos?|papers?|estudios?|investigacion)/i,
    /busca\s+\d+\s*(art[ií]culos?|papers?|estudios?)/i,
    /buscar\s+\d+\s*(art[ií]culos?|papers?|estudios?)/i,
    /encontrar\s+\d+\s*(art[ií]culos?|papers?|estudios?)/i,
    /dame\s+\d+\s*(art[ií]culos?|papers?|estudios?|citas?)/i,
    /necesito\s+\d+\s*(art[ií]culos?|papers?|estudios?|referencias?)/i,

    // Singular: "buscarme un artículo/paper/estudio"
    /buscame\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /buscarme\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /busca\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /buscar\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /encuentra(?:me)?\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /dame\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /necesito\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    
    // "articulos cientificos de/sobre"
    /art[ií]culos?\s+cient[ií]ficos?\s+(de|sobre|en|d)\s*/i,
    /busca.*art[ií]culos?\s+cient[ií]ficos?/i,
    /buscame.*art[ií]culos?\s+cient[ií]ficos?/i,
    
    // Explicit search requests
    /buscar?\s*(art[ií]culos?\s+)?cient[ií]ficos?\s+sobre/i,
    /scholar\s+search/i,
    /google\s+scholar/i,
    /scopus/i,
    /pubmed/i,
    /scielo/i,
];

function requiresSearchFirst(message: string): boolean {
    return SEARCH_FIRST_PATTERNS.some(pattern => pattern.test(message));
}

// Specialized workflow: "buscarme N articulos cientificos ... en excel ... y citas APA en word"
function isAcademicArticlesExportRequest(message: string): boolean {
    const wantsAcademic =
        /\b(art[ií]culos?|paper(?:s)?|estudio(?:s)?|investigaci[óo]n(?:es)?|scopus|scielo|pubmed|wos|web\s*of\s*science)\b/i.test(message);
    const wantsCount =
        /\b(?:buscarme|buscame|dame|necesito|encuentra(?:me)?)\b/i.test(message) && /\b\d{2,3}\b/.test(message);
    const wantsFile =
        /\b(excel|xlsx|word|docx)\b/i.test(message);
    return wantsAcademic && wantsCount && wantsFile;
}

function wantsArtifactOutput(message: string): boolean {
    const lower = message.toLowerCase();
    // If user mentions any concrete output format/action, we should allow production pipeline.
    return (
        /\b(excel|xlsx|hoja\s+de\s+c[aá]lculo|spreadsheet)\b/i.test(message) ||
        /\b(pptx?|powerpoint|presentaci[oó]n|diapositivas|slides?)\b/i.test(message) ||
        /\b(word|docx|documento)\b/i.test(message) ||
        /\bpdf\b/i.test(message) ||
        /\b(exporta|exportar|genera|generar|crea|crear|haz|hacer|construye|prepara)\b/i.test(message) &&
        /(excel|xlsx|ppt|pptx|powerpoint|word|docx|pdf)/i.test(message)
    );
}

function isReservationAutomationRequest(message: string): boolean {
    const normalized = message.toLowerCase();

    const hasReservationVerb = /\b(reserva(?:r|cion|ción)?|reservation|book(?:ing)?)\b/i.test(normalized);
    const hasReservationContext =
        /\b(restaurante|restaurant|mesa|table|cala|covermanager|mesa247|hotel|vuelo|flight)\b/i.test(normalized) ||
        /\b\d{1,2}\s*(personas?|people|guests?|comensales?)\b/i.test(normalized) ||
        /\b(?:a las|at)\s*\d{1,2}(?::\d{2})?\b/i.test(normalized) ||
        /\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/i.test(normalized);

    return hasReservationVerb && hasReservationContext;
}

export function isProductionIntent(intentResult: IntentResult | null, message?: string): boolean {
    if (!intentResult) return false;

    // Reservation/booking requests must route to web automation, not to document production.
    if (message && isReservationAutomationRequest(message)) {
        console.log(`[ProductionHandler] Reservation request detected, skipping production mode for: "${message.slice(0, 70)}..."`);
        return false;
    }

    // Previously we skipped production for "search-first" prompts.
    // That breaks the core workflow: "busca N artículos y exporta a Excel / crea PPT".
    // New rule: only skip production if it's search-first AND user is NOT asking for an output artifact.
    if (message && requiresSearchFirst(message) && !wantsArtifactOutput(message)) {
        console.log(`[ProductionHandler] Search-first detected (no artifact requested), skipping production mode for: "${message.slice(0, 50)}..."`);
        return false;
    }

    return PRODUCTION_INTENTS.includes(intentResult.intent as any);
}

export function getDeliverables(intentResult: IntentResult, message?: string): ('word' | 'excel' | 'ppt' | 'pdf')[] {
    const deliverables: ('word' | 'excel' | 'ppt' | 'pdf')[] = [];

    switch (intentResult.intent) {
        case 'CREATE_DOCUMENT':
            deliverables.push('word');
            if (intentResult.output_format === 'pdf') {
                deliverables.push('pdf');
            }
            break;
        case 'CREATE_PRESENTATION':
            deliverables.push('ppt');
            break;
        case 'CREATE_SPREADSHEET':
            deliverables.push('excel');
            break;
    }

    const outputFormatToDeliverable: Record<string, 'word' | 'excel' | 'ppt' | 'pdf'> = {
        docx: 'word',
        xlsx: 'excel',
        pptx: 'ppt',
        pdf: 'pdf',
    };

    const outputDeliverable = intentResult.output_format
        ? outputFormatToDeliverable[intentResult.output_format]
        : undefined;
    if (outputDeliverable && !deliverables.includes(outputDeliverable)) {
        deliverables.push(outputDeliverable);
    }

    // Check for compound requests in slots
    const topic = intentResult.slots.topic?.toLowerCase() || '';
    const combined = `${topic} ${message || ''}`.toLowerCase();

    if (/\b(excel|xlsx|hoja\s+de\s+c[aá]lculo|spreadsheet)\b/i.test(combined)) {
        if (!deliverables.includes('excel')) deliverables.push('excel');
    }
    if (/\b(presentaci[oó]n|presentation|pptx?|powerpoint|diapositivas?|slides?)\b/i.test(combined)) {
        if (!deliverables.includes('ppt')) deliverables.push('ppt');
    }
    if (/\b(word|documento|document|docx)\b/i.test(combined)) {
        if (!deliverables.includes('word')) deliverables.push('word');
    }
    if (/\bpdf\b/i.test(combined)) {
        if (!deliverables.includes('pdf')) deliverables.push('pdf');
    }

    return deliverables;
}

// ============================================================================
// Artifact Storage
// ============================================================================

const ARTIFACTS_DIR = path.join(process.cwd(), 'artifacts');

// Ensure artifacts directory exists
function ensureArtifactsDir(): void {
    if (!fs.existsSync(ARTIFACTS_DIR)) {
        fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
        console.log(`[ProductionHandler] Created artifacts directory: ${ARTIFACTS_DIR}`);
    }
}

async function saveArtifact(
    artifact: Artifact,
    runId: string,
    userId: string,
    chatId: string
): Promise<{ downloadUrl: string; library?: { fileUuid: string; storageUrl: string } }> {
    ensureArtifactsDir();

    // Use a readable filename with timestamp to avoid collisions
    const timestamp = Date.now();
    const safeFilename = artifact.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storedFilename = `${timestamp}_${safeFilename}`;
    const filePath = path.join(ARTIFACTS_DIR, storedFilename);

    // Write buffer to file
    await fs.promises.writeFile(filePath, artifact.buffer);

    // Return download URL - matches the static express endpoint
    const downloadUrl = `/api/artifacts/${storedFilename}`;

    console.log(`[ProductionHandler] Saved artifact: ${artifact.filename} -> ${filePath}`);
    console.log(`[ProductionHandler] Download URL: ${downloadUrl}`);

    // Also save to Library (Object Storage + DB metadata) for the user's Library view.
    // If library write fails, we still return the downloadable artifact URL.
    let library: { fileUuid: string; storageUrl: string } | undefined;
    try {
        const contentType = artifact.mimeType || "application/octet-stream";
        const upload = await libraryService.generateUploadUrl(userId, storedFilename, contentType);

        // Upload raw buffer
        await fetch(upload.uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": contentType },
            body: artifact.buffer,
        });

        const ext = path.extname(storedFilename).replace(/^\./, "");
        const type =
            artifact.type === "word" || artifact.type === "pdf"
                ? "document"
                : artifact.type === "excel"
                    ? "spreadsheet"
                    : artifact.type === "ppt"
                        ? "presentation"
                        : "other";

        const saved = await libraryService.saveFileMetadata(userId, upload.objectPath, {
            name: storedFilename,
            originalName: artifact.filename,
            description: `Generated by production pipeline run ${runId}`,
            type,
            mimeType: contentType,
            extension: ext,
            size: artifact.size,
            metadata: {
                runId,
                chatId,
                source: "productionHandler",
                originalFilename: artifact.filename,
                downloadUrl,
            },
        });

        library = { fileUuid: saved.uuid, storageUrl: saved.storageUrl };
    } catch (e: any) {
        console.warn("[ProductionHandler] Failed to save artifact to Library:", e?.message || e);
    }

    return { downloadUrl, library };
}

// ============================================================================
// SSE Writer
// ============================================================================

function writeSse(res: Response, event: string, data: object): void {
    try {
        const streamMeta = (res as any)?.locals?.streamMeta;
        const payload: Record<string, unknown> = {
            ...(data as Record<string, unknown>),
        };

        if (!payload.conversationId && typeof streamMeta?.conversationId === 'string') {
            payload.conversationId = streamMeta.conversationId;
        }
        if (!payload.requestId && typeof streamMeta?.requestId === 'string') {
            payload.requestId = streamMeta.requestId;
        }

        if (!payload.assistantMessageId) {
            const assistantMessageId =
                streamMeta?.assistantMessageId ||
                (typeof streamMeta?.getAssistantMessageId === 'function'
                    ? streamMeta.getAssistantMessageId()
                    : undefined);
            if (assistantMessageId) {
                payload.assistantMessageId = assistantMessageId;
            }
        }

        const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
        res.write(chunk);

        if (typeof (res as any).flush === 'function') {
            (res as any).flush();
        } else if (res.socket && typeof res.socket.write === 'function') {
            res.socket.write('');
        }

        if (typeof streamMeta?.onWrite === 'function') {
            try {
                streamMeta.onWrite();
            } catch (observerError) {
                console.warn('[ProductionHandler] streamMeta.onWrite failed:', observerError);
            }
        }
    } catch (err) {
        console.error('[ProductionHandler] SSE write failed:', err);
    }
}

// ============================================================================
// Production Handler
// ============================================================================

export async function handleProductionRequest(
    req: ProductionRequest,
    res: Response
): Promise<ProductionHandlerResult> {
    const { message, userId, chatId, conversationId, requestId, assistantMessageId, intentResult, locale } = req;

    console.log(`[ProductionHandler] Starting production for intent: ${intentResult.intent}`);
    console.log(`[ProductionHandler] Topic: ${intentResult.slots.topic || message}`);

    const runId = uuidv4();
    const streamConversationId = conversationId || chatId;
    const streamRequestId = requestId || runId;
    const deliverables = getDeliverables(intentResult, message);
    const presentationHints = extractPresentationHints(message);
    const artifactSpec = resolveArtifactGenerationSpec(intentResult, deliverables, message);

    const emit = (event: string, data: Record<string, unknown>): void => {
        writeSse(res, event, {
            conversationId: streamConversationId,
            requestId: streamRequestId,
            ...(assistantMessageId ? { assistantMessageId } : {}),
            ...data,
        });
    };

    let persistedAssistantMessageId = assistantMessageId ?? null;

    const ensureAssistantMessageId = async (): Promise<string | null> => {
        if (persistedAssistantMessageId) {
            return persistedAssistantMessageId;
        }

        try {
            const assistantMessage = await storage.createChatMessage({
                chatId,
                role: "assistant",
                content: "",
                status: "pending",
                requestId: `${streamRequestId}:assistant`,
            });
            persistedAssistantMessageId = assistantMessage.id;
            return persistedAssistantMessageId;
        } catch (error) {
            console.warn("[ProductionHandler] Failed to create assistant placeholder:", error);
            return null;
        }
    };

    const persistAssistantResult = async (
        content: string,
        artifact?: ProductionHandlerResult["artifact"],
        failed = false,
    ): Promise<void> => {
        const normalizedContent = String(content || "").trim();
        if (!normalizedContent) {
            return;
        }

        const assistantPayload = buildAssistantMessage({
            content: normalizedContent,
            artifact,
        });
        const finalMetadata = buildAssistantMessageMetadata(assistantPayload);
        const resolvedAssistantMessageId = await ensureAssistantMessageId();

        if (resolvedAssistantMessageId) {
            await storage.updateChatMessageContent(
                resolvedAssistantMessageId,
                assistantPayload.content,
                failed ? "failed" : "done",
                finalMetadata,
            );
        }

        try {
            await conversationStateService.appendMessage(
                chatId,
                "assistant",
                assistantPayload.content,
                {
                    chatMessageId: resolvedAssistantMessageId || undefined,
                    requestId: `${streamRequestId}:state:assistant`,
                    metadata: finalMetadata || undefined,
                },
            );
        } catch (error) {
            console.warn("[ProductionHandler] Failed to persist assistant conversation state:", error);
        }
    };

    console.log(`[ProductionHandler] Deliverables: ${deliverables.join(', ')}`);

    // Set SSE headers (only if not already sent by chatAiRouter's early SSE setup)
    if (!res.headersSent) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Transfer-Encoding", "chunked");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("X-Production-Mode", "true");
        res.setHeader("X-Run-Id", runId);
        res.flushHeaders();
    }

    // Emit production start
    emit('production_start', {
        runId,
        intent: intentResult.intent,
        workflow: artifactSpec.workflow,
        engine: artifactSpec.engine,
        docKind: artifactSpec.requestedDocKind,
        classification: artifactSpec.workflow,
        topic: intentResult.slots.topic || message,
        deliverables,
        timestamp: Date.now(),
    });

    try {
        // ============================================================================
        // ACADEMIC ARTICLES EXPORT (fast path)
        // ============================================================================
        if (isAcademicArticlesExportRequest(message)) {
            emit('production_event', {
                type: 'stage_start',
                stage: 'research',
                progress: 0,
                message: 'Iniciando busqueda de articulos cientificos (Scopus/OpenAlex/SciELO/Redalyc)...',
                timestamp: Date.now(),
            });

            const exportResult = await exportAcademicArticlesFromPrompt(message);

            emit('production_event', {
                type: 'stage_complete',
                stage: 'research',
                progress: 100,
                message: `Busqueda completada: ${exportResult.stats.totalReturned}/${exportResult.stats.totalRequested} articulos`,
                timestamp: Date.now(),
            });

            const artifacts: Artifact[] = [];

            if (deliverables.includes('excel')) {
                artifacts.push({
                    type: 'excel',
                    filename: `articulos_cientificos_${Date.now()}.xlsx`,
                    buffer: exportResult.excelBuffer,
                    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    size: exportResult.excelBuffer.length,
                    metadata: { sheetCount: 1 },
                });
            }

            if (deliverables.includes('word')) {
                artifacts.push({
                    type: 'word',
                    filename: `referencias_apa7_${Date.now()}.docx`,
                    buffer: exportResult.wordBuffer,
                    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    size: exportResult.wordBuffer.length,
                    metadata: { pageCount: undefined, wordCount: undefined },
                });
            }

            // Save artifacts and generate download URLs
            const artifactsWithUrls: Array<{ type: string; filename: string; downloadUrl: string; size: number }> = [];

            for (const artifact of artifacts) {
                const stored = await saveArtifact(artifact, runId, userId, chatId);
                artifact.downloadUrl = stored.downloadUrl;

                artifactsWithUrls.push({
                    type: artifact.type,
                    filename: artifact.filename,
                    downloadUrl: stored.downloadUrl,
                    size: artifact.size,
                });

                emit('artifact', {
                    type: artifact.type,
                    filename: artifact.filename,
                    downloadUrl: stored.downloadUrl,
                    size: artifact.size,
                    library: stored.library,
                    metadata: {
                        workflow: artifactSpec.workflow,
                        classification: artifactSpec.workflow,
                        engine: artifactSpec.engine,
                        docKind: artifact.type === "excel" ? "xlsx" : "docx",
                    },
                });
            }

            const sourcesLine = Object.entries(exportResult.stats.bySource)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => `${k} (${v})`)
                .join(', ') || 'n/a';

            const yearsLine = exportResult.plan.yearFrom && exportResult.plan.yearTo
                ? `${exportResult.plan.yearFrom}-${exportResult.plan.yearTo}`
                : 'n/a';

            const regionLine = [
                exportResult.plan.region.latam ? 'Latinoamerica' : null,
                exportResult.plan.region.spain ? 'Espana' : null,
            ].filter(Boolean).join(' + ') || 'n/a';

            const coverage = exportResult.stats.coverage;
            const fmtCoverage = (label: string, c: { present: number; missing: number }) => {
                const total = c.present + c.missing;
                const pct = total ? Math.round((c.present / total) * 100) : 0;
                return `${label} ${c.present}/${total} (${pct}%)`;
            };

            const coverageLine = [
                fmtCoverage('DOI', coverage.doi),
                fmtCoverage('Abstract', coverage.abstract),
                fmtCoverage('Keywords', coverage.keywords),
                fmtCoverage('Journal', coverage.journal),
                fmtCoverage('Language', coverage.language),
                fmtCoverage('Document Type', coverage.documentType),
                fmtCoverage('City', coverage.city),
                fmtCoverage('Country', coverage.country),
            ].join(' | ');

            const notesBlock = exportResult.stats.notes?.length
                ? ['', '**Notas:**', ...exportResult.stats.notes.map(n => `- ${n}`)].join('\n')
                : '';

            const artifactLinks = artifactsWithUrls.map(a => {
                const icon = getArtifactIcon(a.type);
                return `- ${icon} [${a.filename}](${a.downloadUrl}) (${formatSize(a.size)})`;
            }).join('\n');
            const primaryArtifact = artifactsWithUrls[0];
            const doneArtifact = primaryArtifact
                ? {
                    artifactId: `${runId}_${primaryArtifact.type}`,
                    type: primaryArtifact.type,
                    mimeType: artifacts[0]?.mimeType || "application/octet-stream",
                    sizeBytes: primaryArtifact.size,
                    downloadUrl: primaryArtifact.downloadUrl,
                    name: primaryArtifact.filename,
                    filename: primaryArtifact.filename,
                    metadata: {
                        workflow: artifactSpec.workflow,
                        classification: artifactSpec.workflow,
                        engine: artifactSpec.engine,
                        docKind: primaryArtifact.type === "word" ? "docx" : "pdf",
                    },
                }
                : undefined;

            const summary = [
                '## 📚 Exportacion Academica Completada',
                '',
                artifactLinks,
                '',
                `**Tema:** ${exportResult.plan.topicQuery || message}`,
                `**Rango de anos:** ${yearsLine}`,
                `**Region:** ${regionLine}`,
                `**Articulos:** ${exportResult.stats.totalReturned}/${exportResult.stats.totalRequested}`,
                `**Fuentes:** ${sourcesLine}`,
                `**Cobertura:** ${coverageLine}`,
                notesBlock,
            ].join('\n');

            emit('production_complete', {
                runId,
                success: true,
                workflow: artifactSpec.workflow,
                engine: artifactSpec.engine,
                artifactsCount: artifacts.length,
                summary,
                timestamp: Date.now(),
            });

            // Send summary as regular chat content for display
            emit('chunk', {
                content: summary,
                sequenceId: 1,
                runId,
            });

            emit('done', {
                sequenceId: 2,
                runId,
                timestamp: Date.now(),
                artifact: doneArtifact,
            });

            res.end();

            const finalResult = {
                handled: true,
                assistantContent: summary,
                artifact: primaryArtifact
                    ? {
                        type: primaryArtifact.type,
                        filename: primaryArtifact.filename,
                        downloadUrl: primaryArtifact.downloadUrl,
                        size: primaryArtifact.size,
                        mimeType: artifacts[0]?.mimeType,
                        metadata: {
                            workflow: artifactSpec.workflow,
                            classification: artifactSpec.workflow,
                            engine: artifactSpec.engine,
                            docKind: primaryArtifact.type === "word" ? "docx" : "pdf",
                        },
                    }
                    : undefined,
            };
            await persistAssistantResult(finalResult.assistantContent || summary, finalResult.artifact);
            return finalResult;
        }

        if (shouldUseOfficeEngine(artifactSpec)) {
            const officeStreamer = new StepStreamer();
            const officeController = new AbortController();
            const pendingEvents: OfficeRunSession["pendingEvents"] = [];

            const session: OfficeRunSession = {
                runId: "",
                userId,
                streamer: officeStreamer,
                controller: officeController,
                result: undefined as unknown as Promise<any>,
                finished: false,
                pendingEvents,
            };

            officeStreamer.on("step", (step: any) => {
                pendingEvents.push({ event: "step", data: step });
                const stage = inferOfficeStageFromStep(step);
                emit("production_event", {
                    workflow: artifactSpec.workflow,
                    engine: "office-engine",
                    runId: session.runId || runId,
                    stage,
                    progress: OFFICE_STAGE_PROGRESS[stage] ?? 0,
                    status: step.status,
                    stepId: step.id,
                    stepType: step.type,
                    title: step.title,
                    output: step.output,
                    diff: step.diff,
                    artifact: step.artifact,
                    message: step.output || step.description || step.title,
                    timestamp: Date.now(),
                });
            });

            const officeRunIdPromise = new Promise<string>((resolve) => {
                session.runId = "";
                session.pendingEvents = pendingEvents;
                session.finished = false;
                const onStart = (officeRunId: string) => {
                    registerOfficeRunSession(officeRunId, session);
                    resolve(officeRunId);
                };
                session.result = officeEngine.run(
                    {
                        userId,
                        conversationId: streamConversationId,
                        objective: message,
                        docKind: "docx",
                        onStart,
                    },
                    officeStreamer,
                    officeController.signal,
                );
            });

            session.result
                .then((result) => {
                    markOfficeRunSessionFinished(result.runId, result.status, result.error?.message);
                })
                .catch((err) => {
                    if (session.runId) {
                        markOfficeRunSessionFinished(
                            session.runId,
                            "failed",
                            err instanceof Error ? err.message : String(err),
                        );
                    }
                });

            const officeRunRequestId = await Promise.race([
                officeRunIdPromise,
                session.result.then((result) => result.runId),
            ]);

            emit("production_event", {
                workflow: artifactSpec.workflow,
                engine: "office-engine",
                runId: officeRunRequestId,
                stage: "handoff",
                progress: 4,
                status: "completed",
                message: "Solicitud derivada al Office Engine.",
                timestamp: Date.now(),
            });

            const officeResult = await session.result;

            if (officeResult.status !== "succeeded" || officeResult.artifacts.length === 0) {
                const officeFailure = officeResult.error?.message || "No se pudo completar el run documental.";

                emit("production_complete", {
                    runId: officeResult.runId,
                    success: false,
                    workflow: artifactSpec.workflow,
                    engine: "office-engine",
                    docKind: "docx",
                    artifactsCount: officeResult.artifacts.length,
                    summary: officeFailure,
                    error: officeFailure,
                    timestamp: Date.now(),
                });

                emit("production_error", {
                    runId: officeResult.runId,
                    workflow: artifactSpec.workflow,
                    engine: "office-engine",
                    error: officeFailure,
                    timestamp: Date.now(),
                });

                emit("chunk", {
                    content: `❌ **Error en la producción documental**\n\n${officeFailure}`,
                    sequenceId: 1,
                    runId: officeResult.runId,
                });

                emit("done", {
                    sequenceId: 2,
                    runId: officeResult.runId,
                    timestamp: Date.now(),
                });

                res.end();

                const finalResult = {
                    handled: true,
                    error: officeFailure,
                    assistantContent: `❌ **Error en la producción documental**\n\n${officeFailure}`,
                };
                await persistAssistantResult(finalResult.assistantContent || officeFailure, undefined, true);
                return finalResult;
            }

            const exportedArtifact = officeResult.artifacts[0];
            const summary = "Documento listo para descargar. Vista previa y pipeline estructural disponibles.";
            const exportedName = `${intentResult.slots.title || intentResult.slots.topic || "documento"}.docx`;
            const officeDoneArtifact = {
                artifactId: `${officeResult.runId}_docx`,
                type: "document",
                mimeType: exportedArtifact.mimeType,
                sizeBytes: exportedArtifact.sizeBytes,
                downloadUrl: exportedArtifact.downloadUrl || `/api/office-engine/runs/${officeResult.runId}/artifacts/exported`,
                previewUrl: exportedArtifact.previewUrl || `/api/office-engine/runs/${officeResult.runId}/artifacts/preview`,
                name: exportedName,
                filename: exportedName,
                metadata: {
                    workflow: artifactSpec.workflow,
                    classification: artifactSpec.workflow,
                    engine: "office-engine",
                    docKind: "docx",
                    officeRunId: officeResult.runId,
                    officeStatus: officeResult.status,
                    fallbackLevel: officeResult.fallbackLevel,
                    durationMs: officeResult.durationMs,
                },
            };

            emit("artifact", {
                type: "docx",
                filename: exportedName,
                downloadUrl: officeDoneArtifact.downloadUrl,
                previewUrl: officeDoneArtifact.previewUrl,
                size: exportedArtifact.sizeBytes,
                mimeType: exportedArtifact.mimeType,
                metadata: officeDoneArtifact.metadata,
            });

            emit("production_complete", {
                runId: officeResult.runId,
                success: true,
                workflow: artifactSpec.workflow,
                engine: "office-engine",
                docKind: "docx",
                artifactsCount: officeResult.artifacts.length,
                summary,
                timestamp: Date.now(),
            });

            emit("chunk", {
                content: summary,
                sequenceId: 1,
                runId: officeResult.runId,
            });

            emit("done", {
                sequenceId: 2,
                runId: officeResult.runId,
                timestamp: Date.now(),
                artifact: officeDoneArtifact,
            });

            res.end();

            const finalResult = {
                handled: true,
                assistantContent: summary,
                artifact: {
                    type: "docx",
                    filename: exportedName,
                    downloadUrl: exportedArtifact.downloadUrl || `/api/office-engine/runs/${officeResult.runId}/artifacts/exported`,
                    previewUrl: exportedArtifact.previewUrl || `/api/office-engine/runs/${officeResult.runId}/artifacts/preview`,
                    size: exportedArtifact.sizeBytes,
                    mimeType: exportedArtifact.mimeType,
                    metadata: {
                        workflow: artifactSpec.workflow,
                        classification: artifactSpec.workflow,
                        engine: "office-engine",
                        docKind: "docx",
                        officeRunId: officeResult.runId,
                        officeStatus: officeResult.status,
                        fallbackLevel: officeResult.fallbackLevel,
                        durationMs: officeResult.durationMs,
                    },
                },
            };
            await persistAssistantResult(finalResult.assistantContent || summary, finalResult.artifact);
            return finalResult;
        }

        if (shouldUseProfessionalPptxEngine(artifactSpec, deliverables)) {
            emit("production_event", {
                type: "stage_start",
                stage: "intake",
                progress: 8,
                workflow: artifactSpec.workflow,
                engine: artifactSpec.engine,
                docKind: "pptx",
                message: "Analizando requerimientos de la presentación.",
                timestamp: Date.now(),
            });

            const pptRequest = buildProfessionalPptxRequest(intentResult, message, presentationHints);

            emit("production_event", {
                type: "stage_complete",
                stage: "blueprint",
                progress: 32,
                workflow: artifactSpec.workflow,
                engine: artifactSpec.engine,
                docKind: "pptx",
                message: `Estructura lista: ${pptRequest.slides.length} diapositivas profesionales.`,
                timestamp: Date.now(),
            });

            emit("production_event", {
                type: "stage_start",
                stage: "slides",
                progress: 58,
                workflow: artifactSpec.workflow,
                engine: artifactSpec.engine,
                docKind: "pptx",
                message: "Generando presentación profesional con PptxGenJS.",
                timestamp: Date.now(),
            });

            const pptResult = await generateProfessionalPptx(pptRequest);

            emit("production_event", {
                type: "stage_complete",
                stage: "render",
                progress: 84,
                workflow: artifactSpec.workflow,
                engine: artifactSpec.engine,
                docKind: "pptx",
                message: "Vista previa estructural generada.",
                timestamp: Date.now(),
            });

            const pptArtifact: Artifact = {
                type: "ppt",
                filename: pptResult.filename,
                buffer: pptResult.buffer,
                mimeType: pptResult.mimeType,
                size: pptResult.buffer.length,
                metadata: {
                    slideCount: pptResult.slideCount,
                    theme: pptRequest.theme,
                    brandName: presentationHints.brand,
                },
            };

            const stored = await saveArtifact(pptArtifact, runId, userId, chatId);
            const summary = "Presentación lista para descargar. Haz clic en descargar para obtenerla.";
            const artifactMetadata = {
                workflow: artifactSpec.workflow,
                classification: artifactSpec.workflow,
                engine: artifactSpec.engine,
                docKind: "pptx",
                slideCount: pptResult.slideCount,
                theme: pptRequest.theme,
                ...(presentationHints.brand ? { brandName: presentationHints.brand } : {}),
            };

            emit("production_event", {
                type: "stage_complete",
                stage: "export",
                progress: 100,
                workflow: artifactSpec.workflow,
                engine: artifactSpec.engine,
                docKind: "pptx",
                message: "Presentación exportada y lista para descarga.",
                timestamp: Date.now(),
            });

            emit("artifact", {
                type: "ppt",
                filename: pptResult.filename,
                downloadUrl: stored.downloadUrl,
                previewHtml: pptResult.previewHtml,
                size: pptResult.buffer.length,
                mimeType: pptResult.mimeType,
                library: stored.library,
                metadata: artifactMetadata,
            });

            emit("production_complete", {
                runId,
                success: true,
                workflow: artifactSpec.workflow,
                engine: artifactSpec.engine,
                docKind: "pptx",
                artifactsCount: 1,
                summary,
                timestamp: Date.now(),
            });

            emit("chunk", {
                content: summary,
                sequenceId: 1,
                runId,
            });

            emit("done", {
                sequenceId: 2,
                runId,
                timestamp: Date.now(),
                artifact: {
                    artifactId: `${runId}_pptx`,
                    type: "presentation",
                    mimeType: pptResult.mimeType,
                    sizeBytes: pptResult.buffer.length,
                    downloadUrl: stored.downloadUrl,
                    name: pptResult.filename,
                    filename: pptResult.filename,
                    previewHtml: pptResult.previewHtml,
                    metadata: artifactMetadata,
                },
            });

            res.end();

            const finalResult = {
                handled: true,
                assistantContent: summary,
                artifact: {
                    type: "ppt",
                    filename: pptResult.filename,
                    downloadUrl: stored.downloadUrl,
                    previewHtml: pptResult.previewHtml,
                    size: pptResult.buffer.length,
                    mimeType: pptResult.mimeType,
                    metadata: artifactMetadata,
                },
            };
            await persistAssistantResult(finalResult.assistantContent || summary, finalResult.artifact);
            return finalResult;
        }

        const pipelineIntent: DocumentIntent =
            intentResult.intent === 'CREATE_PRESENTATION'
                ? 'presentation'
                : intentResult.intent === 'CREATE_SPREADSHEET'
                    ? 'analysis'
                    : 'report';

        // Execute production pipeline
        const result = await startProductionPipeline(
            message,
            userId,
            chatId,
            (event: ProductionEvent) => {
                // Emit pipeline events as SSE
                emit('production_event', {
                    type: event.type,
                    stage: event.stage,
                    progress: event.progress,
                    message: event.message,
                    timestamp: event.timestamp,
                });
            },
            {
                // If the user explicitly selected a doc tool or intent router classified this as CREATE_*,
                // do not allow the production router to downgrade to CHAT.
                forceProduction: true,
                deliverables,
                intent: pipelineIntent,
                topic: intentResult.slots.topic || message,
                template: presentationHints.template,
                theme: presentationHints.theme,
                brand: presentationHints.brand,
            }
        );

        // Save artifacts and generate download URLs
        const artifactsWithUrls: Array<{ type: string; filename: string; downloadUrl: string; size: number }> = [];

        for (const artifact of result.artifacts) {
            const stored = await saveArtifact(artifact, runId, userId, chatId);
            artifact.downloadUrl = stored.downloadUrl;

            artifactsWithUrls.push({
                type: artifact.type,
                filename: artifact.filename,
                downloadUrl: stored.downloadUrl,
                size: artifact.size,
            });

            // Emit artifact event
            const preview = await buildArtifactPreview(artifact);

            emit('artifact', {
                type: artifact.type,
                filename: artifact.filename,
                downloadUrl: stored.downloadUrl,
                size: artifact.size,
                library: stored.library,
                previewUrl: preview?.previewUrl,
                previewHtml: preview?.previewHtml,
                mimeType: artifact.mimeType,
                metadata: {
                    workflow: artifactSpec.workflow,
                    classification: artifactSpec.workflow,
                    engine: artifactSpec.engine,
                    docKind: artifactSpec.requestedDocKind,
                    ...(artifact.metadata || {}),
                },
            });
        }

        const hasArtifacts = artifactsWithUrls.length > 0;
        const isFailure = result.status === 'failed' || !hasArtifacts;
        const primaryArtifact = artifactsWithUrls[0];
        const primarySourceArtifact = result.artifacts[0];
        const doneArtifact = primaryArtifact
            ? {
                artifactId: `${runId}_${primaryArtifact.type}`,
                type: primaryArtifact.type === "word"
                    ? "document"
                    : primaryArtifact.type === "excel"
                        ? "spreadsheet"
                        : primaryArtifact.type === "ppt"
                            ? "presentation"
                            : primaryArtifact.type,
                mimeType: primarySourceArtifact?.mimeType || "application/octet-stream",
                sizeBytes: primaryArtifact.size,
                downloadUrl: primaryArtifact.downloadUrl,
                name: primaryArtifact.filename,
                filename: primaryArtifact.filename,
                previewUrl: undefined,
                previewHtml: undefined,
                metadata: {
                    workflow: artifactSpec.workflow,
                    classification: artifactSpec.workflow,
                    engine: artifactSpec.engine,
                    docKind: artifactSpec.requestedDocKind,
                    ...(primarySourceArtifact?.metadata || {}),
                },
            }
            : undefined;

        if (isFailure) {
            const failureMessage = getProductionFailureMessage(result, deliverables);

            emit('production_complete', {
                runId,
                success: false,
                workflow: artifactSpec.workflow,
                engine: artifactSpec.engine,
                docKind: artifactSpec.requestedDocKind,
                artifactsCount: result.artifacts.length,
                qaScore: result.qaReport?.overallScore,
                summary: result.summary,
                error: failureMessage,
                timestamp: Date.now(),
            });

            emit('production_error', {
                runId,
                workflow: artifactSpec.workflow,
                engine: artifactSpec.engine,
                docKind: artifactSpec.requestedDocKind,
                error: failureMessage,
                status: result.status,
                artifactsCount: result.artifacts.length,
                timestamp: Date.now(),
            });

            emit('chunk', {
                content: `❌ **Error en la producción documental**\n\n${failureMessage}\n\n${result.summary || 'No se pudo completar la solicitud.'}`,
                sequenceId: 1,
                runId,
            });

            emit('done', {
                sequenceId: 2,
                runId,
                timestamp: Date.now(),
            });

            res.end();

            const finalResult = {
                handled: true,
                result,
                error: failureMessage,
                assistantContent: `❌ **Error en la producción documental**\n\n${failureMessage}\n\n${result.summary || 'No se pudo completar la solicitud.'}`,
            };
            await persistAssistantResult(finalResult.assistantContent || failureMessage, undefined, true);
            return finalResult;
        }

        // Emit completion
        const deliverySummary = formatProductionSummary(result, intentResult, artifactsWithUrls);

        emit('production_complete', {
            runId,
            success: result.status === 'success',
            workflow: artifactSpec.workflow,
            engine: artifactSpec.engine,
            docKind: artifactSpec.requestedDocKind,
            artifactsCount: result.artifacts.length,
            qaScore: result.qaReport?.overallScore,
            summary: deliverySummary,
            timestamp: Date.now(),
        });

        // Keep the streamed content concise; the downloadable artifact is rendered separately in the client.
        emit('chunk', {
            content: deliverySummary,
            sequenceId: 1,
            runId,
        });

        emit('done', {
            sequenceId: 2,
            runId,
            timestamp: Date.now(),
            artifact: doneArtifact,
        });

        res.end();

        const finalResult = {
            handled: true,
            result,
            assistantContent: deliverySummary,
            artifact: (() => {
                const primaryArtifact = artifactsWithUrls[0];
                const sourceArtifact = result.artifacts[0];
                if (!primaryArtifact) return undefined;
                return {
                    type: primaryArtifact.type,
                    filename: primaryArtifact.filename,
                    downloadUrl: primaryArtifact.downloadUrl,
                    size: primaryArtifact.size,
                    mimeType: sourceArtifact?.mimeType,
                    metadata: {
                        workflow: artifactSpec.workflow,
                        classification: artifactSpec.workflow,
                        engine: artifactSpec.engine,
                        docKind: artifactSpec.requestedDocKind,
                        ...(sourceArtifact?.metadata || {}),
                    },
                };
            })(),
        };
        await persistAssistantResult(finalResult.assistantContent || deliverySummary, finalResult.artifact);
        return finalResult;

    } catch (error: any) {
        console.error('[ProductionHandler] Pipeline error:', error);

        const rawMessage = error?.message || 'Unknown error';
        const userMessage =
            rawMessage === 'Message does not require production mode'
                ? 'Tu solicitud no requiere producción documental. Si necesitas un archivo, especifica el formato (Word/PDF/Excel/PPT) o selecciona la herramienta correspondiente.'
                : rawMessage;

        emit('production_error', {
            runId,
            workflow: artifactSpec.workflow,
            engine: artifactSpec.engine,
            docKind: artifactSpec.requestedDocKind,
            error: userMessage,
            timestamp: Date.now(),
        });

        // Send error as chat content
        emit('chunk', {
            content: `❌ **Error en la producción documental**\n\n${userMessage}\n\nPor favor, intenta de nuevo o reformula tu solicitud.`,
            sequenceId: 1,
            runId,
        });

        emit('done', {
            sequenceId: 2,
            runId,
            timestamp: Date.now(),
        });

        res.end();

        const finalResult = {
            handled: true,
            error: error.message,
            assistantContent: `❌ **Error en la producción documental**\n\n${userMessage}\n\nPor favor, intenta de nuevo o reformula tu solicitud.`,
        };
        await persistAssistantResult(finalResult.assistantContent || userMessage, undefined, true);
        return finalResult;
    }
}

// ============================================================================
// Format Summary
// ============================================================================

function formatProductionSummary(
    result: ProductionResult,
    intentResult: IntentResult,
    artifacts: Array<{ type: string; filename: string; downloadUrl: string; size: number }>
): string {
    const generatedCount = artifacts.length;
    if (generatedCount === 0) {
        return result.status === 'partial'
            ? 'Se generó una salida parcial. Revisa el resultado y vuelve a intentar si necesitas completar los archivos faltantes.'
            : 'La producción documental terminó sin archivos descargables.';
    }

    const primaryArtifact = artifacts[0];
    const primaryType = primaryArtifact?.type || intentResult.output_format || 'documento';
    const singleArtifactLabel = getArtifactReadyLabel(primaryType);

    if (generatedCount === 1) {
        return result.status === 'partial'
            ? `${singleArtifactLabel} Se generó una versión parcial; revisa el archivo y vuelve a intentar si necesitas completar el resto.`
            : `${singleArtifactLabel} Haz clic en descargar para obtenerlo.`;
    }

    return result.status === 'partial'
        ? `Se generaron ${generatedCount} archivos, pero la entrega quedó parcial. Revisa los descargables disponibles y vuelve a intentar si necesitas completar el resto.`
        : `Se generaron ${generatedCount} archivos listos para descargar.`;
}

function getProductionFailureMessage(
    result: ProductionResult,
    requestedDeliverables: Array<'word' | 'excel' | 'ppt' | 'pdf'>
): string {
    const summaryErrorMatch = result.summary.match(/\*\*Error:\*\*\s*(.+)/i);
    if (summaryErrorMatch?.[1]) {
        return summaryErrorMatch[1].trim();
    }

    const blockers = result.qaReport?.blockers?.filter(Boolean) || [];
    if (blockers.length > 0) {
        return blockers[0];
    }

    const limitations = result.evidencePack?.limitations?.filter(Boolean) || [];
    if (limitations.length > 0) {
        return limitations[0];
    }

    const requested = requestedDeliverables.join(', ') || 'archivo solicitado';
    if (!result.artifacts.length) {
        return `No se pudo generar ninguno de los entregables solicitados (${requested}).`;
    }

    return `La producción documental finalizó con estado "${result.status}".`;
}

function getArtifactIcon(type: string): string {
    switch (type) {
        case 'word': return '📝';
        case 'excel': return '📊';
        case 'ppt': return '📽️';
        case 'pdf': return '📕';
        default: return '📄';
    }
}

function getArtifactReadyLabel(type: string): string {
    switch (type) {
        case 'word':
        case 'docx':
            return 'Documento listo para descargar.';
        case 'excel':
        case 'xlsx':
            return 'Hoja de cálculo lista para descargar.';
        case 'ppt':
        case 'pptx':
            return 'Presentación lista para descargar.';
        case 'pdf':
            return 'PDF listo para descargar.';
        default:
            return 'Archivo listo para descargar.';
    }
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// Exports
// ============================================================================

export { PRODUCTION_INTENTS };
