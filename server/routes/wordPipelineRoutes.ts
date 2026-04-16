import { Router, Request, Response } from "express";
import { z } from "zod";
import { 
  createWordPipeline, 
  PipelineEvent, 
  PIPELINE_VERSION, 
  SupportedLocaleSchema, 
  createLayoutPlanner, 
  validateRenderTree, 
  createThemeManager, 
  ThemeIdSchema,
  getAvailableThemes
} from "../agent/word-pipeline";
import type { CompoundPlan, CompoundPlanStep } from "../agent/word-pipeline";
import { DocumentSpecSchema, DocumentTypeSchema, ToneSchema, AudienceSchema } from "../agent/word-pipeline/documentSpec";
import { routeDocIntent, getAvailableDocTypes } from "../agent/word-pipeline/docIntentRouter";

const router = Router();

const ExecuteRequestSchema = z.object({
  query: z.string().min(1).max(5000),
  locale: SupportedLocaleSchema.optional(),
  maxIterations: z.number().int().min(1).max(5).optional(),
  enableSemanticCache: z.boolean().optional(),
});

const activePipelines = new Map<string, { abort: () => void }>();

router.post("/execute", async (req: Request, res: Response) => {
  try {
    const body = ExecuteRequestSchema.parse(req.body);
    
    const pipeline = createWordPipeline({
      maxIterations: body.maxIterations || 3,
      enableSemanticCache: body.enableSemanticCache ?? true,
    });

    const result = await pipeline.execute(body.query, {
      locale: body.locale,
    });

    if (result.success && result.artifacts.length > 0) {
      const artifact = result.artifacts[0];
      res.json({
        success: true,
        runId: result.state.runId,
        pipelineVersion: PIPELINE_VERSION,
        artifact: {
          id: artifact.id,
          filename: artifact.filename,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
        },
        metrics: {
          totalDurationMs: result.state.totalDurationMs,
          totalTokensUsed: result.state.totalTokensUsed,
          stageCount: result.state.stageResults.length,
          qualityGatesPassed: result.state.qualityGates.filter(g => g.passed).length,
          qualityGatesTotal: result.state.qualityGates.length,
          claimsVerified: result.state.claims.filter(c => c.verified).length,
          claimsTotal: result.state.claims.length,
          gapsDetected: result.state.gaps.length,
          iterations: result.state.currentIteration,
        },
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.state.error || "Pipeline failed to produce artifacts",
        runId: result.state.runId,
      });
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid request", details: error.errors });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

router.get("/execute/stream", async (req: Request, res: Response) => {
  const query = req.query.query as string;
  const locale = req.query.locale as string | undefined;
  
  if (!query) {
    res.status(400).json({ error: "Query parameter required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const sendEvent = (event: PipelineEvent) => {
    res.write(`event: ${event.eventType}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const pipeline = createWordPipeline({
    maxIterations: 3,
    enableSemanticCache: true,
  });

  const runIdPromise = new Promise<string>((resolve) => {
    pipeline.once("event", (event: PipelineEvent) => {
      resolve(event.runId);
    });
  });

  const executePromise = pipeline.execute(query, {
    locale: locale as any,
    onEvent: sendEvent,
  });

  const runId = await runIdPromise;
  activePipelines.set(runId, { abort: () => pipeline.abort() });

  req.on("close", () => {
    const pipelineRef = activePipelines.get(runId);
    if (pipelineRef) {
      pipelineRef.abort();
      activePipelines.delete(runId);
    }
  });

  try {
    const result = await executePromise;
    
    if (result.success && result.artifacts.length > 0) {
      const artifact = result.artifacts[0];
      sendEvent({
        runId: result.state.runId,
        eventType: "artifact.created",
        data: {
          id: artifact.id,
          filename: artifact.filename,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          downloadUrl: `/api/word-pipeline/download/${result.state.runId}`,
        },
        timestamp: new Date().toISOString(),
      });
    }
    
    res.write("event: done\n");
    res.write(`data: ${JSON.stringify({ success: result.success, runId: result.state.runId })}\n\n`);
  } catch (error: any) {
    sendEvent({
      runId,
      eventType: "pipeline.failed",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  } finally {
    activePipelines.delete(runId);
    res.end();
  }
});

router.post("/abort/:runId", (req: Request, res: Response) => {
  const { runId } = req.params;
  const pipeline = activePipelines.get(runId);
  
  if (pipeline) {
    pipeline.abort();
    activePipelines.delete(runId);
    res.json({ success: true, message: "Pipeline aborted" });
  } else {
    res.status(404).json({ success: false, error: "Pipeline not found or already completed" });
  }
});

router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "healthy",
    pipelineVersion: PIPELINE_VERSION,
    activePipelines: activePipelines.size,
    timestamp: new Date().toISOString(),
  });
});

router.get("/version", (_req: Request, res: Response) => {
  res.json({
    version: PIPELINE_VERSION,
    stages: [
      "DocumentPlanner",
      "EvidenceBuilder",
      "SemanticAnalyzer",
      "DataNormalizer",
      "SectionWriter",
      "ClaimExtractor",
      "FactVerifier",
      "ConsistencyCritic",
      "LayoutPlanner",
      "WordAssembler",
    ],
    features: {
      qualityGates: true,
      circuitBreaker: true,
      semanticCache: true,
      sseStreaming: true,
      gapDetection: true,
      claimVerification: true,
      documentTypeRouting: true,
      theming: true,
      layoutEngine: true,
      compoundIntentPlanning: true,
    },
  });
});

const CompoundPlanStepSchema = z.object({
  id: z.string(),
  type: z.enum(["generate_section", "verify_claims", "apply_style", "assemble"]),
  sectionId: z.string().optional(),
  config: z.record(z.any()).optional(),
  dependsOn: z.array(z.string()).optional(),
});

const CompoundPlanSchema = z.object({
  id: z.string(),
  steps: z.array(CompoundPlanStepSchema),
  documentSpec: DocumentSpecSchema.optional(),
  themeId: ThemeIdSchema.optional(),
});

const CompileRequestSchema = z.object({
  documentSpec: DocumentSpecSchema.optional(),
  query: z.string().min(1).max(5000).optional(),
  locale: SupportedLocaleSchema.optional(),
  doc_type: DocumentTypeSchema.optional(),
  tone: ToneSchema.optional(),
  audience: AudienceSchema.optional(),
  theme_id: ThemeIdSchema.optional(),
  topic: z.string().optional(),
  compound_plan: CompoundPlanSchema.optional(),
  contentGraph: z.object({
    sections: z.array(z.object({
      id: z.string(),
      title: z.string(),
      content: z.string(),
    })).optional(),
    assets: z.array(z.object({
      id: z.string(),
      type: z.enum(["image", "chart", "logo"]),
      url: z.string().optional(),
      data: z.string().optional(),
    })).optional(),
  }).optional(),
});

router.post("/compile", async (req: Request, res: Response) => {
  try {
    const body = CompileRequestSchema.parse(req.body);
    
    let documentSpec = body.documentSpec || body.compound_plan?.documentSpec;
    const compoundPlan = body.compound_plan;
    
    if (!documentSpec && body.query) {
      const docIntentResult = routeDocIntent({
        query: body.query,
        locale: body.locale || "en",
        topic: body.topic,
        doc_type: body.doc_type,
        tone: body.tone,
        audience: body.audience,
        theme_id: body.theme_id,
      });
      documentSpec = docIntentResult.documentSpec;
    }

    if (!documentSpec) {
      res.status(400).json({
        success: false,
        error: "Either documentSpec, compound_plan.documentSpec, or query is required",
      });
      return;
    }

    const themeId = body.theme_id || compoundPlan?.themeId || (documentSpec.theme_id as any) || "default";
    
    const themeManager = createThemeManager(
      themeId,
      documentSpec.doc_type,
      documentSpec.locale
    );

    const pipeline = createWordPipeline({
      maxIterations: 3,
      enableSemanticCache: true,
    });

    const result = await pipeline.execute(body.query || documentSpec.title, {
      locale: documentSpec.locale,
      documentSpec,
      themeId,
      compoundPlan: compoundPlan as CompoundPlan | undefined,
    });

    if (result.success && result.artifacts.length > 0) {
      const artifact = result.artifacts[0];
      
      const layoutPlanner = createLayoutPlanner(documentSpec, themeManager);
      const sectionContents = result.state.sections.map(s => ({
        sectionId: s.sectionId,
        markdown: s.markdown,
        claims: result.state.claims.filter(c => c.sectionId === s.sectionId),
        wordCount: s.wordCount,
        entities: s.entities || [],
      }));
      
      const renderTree = layoutPlanner.planLayout(sectionContents);
      const renderTreeValidation = validateRenderTree(renderTree);
      
      res.json({
        success: true,
        docx_url: `/api/word-pipeline/download/${result.state.runId}`,
        render_report: {
          runId: result.state.runId,
          pipelineVersion: PIPELINE_VERSION,
          templateVersion: documentSpec.template_id || "default_v1",
          sectionsRendered: result.state.sections.length,
          totalWordCount: result.state.sections.reduce((sum, s) => sum + s.wordCount, 0),
          renderTree: {
            id: renderTree.id,
            sectionCount: renderTree.sections.length,
            totalBlocks: renderTree.sections.reduce((sum, s) => sum + s.blocks.length, 0),
            bibliographyEntries: renderTree.bibliography?.length || 0,
          },
          renderTreeValidation: {
            isValid: renderTreeValidation.isValid,
            errors: renderTreeValidation.errors,
          },
        },
        style_report: {
          theme: themeId,
          themeDefinition: themeManager.getTheme(),
          typography: themeManager.getTypography(),
          colorPalette: themeManager.getColorPalette(),
          spacing: themeManager.getSpacing(),
          margins: themeManager.getMargins(),
          pageSetup: themeManager.getPageSetup(),
          ooxmlStyles: themeManager.getAllOOXMLStyles(),
        },
        verification_report: {
          claimsTotal: result.state.claims.length,
          claimsVerified: result.state.claims.filter(c => c.verified).length,
          verificationRate: result.state.claims.length > 0 
            ? result.state.claims.filter(c => c.verified).length / result.state.claims.length 
            : 1,
          gapsDetected: result.state.gaps.length,
          qualityGatesPassed: result.state.qualityGates.filter(g => g.passed).length,
        },
        layout_report: {
          documentSpecId: documentSpec.id,
          documentType: documentSpec.doc_type,
          sectionsPlanned: documentSpec.sections.length,
          sectionsRendered: renderTree.sections.length,
          renderBlocks: renderTree.sections.map(s => ({
            sectionId: s.id,
            title: s.title,
            blockCount: s.blocks.length,
            blockTypes: s.blocks.map(b => b.type),
          })),
        },
        compound_plan_report: compoundPlan ? {
          planId: compoundPlan.id,
          stepsTotal: compoundPlan.steps.length,
          stepsExecuted: compoundPlan.steps.length,
        } : undefined,
        artifact: {
          id: artifact.id,
          filename: artifact.filename,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
        },
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.state.error || "Pipeline failed to compile document",
        runId: result.state.runId,
        gaps: result.state.gaps,
        style_report: {
          theme: themeId,
          typography: themeManager.getTypography(),
          colorPalette: themeManager.getColorPalette(),
        },
      });
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid request", details: error.errors });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

router.get("/doc-types", (_req: Request, res: Response) => {
  res.json({
    docTypes: getAvailableDocTypes(),
  });
});

router.get("/themes", (_req: Request, res: Response) => {
  res.json({
    themes: getAvailableThemes(),
  });
});

router.post("/preview-spec", (req: Request, res: Response) => {
  try {
    const { query, locale, doc_type, tone, audience, theme_id, topic } = req.body;
    
    if (!query && !doc_type) {
      res.status(400).json({ success: false, error: "Query or doc_type required" });
      return;
    }

    const result = routeDocIntent({
      query: query || "",
      locale: locale || "en",
      topic,
      doc_type,
      tone,
      audience,
      theme_id,
    });

    res.json({
      success: true,
      documentSpec: result.documentSpec,
      suggestedTemplate: result.suggestedTemplate,
      confidence: result.confidence,
      extractedEntities: result.extractedEntities,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
