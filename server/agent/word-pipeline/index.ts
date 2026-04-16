import { WordAgentOrchestrator } from "./orchestrator";
import { documentPlannerStage } from "./stages/documentPlanner";
import { evidenceBuilderStage } from "./stages/evidenceBuilder";
import { semanticAnalyzerStage } from "./stages/semanticAnalyzer";
import { dataNormalizerStage } from "./stages/dataNormalizer";
import { sectionWriterStage } from "./stages/sectionWriter";
import { claimExtractorStage, factVerifierStage } from "./stages/claimVerifier";
import { consistencyCriticStage } from "./stages/consistencyCritic";
import { wordAssemblerStage } from "./stages/wordAssembler";
import { PipelineEvent, PipelineState, PIPELINE_VERSION, SupportedLocale } from "./contracts";

export function createWordPipeline(config?: Parameters<typeof WordAgentOrchestrator.prototype.constructor>[0]): WordAgentOrchestrator {
  const orchestrator = new WordAgentOrchestrator(config);
  
  orchestrator.registerStage("planner", documentPlannerStage);
  orchestrator.registerStage("evidence", evidenceBuilderStage);
  orchestrator.registerStage("analyzer", semanticAnalyzerStage);
  orchestrator.registerStage("normalizer", dataNormalizerStage);
  orchestrator.registerStage("writer", sectionWriterStage);
  orchestrator.registerStage("claims", claimExtractorStage);
  orchestrator.registerStage("verifier", factVerifierStage);
  orchestrator.registerStage("critic", consistencyCriticStage);
  orchestrator.registerStage("assembler", wordAssemblerStage);
  
  return orchestrator;
}

export async function executeWordPipeline(
  query: string,
  options: {
    locale?: SupportedLocale;
    onEvent?: (event: PipelineEvent) => void;
    maxIterations?: number;
    enableSemanticCache?: boolean;
  } = {}
): Promise<{ success: boolean; state: PipelineState; artifacts: PipelineState["artifacts"] }> {
  const pipeline = createWordPipeline({
    maxIterations: options.maxIterations,
    enableSemanticCache: options.enableSemanticCache,
  });
  
  return pipeline.execute(query, {
    locale: options.locale,
    onEvent: options.onEvent,
  });
}

export {
  WordAgentOrchestrator,
  documentPlannerStage,
  evidenceBuilderStage,
  semanticAnalyzerStage,
  dataNormalizerStage,
  sectionWriterStage,
  claimExtractorStage,
  factVerifierStage,
  consistencyCriticStage,
  wordAssemblerStage,
  PIPELINE_VERSION,
};

export type { CompoundPlan, CompoundPlanStep } from "./orchestrator";

export { createLayoutPlanner, validateRenderTree, LayoutPlanner } from "./layoutPlanner";
export type { RenderTree, RenderSection, RenderBlock, RenderBlockType } from "./layoutPlanner";

export { createThemeManager, getAvailableThemes, getThemeById, ThemeManager, ThemeIdSchema } from "./themeManager";
export type { ThemeId, ThemeDefinition, StyleToken, OOXMLStyle } from "./themeManager";

export * from "./contracts";
