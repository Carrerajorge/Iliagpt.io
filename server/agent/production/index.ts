/**
 * Production Mode Index
 * 
 * Barrel export for all production mode components.
 */

// Types
export * from './types';

// Task Router
export { routeTask, type RouterResult, type TaskRouterOptions } from './taskRouter';

// WorkOrder Processor
export {
    createWorkOrder,
    enrichWorkOrder,
    validateWorkOrder,
    INTENT_DEFAULTS,
    type CreateWorkOrderInput,
} from './workOrderProcessor';

// Blueprint Agent
export {
    generateBlueprint,
    DOCUMENT_TEMPLATES,
    DEFAULT_QA_CRITERIA,
    type OutlineSpec,
    type ResearchPlan,
    type QARubric,
    type DeliverableMap,
    type BlueprintResult,
} from './blueprintAgent';

// Analysis Agent
export {
    analyzeEvidence,
    getArgumentsForSection,
    getFindingsForSection,
    getCriticalFindings,
    type ArgumentGraph,
    type KeyFinding,
    type Gap,
    type Contradiction,
    type AnalysisResult,
} from './analysisAgent';

// Slide Architect Agent
export {
    designSlideDeck,
    STORY_ARCS,
    SLIDE_DENSITY_RULES,
    type SlideDeckSpec,
    type Slide,
    type SlideType,
} from './slideArchitectAgent';

// Writing Agent
export {
    writeSections,
    buildContentSpec,
    type SectionDraft,
    type WritingResult,
    type WritingContext,
} from './writingAgent';

// Quality Gates
export {
    runQualityGate,
    planRemediation,
    CRITERION_CHECKERS,
    type QACheckResult,
    type QAGateResult,
    type RemediationAction,
} from './qualityGates';

// Observability
export {
    jobTracker,
    metricsCollector,
    auditLogger,
    budgetController,
    startJobTracking,
    completeJobTracking,
    failJobTracking,
    type JobRecord,
    type JobMetrics,
    type AuditEvent,
    type PerformanceMetric,
    type Budget,
    type BudgetStatus,
} from './observability';

// Consistency Agent
export { ConsistencyAgent, consistencyAgent } from './consistencyAgent';

// Production Pipeline
export {
    ProductionPipeline,
    startProductionPipeline,
} from './productionPipeline';
