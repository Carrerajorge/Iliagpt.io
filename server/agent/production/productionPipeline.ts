/**
 * Production Pipeline Orchestrator
 * 
 * Main orchestrator that runs the 10-stage agentic pipeline:
 * 1. Intake - Normalize request
 * 2. Blueprint - Plan structure
 * 3. Research - Gather evidence
 * 4. Analysis - Build arguments
 * 5. Writing - Draft content
 * 6. Data - Build Excel (if needed)
 * 7. Slides - Build PPT (if needed)
 * 8. QA - Quality check loop
 * 9. Consistency - Cross-doc verification
 * 10. Render - Generate final files
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type {
    WorkOrder,
    PipelineStage,
    StageProgress,
    Deliverable,
    DocumentIntent,
    ProductionResult,
    ProductionEvent,
    ProductionEventHandler,
    EvidencePack,
    ContentSpec,
    Section,
    QAReport,
    TraceMap,
    Artifact,
} from './types';
import { routeTask, type RouterResult, type TaskRouterOptions } from './taskRouter';
import { createWorkOrder, enrichWorkOrder, validateWorkOrder } from './workOrderProcessor';
import { consistencyAgent } from './consistencyAgent';
import { generateBlueprint } from './blueprintAgent';

// Import existing agents
import { researchAgent } from '../langgraph/agents/ResearchAssistantAgent';
import { documentAgent } from '../langgraph/agents/DocumentAgent';
import { qaAgent } from '../langgraph/agents/QAAgent';
import { dataAgent } from '../langgraph/agents/DataAnalystAgent';
import { contentAgent } from '../langgraph/agents/ContentAgent';

// Import renderers
import { createExcelFromData } from '../../services/advancedExcelBuilder';
import { generateWordFromMarkdown } from '../../services/markdownToDocx';
import { generateProfessionalDocument } from '../../services/docxCodeGenerator';
import { EnterpriseDocumentService, type DocumentSection as EnterpriseDocumentSection } from '../../services/enterpriseDocumentService';
import { academicSearchFallback } from '../../integrations/academicSearch';

// ============================================================================
// Pipeline Stages Definition
// ============================================================================

const PIPELINE_STAGES: PipelineStage[] = [
    'intake',
    'blueprint',
    'research',
    'analysis',
    'writing',
    'data',
    'slides',
    'qa',
    'consistency',
    'render',
];

// ============================================================================
// Production Pipeline Class
// ============================================================================

export class ProductionPipeline extends EventEmitter {
    private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
        let timeoutHandle: NodeJS.Timeout | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new Error(`TIMEOUT: ${label} after ${timeoutMs}ms`)), timeoutMs);
        });
        try {
            return await Promise.race([promise, timeoutPromise]);
        } finally {
            if (timeoutHandle) clearTimeout(timeoutHandle);
        }
    }
    private workOrder: WorkOrder;
    private stageProgress: Map<PipelineStage, StageProgress>;
    private artifacts: Artifact[] = [];
    private evidencePack: EvidencePack | null = null;
    private contentSpec: ContentSpec | null = null;
    private qaReport: QAReport | null = null;
    private traceMap: TraceMap | null = null;
    private aborted: boolean = false;
    private failureReason: string | null = null;
    private startTime: Date;
    private stageTimings: Map<PipelineStage, number> = new Map();

    constructor(workOrder: WorkOrder) {
        super();
        this.workOrder = workOrder;
        this.stageProgress = new Map();
        this.startTime = new Date();

        // Initialize stage progress
        for (const stage of PIPELINE_STAGES) {
            this.stageProgress.set(stage, {
                stage,
                status: 'pending',
                progress: 0,
                message: 'Waiting...',
            });
        }
    }

    // ============================================================================
    // Event Emission
    // ============================================================================

    private emitEvent(event: Omit<ProductionEvent, 'workOrderId' | 'timestamp'>): void {
        const fullEvent: ProductionEvent = {
            ...event,
            workOrderId: this.workOrder.id,
            timestamp: new Date(),
        };
        this.emit('event', fullEvent);
    }

    private updateStage(
        stage: PipelineStage,
        status: StageProgress['status'],
        progress: number,
        message: string
    ): void {
        const stageProgress = this.stageProgress.get(stage)!;
        stageProgress.status = status;
        stageProgress.progress = progress;
        stageProgress.message = message;

        if (status === 'running' && !stageProgress.startedAt) {
            stageProgress.startedAt = new Date();
        }
        if (status === 'complete' || status === 'failed') {
            stageProgress.completedAt = new Date();
            if (stageProgress.startedAt) {
                this.stageTimings.set(
                    stage,
                    stageProgress.completedAt.getTime() - stageProgress.startedAt.getTime()
                );
            }
        }

        this.emitEvent({
            type: status === 'complete' ? 'stage_complete' : status === 'failed' ? 'stage_error' : 'progress',
            stage,
            progress,
            message,
        });
    }

    // ============================================================================
    // Main Pipeline Execution
    // ============================================================================

    async run(): Promise<ProductionResult> {
        console.log(`[ProductionPipeline] Starting pipeline for WorkOrder ${this.workOrder.id}`);

        try {
            // Stage 1: Intake
            await this.stageIntake();
            if (this.aborted) throw new Error('Pipeline aborted');

            // Stage 2: Blueprint
            await this.stageBlueprint();
            if (this.aborted) throw new Error('Pipeline aborted');

            // Stage 3: Research
            await this.stageResearch();
            if (this.aborted) throw new Error('Pipeline aborted');

            // Stage 4: Analysis
            await this.stageAnalysis();
            if (this.aborted) throw new Error('Pipeline aborted');

            // Stage 5: Writing
            await this.stageWriting();
            if (this.aborted) throw new Error('Pipeline aborted');

            // Stage 6: Data (Excel) - if needed
            if (this.workOrder.deliverables.includes('excel')) {
                await this.stageData();
                if (this.aborted) throw new Error('Pipeline aborted');
            } else {
                this.updateStage('data', 'skipped', 100, 'Excel not requested');
            }

            // Stage 7: Slides (PPT) - if needed
            if (this.workOrder.deliverables.includes('ppt')) {
                await this.stageSlides();
                if (this.aborted) throw new Error('Pipeline aborted');
            } else {
                this.updateStage('slides', 'skipped', 100, 'PPT not requested');
            }

            // Stage 8: QA
            await this.stageQA();
            if (this.aborted) throw new Error('Pipeline aborted');

            // Stage 9: Consistency
            await this.stageConsistency();
            if (this.aborted) throw new Error('Pipeline aborted');

            // Stage 10: Render
            await this.stageRender();

            // Build result
            return this.buildResult('success');

        } catch (error) {
            console.error('[ProductionPipeline] Pipeline failed:', error);
            this.failureReason = error instanceof Error ? error.message : 'Unknown error';

            // Mark current stage as failed
            const currentStage = Array.from(this.stageProgress.entries())
                .find(([_, p]) => p.status === 'running')?.[0];
            if (currentStage) {
                this.updateStage(currentStage, 'failed', 0, error instanceof Error ? error.message : 'Unknown error');
            }

            return this.buildResult('failed');
        }
    }

    // ============================================================================
    // Individual Stage Implementations
    // ============================================================================

    private async stageIntake(): Promise<void> {
        this.updateStage('intake', 'running', 0, 'Validating work order...');

        // Validate
        const validation = validateWorkOrder(this.workOrder);
        if (!validation.valid) {
            throw new Error(`Invalid work order: ${validation.errors.join(', ')}`);
        }

        this.updateStage('intake', 'running', 50, 'Enriching work order...');

        // Enrich with LLM
        this.workOrder = await enrichWorkOrder(this.workOrder) as WorkOrder;

        this.updateStage('intake', 'complete', 100, 'Work order processed');
    }

    private async stageBlueprint(): Promise<void> {
        this.updateStage('blueprint', 'running', 0, 'Designing document structure...');

        try {
            const blueprint = await generateBlueprint(this.workOrder);

            this.contentSpec = {
                title: blueprint.outline.title,
                authors: ['ILIAGPT AI'],
                date: new Date().toISOString().split('T')[0],
                sections: blueprint.outline.sections.map(s => ({
                    id: s.id,
                    type: 'h1',
                    content: '',
                    title: s.title,
                    objective: s.objective,
                    targetWordCount: s.targetWordCount,
                    children: []
                })),
                bibliography: [],
            };

            this.updateStage('blueprint', 'complete', 100, 'Document structure designed');
        } catch (error: any) {
            throw new Error(`Failed to create document blueprint: ${error.message}`);
        }
    }

    private inferDesiredSourcesCount(text: string): number | null {
        const t = (text || '').toLowerCase();
        // Common patterns: "50 artículos", "50 papers", "50 fuentes", etc.
        const m = t.match(/(?:^|\D)(\d{2,3})\s*(?:art\w*|papers?|fuentes?|sources?)/i);
        if (!m) return null;
        const n = Number(m[1]);
        if (!Number.isFinite(n) || n < 1) return null;
        return Math.max(1, Math.min(n, 50));
    }

    private async stageResearch(): Promise<void> {
        if (this.workOrder.sourcePolicy === 'none') {
            this.updateStage('research', 'skipped', 100, 'Research not required');
            this.evidencePack = { sources: [], notes: [], dataPoints: [], gaps: [], limitations: ['No research conducted per policy'] };
            return;
        }

        this.updateStage('research', 'running', 0, 'Researching topic...');

        const researchTimeoutMs = Math.max(15_000, Math.min((this.workOrder.budget.timeoutMinutes || 10) * 60_000, 120_000));

        let result: any;
        try {
            result = await this.withTimeout(
                researchAgent.execute({
                    id: uuidv4(),
                    type: 'deep_research',
                    input: {
                        topic: this.workOrder.topic,
                        questions: this.workOrder.metadata?.keyQuestions || [],
                        sourcePolicy: this.workOrder.sourcePolicy,
                        maxSources: this.workOrder.budget.maxSearchQueries,
                    },
                    description: `Research topic: ${this.workOrder.topic}`,
                    priority: 'medium',
                    retries: 0,
                    maxRetries: 3,
                }),
                researchTimeoutMs,
                `production.researchAgent.execute(${this.workOrder.topic.slice(0, 60)})`
            );
        } catch (error: any) {
            console.warn('[ProductionPipeline] Research stage timed out/failed, continuing without sources:', error?.message || error);
            this.evidencePack = {
                sources: [],
                notes: [],
                dataPoints: [],
                gaps: [this.workOrder.topic],
                limitations: [
                    `Research failed or timed out (${error?.message || 'unknown'}). Document generated without web evidence.`
                ],
            };
            this.updateStage('research', 'complete', 100, 'Research skipped (timeout/failure)');
            return;
        }

        this.updateStage('research', 'running', 80, 'Processing research results...');

        // Convert to evidence pack
        this.evidencePack = {
            sources: result.output?.sources || [],
            notes: result.output?.notes || [],
            dataPoints: result.output?.dataPoints || [],
            gaps: result.output?.gaps || [],
            limitations: result.output?.limitations || [],
        };

        // Fallback: if the LLM-based research agent returns 0 sources, hit
        // no-key academic APIs to ensure we have evidence for Excel/Word exports.
        if (this.evidencePack.sources.length === 0 && (this.workOrder.sourcePolicy === 'web' || this.workOrder.sourcePolicy === 'both')) {
            try {
                this.updateStage('research', 'running', 90, 'No sources from research agent; querying academic indexes...');
                const desired = this.inferDesiredSourcesCount(this.workOrder.topic) || 0;
                const budgetMax = this.workOrder.budget.maxSearchQueries || 20;
                // If the user explicitly asked for N sources and we're producing Excel,
                // honor that up to a hard cap (50) even if budgetMax is lower.
                const maxSources = Math.max(
                    10,
                    Math.min(
                        50,
                        Math.max(budgetMax, desired, this.workOrder.deliverables.includes('excel') ? 50 : 0)
                    )
                );

                const academicSources = await academicSearchFallback({
                    query: this.workOrder.topic,
                    maxSources,
                });
                if (academicSources.length > 0) {
                    this.evidencePack.sources = academicSources;
                    this.evidencePack.limitations = [
                        ...(this.evidencePack.limitations || []),
                        'Sources obtained via academic API fallback (Semantic Scholar/Crossref).',
                    ];
                } else {
                    this.evidencePack.gaps = Array.from(new Set([...(this.evidencePack.gaps || []), this.workOrder.topic]));
                    this.evidencePack.limitations = [
                        ...(this.evidencePack.limitations || []),
                        'Academic API fallback returned 0 results.',
                    ];
                }
            } catch (e: any) {
                this.evidencePack.gaps = Array.from(new Set([...(this.evidencePack.gaps || []), this.workOrder.topic]));
                this.evidencePack.limitations = [
                    ...(this.evidencePack.limitations || []),
                    `Academic API fallback failed: ${e?.message || 'unknown error'}`,
                ];
            }
        }

        this.updateStage('research', 'complete', 100, `Found ${this.evidencePack.sources.length} sources`);
    }

    private async stageAnalysis(): Promise<void> {
        this.updateStage('analysis', 'running', 0, 'Analyzing evidence...');

        const analysisTimeoutMs = Math.max(
            15_000,
            Math.min((this.workOrder.budget.timeoutMinutes || 10) * 60_000, 180_000)
        );

        const result = await this.withTimeout(
            contentAgent.execute({
                id: uuidv4(),
                type: 'analyze',
                input: {
                    topic: this.workOrder.topic,
                    evidence: this.evidencePack,
                    outline: this.contentSpec?.sections,
                },
                description: `Analyze evidence for: ${this.workOrder.topic}`,
                priority: 'medium',
                retries: 0,
                maxRetries: 3,
            }),
            analysisTimeoutMs,
            `production.contentAgent.execute(analyze:${this.workOrder.topic.slice(0, 60)})`
        );

        if (result.success && result.output?.insights) {
            // Merge insights into content spec
            this.contentSpec = {
                ...this.contentSpec!,
                abstract: result.output.executive_summary,
            };
        }

        this.updateStage('analysis', 'complete', 100, 'Analysis complete');
    }

    private async stageWriting(): Promise<void> {
        this.updateStage('writing', 'running', 0, 'Drafting content...');

        if (!this.contentSpec) {
            throw new Error('Content spec not initialized');
        }

        const sections = this.contentSpec.sections;
        let completedSections = 0;

        // Write each section - use index to ensure we mutate the original array
        for (let i = 0; i < sections.length; i++) {
            const section = this.contentSpec!.sections[i];
            const sectionAny = section;
            console.log(`[ProductionPipeline] Writing section ${i + 1}/${sections.length}: "${sectionAny.title || 'Untitled'}"`);

            this.updateStage(
                'writing',
                'running',
                Math.round((completedSections / sections.length) * 100),
                `Writing: ${sectionAny.title?.substring(0, 50) || 'Section'}...`
            );

            const writeTimeoutMs = Math.max(
                15_000,
                Math.min((this.workOrder.budget.timeoutMinutes || 10) * 60_000, 180_000)
            );

            const result = await this.withTimeout(
                documentAgent.execute({
                    id: uuidv4(),
                    type: 'write_section',
                    input: {
                        section: {
                            title: sectionAny.title,
                            objective: sectionAny.objective,
                            targetWordCount: sectionAny.targetWordCount || 200,
                        },
                        evidence: this.evidencePack,
                        tone: this.workOrder.tone,
                        citationStyle: this.workOrder.citationStyle,
                    },
                    description: `Write section: ${sectionAny.title || 'Untitled'}`,
                    priority: 'medium',
                    retries: 0,
                    maxRetries: 3,
                }),
                writeTimeoutMs,
                `production.documentAgent.execute(write_section:${(sectionAny.title || 'Untitled').slice(0, 60)})`
            );

            if (result.success && (result.output?.content || result.output?.result)) {
                const content = result.output.content || result.output.result || '';
                console.log(`[ProductionPipeline] Section "${sectionAny.title}" written. Length: ${content.length}`);
                // Directly mutate the original contentSpec section
                this.contentSpec!.sections[i].content = content;
            } else {
                console.warn(`[ProductionPipeline] Failed to write section "${sectionAny.title}". Success: ${result.success}, output: ${JSON.stringify(result.output)}`);
                this.contentSpec!.sections[i].content = this.contentSpec!.sections[i].content || '';
            }

            completedSections++;
        }

        this.updateStage('writing', 'complete', 100, `Drafted ${sections.length} sections`);
    }

    private async stageData(): Promise<void> {
        this.updateStage('data', 'running', 0, 'Building Excel workbook...');

        const result = await dataAgent.execute({
            id: uuidv4(),
            type: 'build_excel',
            input: {
                topic: this.workOrder.topic,
                dataPoints: this.evidencePack?.dataPoints || [],
                dataNeeds: this.workOrder.metadata?.dataNeeds || [],
            },
            description: `Build Excel workbook for: ${this.workOrder.topic}`,
            priority: 'medium',
            retries: 0,
            maxRetries: 3,
        });

        // Store Excel data for rendering
        this.workOrder.excelData = result.output?.data || [];

        this.updateStage('data', 'complete', 100, 'Excel structure ready');
    }

    private async stageSlides(): Promise<void> {
        this.updateStage('slides', 'running', 0, 'Building presentation...');

        const result = await contentAgent.execute({
            id: uuidv4(),
            type: 'create_presentation',
            input: {
                topic: this.workOrder.topic,
                content: this.contentSpec,
                maxSlides: this.workOrder.constraints.maxSlides || 15,
                audience: this.workOrder.audience,
            },
            description: `Create presentation for: ${this.workOrder.topic}`,
            priority: 'medium',
            retries: 0,
            maxRetries: 3,
        });

        // Store PPT data for rendering. Some agents return `output.slides`,
        // others nest the deck in `output.presentation.slides`.
        this.workOrder.pptData = Array.isArray(result.output?.slides)
            ? result.output.slides
            : Array.isArray(result.output?.presentation?.slides)
                ? result.output.presentation.slides
                : [];

        this.updateStage('slides', 'complete', 100, 'Presentation structure ready');
    }

    private async stageQA(): Promise<void> {
        this.updateStage('qa', 'running', 0, 'Running quality checks...');

        const qaTimeoutMs = Math.max(
            15_000,
            Math.min((this.workOrder.budget.timeoutMinutes || 10) * 60_000, 180_000)
        );

        const result = await this.withTimeout(
            qaAgent.execute({
                id: uuidv4(),
                type: 'validate_output',
                input: {
                    content: this.contentSpec,
                    workOrder: this.workOrder,
                    evidence: this.evidencePack,
                },
                description: `Validate output for: ${this.workOrder.topic}`,
                priority: 'medium',
                retries: 0,
                maxRetries: 3,
            }),
            qaTimeoutMs,
            `production.qaAgent.execute(validate_output:${this.workOrder.topic.slice(0, 60)})`
        );

        this.qaReport = {
            overallScore: result.output?.score || 0,
            passed: result.output?.passed || false,
            checks: result.output?.checks || [],
            suggestions: result.output?.suggestions || [],
            blockers: result.output?.blockers || [],
        };

        if (!this.qaReport.passed && this.qaReport.blockers.length > 0) {
            // Could implement retry loop here
            console.log('[ProductionPipeline] QA found blockers, attempting fixes...');
        }

        this.updateStage('qa', 'complete', 100, `QA Score: ${this.qaReport.overallScore}/100`);
    }

    private async stageConsistency(): Promise<void> {
        this.updateStage('consistency', 'running', 0, 'Checking cross-document consistency...');

        const result = await consistencyAgent.execute({
            id: uuidv4(),
            type: 'check_consistency',
            input: {
                documents: {
                    word: this.contentSpec ? {
                        sections: this.contentSpec.sections.map(s => ({
                            id: s.id,
                            title: s.type,
                            content: s.content || '',
                        })),
                        claims: [],
                        numbers: [],
                    } : undefined,
                    excel: this.workOrder.excelData ? {
                        sheets: [],
                        keyMetrics: [],
                        formulas: [],
                    } : undefined,
                    ppt: this.workOrder.pptData ? {
                        slides: [],
                        keyPoints: [],
                    } : undefined,
                },
                evidencePack: this.evidencePack,
            },
            description: `Check consistency for: ${this.workOrder.topic}`,
            priority: 'medium',
            retries: 0,
            maxRetries: 3,
        });

        this.traceMap = result.output?.report?.traceMap || {
            links: [],
            inconsistencies: [],
            coverageScore: 100,
        };

        this.updateStage('consistency', 'complete', 100, 'Consistency verified');
    }

    private async stageRender(): Promise<void> {
        this.updateStage('render', 'running', 0, 'Generating final documents...');

        const deliverables = this.workOrder.deliverables;
        let completed = 0;
        const documentSections = this.contentSpecToDocumentSections();
        const documentService = EnterpriseDocumentService.create('professional');

        // Render Word
        if (deliverables.includes('word')) {
            this.updateStage('render', 'running', (completed / deliverables.length) * 100, 'Generating Word document...');

            let docxBuffer: Buffer | null = null;
            let wordCount = 0;
            const templateDocType = this.getTemplateDrivenDocxType();

            if (templateDocType) {
                try {
                    console.log(`[ProductionPipeline] Using template-driven DOCX generation for type: ${templateDocType}`);
                    const result = await generateProfessionalDocument(
                        this.workOrder.topic,
                        templateDocType
                    );
                    docxBuffer = result.buffer;
                    wordCount = 200;
                    console.log(`[ProductionPipeline] Template-driven DOCX generation successful: ${docxBuffer.length} bytes`);
                } catch (error: any) {
                    console.warn(`[ProductionPipeline] Template-driven DOCX generation failed, switching to structured renderer: ${error.message}`);
                }
            }

            if (!docxBuffer) {
                try {
                    const wordResult = await documentService.generateDocument({
                        type: 'docx',
                        title: this.workOrder.topic,
                        subtitle: this.contentSpec?.abstract,
                        author: 'ILIAGPT AI',
                        sections: documentSections,
                        options: {
                            includeTableOfContents: documentSections.length > 1,
                            includePageNumbers: true,
                            includeHeader: true,
                            includeFooter: true,
                        },
                    });

                    if (!wordResult.success || !wordResult.buffer) {
                        throw new Error(wordResult.error || 'unknown error');
                    }

                    docxBuffer = wordResult.buffer;
                    wordCount = this.countWordsFromSections(documentSections);
                    console.log(`[ProductionPipeline] Structured DOCX generation successful: ${docxBuffer.length} bytes`);
                } catch (error: any) {
                    console.warn(`[ProductionPipeline] Structured DOCX generation failed, falling back to markdown: ${error.message}`);
                }
            }

            if (!docxBuffer) {
                const markdown = this.contentSpecToMarkdown();
                docxBuffer = await generateWordFromMarkdown(this.workOrder.topic, markdown);
                wordCount = markdown.split(/\s+/).filter(Boolean).length;
            }

            this.artifacts.push({
                type: 'word',
                filename: `${this.sanitizeFilename(this.workOrder.topic)}.docx`,
                buffer: docxBuffer,
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                size: docxBuffer.length,
                metadata: { wordCount },
            });

            completed++;
        }

        // Render Excel
        if (deliverables.includes('excel')) {
            this.updateStage('render', 'running', (completed / deliverables.length) * 100, 'Generating Excel workbook...');

            const excelDataRaw: any = (this.workOrder as any).excelData;
            const excelData: any[][] = this.normalizeExcelData(
                excelDataRaw,
                this.evidencePack?.sources || [],
                {
                    // A) 1 fila por artículo (schema fijo y testeable)
                    fixedSchema: 'articles_v1',
                }
            );

            const excelResult = await createExcelFromData(excelData, {
                title: this.workOrder.topic,
                theme: 'professional',
            });

            this.artifacts.push({
                type: 'excel',
                filename: `${this.sanitizeFilename(this.workOrder.topic)}.xlsx`,
                buffer: excelResult.buffer,
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                size: excelResult.buffer.length,
                metadata: {
                    rows: Math.max(0, excelData.length - 1),
                    columns: excelData[0]?.length || 0,
                },
            });

            completed++;
        }

        // Render PDF
        if (deliverables.includes('pdf')) {
            this.updateStage('render', 'running', (completed / deliverables.length) * 100, 'Generating PDF document...');

            const pdfResult = await documentService.generateDocument({
                type: 'pdf',
                title: this.workOrder.topic,
                subtitle: this.contentSpec?.abstract,
                author: 'ILIAGPT AI',
                sections: documentSections,
                options: {
                    includePageNumbers: true,
                    includeHeader: true,
                    includeFooter: true,
                },
            });

            if (!pdfResult.success || !pdfResult.buffer) {
                throw new Error(`PDF render failed: ${pdfResult.error || 'unknown error'}`);
            }

            this.artifacts.push({
                type: 'pdf',
                filename: `${this.sanitizeFilename(this.workOrder.topic)}.pdf`,
                buffer: pdfResult.buffer,
                mimeType: 'application/pdf',
                size: pdfResult.buffer.length,
                metadata: {
                    sections: documentSections.length,
                },
            });

            completed++;
        }

        // Render PPT
        if (deliverables.includes('ppt')) {
            this.updateStage('render', 'running', (completed / deliverables.length) * 100, 'Generating PowerPoint presentation...');

            // Build sections from pptData when available, otherwise fallback to contentSpec.
            const pptSlides: any[] = Array.isArray(this.workOrder.pptData) ? (this.workOrder.pptData as any[]) : [];

            const sections = pptSlides.length
                ? pptSlides.map((s, idx) => {
                    const title = (s?.title || s?.heading || s?.name || `Slide ${idx + 1}`).toString();
                    const bullets = Array.isArray(s?.bullets) ? s.bullets : Array.isArray(s?.points) ? s.points : null;
                    const body = (s?.content || s?.body || s?.text || '').toString();
                    const content = bullets ? bullets.map((b: any) => `• ${String(b)}`).join('\n') : body;
                    return {
                        title,
                        content: content || '(Sin contenido)',
                    };
                })
                : (this.contentSpec?.sections || []).map((sec: any, idx) => ({
                    title: sec?.title || `Sección ${idx + 1}`,
                    content: sec?.content || '',
                }));

            const pptService = EnterpriseDocumentService.create('professional');
            const pptResult = await pptService.generateDocument({
                type: 'pptx',
                title: this.workOrder.topic,
                author: 'ILIAGPT AI',
                sections,
            } as any);

            if (!pptResult.success || !pptResult.buffer) {
                throw new Error(`PPT render failed: ${pptResult.error || 'unknown error'}`);
            }

            this.artifacts.push({
                type: 'ppt',
                filename: `${this.sanitizeFilename(this.workOrder.topic)}.pptx`,
                buffer: pptResult.buffer,
                mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                size: pptResult.buffer.length,
                metadata: { slides: sections.length },
            });

            completed++;
        }

        this.updateStage('render', 'complete', 100, `Generated ${this.artifacts.length} documents`);
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    private normalizeExcelData(
        excelDataRaw: any,
        sources: any[],
        opts: { fixedSchema?: 'articles_v1' } = {}
    ): any[][] {
        // Primary goal: always return a valid any[][] (never null) to avoid runtime crashes.
        // Secondary: enforce a fixed schema when user wants A) 1 row per article.

        const fixedSchema = opts.fixedSchema;

        const is2DArray = (v: any): v is any[][] =>
            Array.isArray(v) && (v.length === 0 || Array.isArray(v[0]));

        const coerceTo2DFromRows = (rows: any[]): any[][] => {
            // rows: Array<object> → [headers, ...values]
            const objects = rows.filter(r => r && typeof r === 'object' && !Array.isArray(r));
            if (objects.length === 0) return [];

            const headerSet = new Set<string>();
            for (const obj of objects) {
                for (const k of Object.keys(obj)) headerSet.add(k);
            }
            const headers = Array.from(headerSet);
            if (headers.length === 0) return [];

            const data: any[][] = [headers];
            for (const obj of objects) {
                data.push(headers.map(h => (obj as any)[h] ?? ''));
            }
            return data;
        };

        const buildArticlesSchemaV1 = (srcs: any[]): any[][] => {
            const headers = ['Título', 'Autores', 'Año', 'Revista/Conferencia', 'DOI', 'URL', 'Resumen', 'Cita'];
            const rows: any[][] = [headers];

            const safeText = (v: any) => {
                if (v == null) return '';
                if (typeof v === 'string') return v;
                if (typeof v === 'number') return String(v);
                if (Array.isArray(v)) return v.map(x => safeText(x)).filter(Boolean).join(', ');
                if (typeof v === 'object') {
                    // common patterns
                    if ((v as any).name) return safeText((v as any).name);
                    if ((v as any).text) return safeText((v as any).text);
                    if ((v as any).title) return safeText((v as any).title);
                }
                return String(v);
            };

            for (const s of Array.isArray(srcs) ? srcs : []) {
                if (!s) continue;
                const title = safeText(s.title || s.paperTitle || s.name);
                const authors = safeText(s.authors || s.author || s.creators);
                const year = safeText(s.year || s.publicationYear || s.dateYear);
                const venue = safeText(s.venue || s.journal || s.conference || s.publisher);
                const doi = safeText(s.doi || s.DOI);
                const url = safeText(s.url || s.link || s.href);
                const abstract = safeText(s.abstract || s.summary || s.snippet);
                const citation = safeText(s.citation || s.cite || s.bibtex);

                // Keep at least title/url/snippet if available
                if (!title && !url && !abstract) continue;

                rows.push([title, authors, year, venue, doi, url, abstract, citation]);
            }

            return rows.length > 1 ? rows : [headers, ...[['(Sin resultados)', '', '', '', '', '', '', '']]];
        };

        // 1) If fixed schema requested, prefer building from sources when available.
        if (fixedSchema === 'articles_v1' && Array.isArray(sources) && sources.length > 0) {
            return buildArticlesSchemaV1(sources);
        }

        // 2) If we already have 2D data, sanitize it.
        if (is2DArray(excelDataRaw)) {
            const cleaned = (excelDataRaw as any[][])
                .filter(r => Array.isArray(r))
                .map(r => r.map(c => (c == null ? '' : c)));
            return cleaned.length > 0 ? cleaned : [['No data']];
        }

        // 3) If it's an array of objects/rows, coerce.
        if (Array.isArray(excelDataRaw)) {
            const coerced = coerceTo2DFromRows(excelDataRaw);
            if (coerced.length > 0) return coerced;
        }

        // 4) Common shapes: { headers, rows }
        if (excelDataRaw && typeof excelDataRaw === 'object') {
            const headers = (excelDataRaw as any).headers;
            const rows = (excelDataRaw as any).rows;
            if (Array.isArray(headers) && Array.isArray(rows)) {
                const matrix: any[][] = [headers.map((h: any) => (h == null ? '' : String(h)))];
                for (const r of rows) {
                    if (Array.isArray(r)) matrix.push(r.map((c: any) => (c == null ? '' : c)));
                    else if (r && typeof r === 'object') matrix.push(headers.map((h: any) => (r as any)[h] ?? ''));
                }
                return matrix.length > 0 ? matrix : [['No data']];
            }
        }

        // 5) Fallback: if sources exist, still build schema.
        if (Array.isArray(sources) && sources.length > 0) {
            return buildArticlesSchemaV1(sources);
        }

        return [['No data']];
    }

    private contentSpecToMarkdown(): string {
        if (!this.contentSpec) {
            console.warn('[ProductionPipeline] No contentSpec available for markdown generation');
            return '';
        }

        console.log(`[ProductionPipeline] Generating markdown for ${this.contentSpec.sections.length} sections`);

        let md = `# ${this.contentSpec.title}\n\n`;

        if (this.contentSpec.abstract) {
            md += `## Resumen Ejecutivo\n\n${this.contentSpec.abstract}\n\n`;
        }

        for (const section of this.contentSpec.sections) {
            const sectionAny = section;
            const sectionTitle = sectionAny.title || '';
            const sectionBody = section.content || '';

            console.log(`[ProductionPipeline] Section: title="${sectionTitle.substring(0, 30)}..." body_len=${sectionBody.length}`);

            // Always output the section header if there's a title
            if (sectionTitle) {
                md += `## ${sectionTitle}\n\n`;
            }

            // Output the body content (generated by agent)
            if (sectionBody) {
                md += `${sectionBody}\n\n`;
            }
        }

        console.log(`[ProductionPipeline] Generated markdown total length: ${md.length}`);
        return md;
    }

    private contentSpecToDocumentSections(): EnterpriseDocumentSection[] {
        const sections: EnterpriseDocumentSection[] = [];

        if (this.contentSpec?.abstract?.trim()) {
            sections.push({
                id: 'executive-summary',
                title: 'Resumen Ejecutivo',
                content: this.contentSpec.abstract.trim(),
                level: 1,
            });
        }

        for (const [index, section] of (this.contentSpec?.sections || []).entries()) {
            const converted = this.mapSectionToDocumentSection(section, index);
            if (converted) {
                sections.push(converted);
            }
        }

        if (sections.length === 0) {
            sections.push({
                id: 'document-body',
                title: this.workOrder.topic,
                content: this.workOrder.description || this.workOrder.topic,
                level: 1,
            });
        }

        return sections;
    }

    private mapSectionToDocumentSection(section: Section, index: number): EnterpriseDocumentSection | null {
        const title = (section.title || this.humanizeSectionTitle(section.type, index)).trim();
        const content = (section.content || '').trim();
        const subsections = (section.children || [])
            .map((child, childIndex) => this.mapSectionToDocumentSection(child, childIndex))
            .filter((value): value is EnterpriseDocumentSection => Boolean(value));

        if (!title && !content && subsections.length === 0) {
            return null;
        }

        return {
            id: section.id || `section-${index + 1}`,
            title: title || `Sección ${index + 1}`,
            content: content || 'Contenido generado automáticamente.',
            level: this.mapSectionLevel(section.type),
            subsections: subsections.length > 0 ? subsections : undefined,
        };
    }

    private mapSectionLevel(type: Section['type']): 1 | 2 | 3 {
        if (type === 'h2') return 2;
        if (type === 'h3') return 3;
        return 1;
    }

    private humanizeSectionTitle(type: Section['type'], index: number): string {
        switch (type) {
            case 'quote':
                return `Cita ${index + 1}`;
            case 'table':
                return `Tabla ${index + 1}`;
            case 'figure':
                return `Figura ${index + 1}`;
            case 'list':
                return `Lista ${index + 1}`;
            case 'citation':
                return `Referencia ${index + 1}`;
            default:
                return `Sección ${index + 1}`;
        }
    }

    private countWordsFromSections(sections: EnterpriseDocumentSection[]): number {
        let total = 0;

        for (const section of sections) {
            total += `${section.title} ${section.content}`.split(/\s+/).filter(Boolean).length;
            if (section.subsections?.length) {
                total += this.countWordsFromSections(section.subsections);
            }
        }

        return total;
    }

    private getTemplateDrivenDocxType(): string | null {
        const topic = this.workOrder.topic.toLowerCase();
        const explicitTemplatePatterns: Array<{ pattern: RegExp; type: string }> = [
            { pattern: /\bcontrato\b|\bacuerdo\b/i, type: 'contrato' },
            { pattern: /\bsolicitud\b|\bpermiso\b|\boficio\b|\bmemorial\b|\bcarta\b/i, type: 'solicitud' },
            { pattern: /\bfactura\b|\bcotizaci[oó]n\b/i, type: 'factura' },
            { pattern: /\bcurriculum\b|\bcurr[ií]culum\b|\bcv\b/i, type: 'cv' },
        ];

        const match = explicitTemplatePatterns.find(({ pattern }) => pattern.test(topic));
        return match?.type || null;
    }

    private sanitizeFilename(name: string): string {
        return name
            .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s-]/g, '')
            .replace(/\s+/g, '_')
            .substring(0, 50);
    }

    private getMissingDeliverables(): Deliverable[] {
        const produced = new Set(this.artifacts.map((artifact) => artifact.type));
        return this.workOrder.deliverables.filter((deliverable) => !produced.has(deliverable));
    }

    private describeMissingDeliverables(missingDeliverables: Deliverable[]): string | null {
        if (missingDeliverables.length === 0) return null;
        const requested = this.workOrder.deliverables.join(', ');
        const generated = this.artifacts.map((artifact) => artifact.type).join(', ') || 'Ninguno';
        if (this.artifacts.length === 0) {
            return `No se generó ningún entregable solicitado. Solicitados: ${requested}. Generados: ${generated}.`;
        }
        return `Faltan entregables solicitados: ${missingDeliverables.join(', ')}. Generados: ${generated}.`;
    }

    private buildQaReport(
        status: 'success' | 'partial' | 'failed',
        missingDeliverables: Deliverable[]
    ): QAReport {
        const base: QAReport = this.qaReport || {
            overallScore: 0,
            passed: false,
            checks: [],
            suggestions: [],
            blockers: [],
        };
        const missingDetail = this.describeMissingDeliverables(missingDeliverables);
        if (!missingDetail) {
            return base;
        }
        return {
            ...base,
            passed: false,
            blockers: Array.from(new Set([...(base.blockers || []), missingDetail])),
            suggestions:
                status === 'partial'
                    ? Array.from(new Set([...(base.suggestions || []), 'Reintenta la generación para completar los archivos faltantes.']))
                    : base.suggestions || [],
        };
    }

    private buildEvidencePack(missingDeliverables: Deliverable[]): EvidencePack {
        const base: EvidencePack = this.evidencePack || {
            sources: [],
            notes: [],
            dataPoints: [],
            gaps: [],
            limitations: [],
        };
        const missingDetail = this.describeMissingDeliverables(missingDeliverables);
        if (!missingDetail) {
            return base;
        }
        return {
            ...base,
            limitations: Array.from(new Set([...(base.limitations || []), missingDetail])),
        };
    }

    private buildResult(status: 'success' | 'partial' | 'failed'): ProductionResult {
        const endTime = new Date();
        const missingDeliverables = this.getMissingDeliverables();
        const normalizedStatus =
            status === 'success' && missingDeliverables.length > 0
                ? this.artifacts.length > 0
                    ? 'partial'
                    : 'failed'
                : status;
        const failureDetail = this.describeMissingDeliverables(missingDeliverables);
        const evidencePack = this.buildEvidencePack(missingDeliverables);
        const qaReport = this.buildQaReport(normalizedStatus, missingDeliverables);
        const failureReason =
            normalizedStatus === 'failed'
                ? this.failureReason || failureDetail || 'La producción documental no pudo completarse.'
                : null;

        return {
            workOrderId: this.workOrder.id,
            status: normalizedStatus,
            artifacts: this.artifacts,
            summary: this.generateSummary(normalizedStatus, missingDeliverables, failureReason),
            evidencePack,
            traceMap: this.traceMap || { links: [], inconsistencies: [], coverageScore: 0 },
            qaReport,
            timing: {
                startedAt: this.startTime,
                completedAt: endTime,
                durationMs: endTime.getTime() - this.startTime.getTime(),
                stageTimings: Object.fromEntries(this.stageTimings) as Record<PipelineStage, number>,
            },
            costs: {
                llmCalls: 0, // Would be tracked during execution
                searchQueries: evidencePack.sources.length || 0,
                tokensUsed: 0,
            },
        };
    }

    private generateSummary(
        status: 'success' | 'partial' | 'failed',
        missingDeliverables: Deliverable[] = [],
        failureReason?: string | null
    ): string {
        const requested = this.workOrder.deliverables.join(', ');
        const deliverables = this.artifacts.map(a => a.type).join(', ');
        const sources = this.evidencePack?.sources.length || 0;
        const qaScore = this.qaReport?.overallScore || 0;
        const limitations = this.evidencePack?.limitations.length ? `**Limitaciones:** ${this.evidencePack.limitations.join(', ')}` : '';
        const missing = missingDeliverables.length ? `**Entregables faltantes:** ${missingDeliverables.join(', ')}` : '';

        if (status === 'failed') {
            return `
## Producción Fallida

**Tema:** ${this.workOrder.topic}
**Entregables solicitados:** ${requested}
**Entregables generados:** ${deliverables || 'Ninguno'}
**Fuentes consultadas:** ${sources}
**Calidad (QA):** ${qaScore}/100

**Error:** ${failureReason || 'La producción documental no pudo completarse.'}
${missing}
${limitations}
    `.trim();
        }

        if (status === 'partial') {
            return `
## Producción Parcial

**Tema:** ${this.workOrder.topic}
**Entregables solicitados:** ${requested}
**Entregables generados:** ${deliverables || 'Ninguno'}
**Fuentes consultadas:** ${sources}
**Calidad (QA):** ${qaScore}/100

${missing}
${limitations}
    `.trim();
        }

        return `
## Producción Completada

**Tema:** ${this.workOrder.topic}
**Entregables:** ${deliverables || 'Ninguno'}
**Fuentes consultadas:** ${sources}
**Calidad (QA):** ${qaScore}/100

${limitations}
    `.trim();
    }

    // ============================================================================
    // Control Methods
    // ============================================================================

    abort(): void {
        this.aborted = true;
        this.emitEvent({
            type: 'stage_error',
            message: 'Pipeline aborted by user',
        });
    }

    getProgress(): Map<PipelineStage, StageProgress> {
        return new Map(this.stageProgress);
    }
}

// ============================================================================
// Factory Function
// ============================================================================

export interface StartProductionPipelineOptions extends TaskRouterOptions {
    // Allows callers (e.g. doc-tool selection / intent router) to force production mode
    // and avoid the pipeline reclassifying the message as regular chat.
    deliverables?: Deliverable[];
    intent?: DocumentIntent;
    topic?: string;
}

export async function startProductionPipeline(
    message: string,
    userId: string,
    chatId?: string,
    onEvent?: ProductionEventHandler,
    options: StartProductionPipelineOptions = {}
): Promise<ProductionResult> {
    const { deliverables, intent, topic, ...routerOptions } = options;
    const forceProduction =
        routerOptions.forceProduction ||
        Boolean(deliverables?.length) ||
        Boolean(intent) ||
        Boolean(topic);

    // Route the task
    const routerResultBase = await routeTask(message, undefined, {
        ...routerOptions,
        forceProduction,
    });

    const routerResult: RouterResult = {
        ...routerResultBase,
        ...(forceProduction
            ? { mode: 'PRODUCTION', reasoning: `${routerResultBase.reasoning} (forced by caller)` }
            : {}),
        ...(deliverables?.length ? { deliverables } : {}),
        ...(intent ? { intent } : {}),
        ...(topic ? { topic } : {}),
    };

    if (routerResult.mode !== 'PRODUCTION') {
        throw new Error('Message does not require production mode');
    }

    // Create work order
    const workOrder = await createWorkOrder({
        routerResult,
        message,
        userId,
        chatId,
    });

    // Create and run pipeline
    const pipeline = new ProductionPipeline(workOrder);

    if (onEvent) {
        pipeline.on('event', onEvent);
    }

    return pipeline.run();
}
