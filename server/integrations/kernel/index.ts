/**
 * Integration Kernel — Module index
 */

export * from "./types";
export { connectorRegistry, ConnectorRegistry } from "./connectorRegistry";
export type { CredentialResolver, ConnectorExecutorInterface, UserPolicy, ConnectorHandlerFactory } from "./connectorRegistry";
export { credentialVault, CredentialVault } from "./credentialVault";
export { connectorExecutor, ConnectorExecutor } from "./connectorExecutor";
export { mountConnectorTools, getConnectorDeclarationsForUser, hasAnyConnectedApps } from "./connectorToolBridge";
export { initializeConnectorManifests, loadAllConnectorManifests } from "./manifestLoader";
export { connectorEventBus, ConnectorEventBus } from "./connectorEventBus";
export type {
  ConnectorEvent,
  ConnectorEventType,
  ConnectorEventMap,
  ConnectorEventHandler,
  ConnectorRegisteredEvent,
  ConnectorConnectedEvent,
  ConnectorDisconnectedEvent,
  ConnectorOperationStartedEvent,
  ConnectorOperationCompletedEvent,
  ConnectorOperationFailedEvent,
  ConnectorCredentialRefreshedEvent,
  ConnectorCredentialExpiredEvent,
  ConnectorCredentialRevokedEvent,
  ConnectorCircuitOpenedEvent,
  ConnectorCircuitClosedEvent,
  ConnectorCircuitHalfOpenEvent,
  ConnectorRateLimitWarningEvent,
  ConnectorRateLimitExceededEvent,
  ConnectorHealthDegradedEvent,
  ConnectorHealthRecoveredEvent,
  ConnectorWebhookReceivedEvent,
  ConnectorSagaStartedEvent,
  ConnectorSagaCompletedEvent,
  ConnectorSagaCompensatingEvent,
  ConnectorSagaFailedEvent,
} from "./connectorEventBus";
export { connectorLifecycle, ConnectorLifecycleManager } from "./connectorLifecycle";
export type { ConnectorHealthSnapshot, ConnectorHealthStatus, CircuitState } from "./connectorLifecycle";
export { credentialRotation, CredentialRotationScheduler } from "./credentialRotation";
export type { CredentialRotationPolicy, RotationStatus, RotationMetrics } from "./credentialRotation";
export { credentialHealthMonitor, CredentialHealthMonitor } from "./credentialHealthMonitor";
export type { CredentialHealthReport, AnomalyReport } from "./credentialHealthMonitor";
export { sanitizeConnectorInput, sanitizeConnectorOutput, createSanitizationConfig } from "./inputSanitizer";
export type { SanitizationConfig, SanitizationReport, SanitizationWarning, SanitizedOutput, RedactionEntry } from "./inputSanitizer";
export { scopeValidator, ScopeValidator, escalationDetector, ScopeEscalationDetector, riskAssessor, OperationRiskAssessor } from "./scopeValidator";
export type { ScopeValidationResult, EscalationResult, RiskAssessment, RiskFactor, RiskLevel } from "./scopeValidator";
export { connectorFirewall, ConnectorFirewall, RequestLogger } from "./connectorFirewall";
export type { UrlValidationResult, DomainValidationResult, RequestLogEntry } from "./connectorFirewall";
export {
  ConnectorMiddlewarePipeline,
  connectorPipeline,
  createDefaultPipeline,
  createTimingMiddleware,
  createAbortCheckMiddleware,
  createInputValidationMiddleware,
  createInputSizeLimiterMiddleware,
  createConfirmationMiddleware,
  createOutputSizeLimiterMiddleware,
  createLoggingMiddleware,
} from "./connectorMiddlewarePipeline";
export type { MiddlewareContext, ConnectorMiddlewareFn, MiddlewareDescriptor } from "./connectorMiddlewarePipeline";
export { connectorWebhookProcessor, ConnectorWebhookProcessor } from "./connectorWebhookProcessor";
export type { WebhookConfig, WebhookEvent, WebhookHandler } from "./connectorWebhookProcessor";
export { connectorVersionManager, ConnectorVersionManager } from "./connectorVersionManager";
export type { ConnectorVersion, VersionDiff, CapabilityDiff, BreakingChange, CanaryConfig } from "./connectorVersionManager";
export { connectorDependencyResolver, ConnectorDependencyResolver } from "./connectorDependencyResolver";
export type { OperationNode, WorkflowPlan, ExecutionLevel, NodeResult, WorkflowResult } from "./connectorDependencyResolver";
export { connectorDataTransformer, ConnectorDataTransformer, BUILT_IN_PIPELINES } from "./connectorDataTransformer";
export type { FieldMapping, TransformFunction, TransformPipeline, TransformResult } from "./connectorDataTransformer";
export { rateLimitGovernor, RateLimitGovernor } from "./rateLimitGovernor";
export type { RateLimitTier, CheckLimitResult, UsageSummary, GlobalUsageSummary, QuotaReservation } from "./rateLimitGovernor";
export { connectorCostTracker, ConnectorCostTracker } from "./connectorCostTracker";
export type { CostEstimate, BudgetCheck, UserBudget, SpendEntry, CostRecord } from "./connectorCostTracker";
export { connectorAuditEnricher, ConnectorAuditEnricher } from "./connectorAuditEnricher";
export type { ConnectorAuditEntry, AuditQueryFilters, ComplianceSummary } from "./connectorAuditEnricher";
export { connectorComplianceEngine, ConnectorComplianceEngine } from "./connectorComplianceEngine";
export type { CompliancePolicy, ComplianceRule, ComplianceContext, EvaluationResult as ComplianceEvaluationResult, ComplianceReport } from "./connectorComplianceEngine";
export { metricsDashboard, DashboardDataProvider, ConnectorMetricsCollector, CircuitBreakerDashboard, LatencyHeatmap, ThroughputTracker, ErrorClassifier } from "./connectorMetricsDashboard";
export type {
  MetricsWindow,
  CircuitState as MetricsCircuitState,
  ErrorType,
  AlertSeverity,
  OperationRecord,
  ConnectorMetricsSnapshot,
  OperationMetricsSnapshot,
  SystemMetricsSnapshot,
  CircuitStateSnapshot,
  CircuitTransition,
  SystemCircuitStatus,
  HeatmapRow,
  LatencyPercentiles,
  ThroughputSnapshot,
  ThroughputHistoryEntry,
  ErrorBreakdownEntry,
  ErrorTrendEntry,
  ErrorRecord,
  AnomalyEntry,
  DashboardAlert,
  FullDashboard,
  ConnectorDetail,
} from "./connectorMetricsDashboard";
export { secretScannerManager, SecretScannerManager, SecretScanner, CredentialLeakDetector, EntropyAnalyzer, SecretRotationAdvisor } from "./connectorSecretScanner";
export type {
  Severity,
  SecretPattern,
  ScanResult,
  LeakEvent,
  LeakReport,
  LeakStats,
  EntropyResult,
  HighEntropyFinding,
  RotationAdvice,
  RotationUrgency,
  CredentialRotationStatus,
  RotationReport as SecretRotationReport,
  ComprehensiveScanReport,
  TopVulnerability,
} from "./connectorSecretScanner";
export { executionOptimizer, ExecutionOptimizer, QueryPlanner, QueryCache, BatchOptimizer, RequestDeduplicator } from "./connectorQueryPlanner";
export type {
  QueryStep,
  QueryPlan,
  StepResult,
  QueryPlanResult,
  CostEstimation,
  CacheStats,
  ConnectorCacheStats,
  BatchGroup,
  BatchResult,
  DeduplicationStats,
} from "./connectorQueryPlanner";
export { schemaValidator, SchemaValidator, contractTestRunner, ContractTestRunner, schemaEvolutionTracker, SchemaEvolutionTracker, responseShapeGuard, ResponseShapeGuard } from "./connectorSchemaValidator";
export type { ValidationError, ValidationResult, ContractTest, ContractTestResult, SchemaChange, ResponseShapeReport } from "./connectorSchemaValidator";
export {
  degradationOrchestrator, DegradationOrchestrator,
  sloTracker, ServiceLevelObjectiveTracker,
  fallbackChainManager, FallbackChainManager,
  staleWhileRevalidateCache, StaleWhileRevalidate,
  DEFAULT_SLOS, DEFAULT_FALLBACK_CHAINS,
} from "./connectorGracefulDegradation";
export type {
  FallbackStep, FallbackChain, FallbackExecutionResult,
  StaleEntry, SLODefinition, SLOStatus,
  DegradationLevel, DegradationStatus,
} from "./connectorGracefulDegradation";
export {
  circuitBreakerRegistry, ConnectorCircuitBreakerRegistry,
  withCircuitBreaker, CB_PRESETS, DEFAULT_CB_CONFIG,
} from "./connectorCircuitBreaker";
export type {
  CBState, CircuitBreakerConfig, CallOutcome, CircuitBreakerSnapshot,
  StateTransition, CircuitBreakerDecision,
} from "./connectorCircuitBreaker";
export {
  correlationManager, CorrelationManager,
  SpanBuilder, TraceStore, CorrelationEngine,
  CorrelationAnomalyDetector, TimelineGenerator,
} from "./connectorCorrelationEngine";
export type {
  TraceContext, SpanEvent, Span, Trace,
  CorrelationLink, TimelineEntry, AnomalyDetection, CorrelationSummary,
} from "./connectorCorrelationEngine";
export {
  capabilityRegistry, CapabilityRegistry,
  versionNegotiator, VersionNegotiator,
  planGatekeeper, PlanGatekeeper,
  capabilityRouter, CapabilityRouter,
  DEFAULT_PLANS,
} from "./connectorCapabilityNegotiator";
export type {
  CapabilityStatus, CapabilityInfo, CapabilityProbe,
  NegotiationResult, CompatibilityMatrix, CapabilityDiff as NegotiatorCapabilityDiff,
  PlanTier, FeatureGate,
} from "./connectorCapabilityNegotiator";
export {
  dedupManager, DedupManager,
  ConnectorSmartCache, InFlightDeduplicator, RequestCoalescer,
  RequestFingerprinter, DEFAULT_CACHE_CONFIG, DEFAULT_FINGERPRINT_CONFIG,
} from "./connectorRequestDedup";
export type {
  CacheEntry, CacheConfig, CacheStats as DedupCacheStats,
  DedupStats, CoalesceWindow, FingerprintConfig,
} from "./connectorRequestDedup";
export {
  retryBudgetTracker, RetryBudgetTracker,
  adaptiveRetryPolicy, AdaptiveRetryPolicy,
  retryableExecutor, RetryableOperationExecutor,
  retryAnalytics, RetryAnalytics,
  CONSERVATIVE_RETRY, AGGRESSIVE_RETRY, INSTANT_RETRY, NO_RETRY,
  setConnectorRetryOverride, clearConnectorRetryOverride, resolveConfig,
} from "./connectorRetryBudget";
export type {
  RetryBudgetConfig, RetryAttempt, RetryBudgetStatus, RetryDecision,
  RetryOutcome, RetryOutcomeWithResult, RetryProgressEvent,
  RetryTrendPoint, RetryHeatmapCell, MostRetriedOperation, RetryAnomaly,
} from "./connectorRetryBudget";
export {
  configStore, ConnectorConfigStore,
  configWatcher, ConfigWatcher,
  configVersionControl, ConfigVersionControl,
  featureFlagManager, FeatureFlagManager,
  configEnvironmentResolver, ConfigEnvironmentResolver,
  configMigrator, ConfigMigrator,
  configHealthChecker, ConfigHealthChecker,
} from "./connectorConfigHotReload";
export type {
  ConfigFieldType, ConfigField, ConnectorConfigSchema,
  ConfigChangeEvent, ConfigValidationResult, ConfigSnapshot,
  FeatureFlagEntry, FeatureFlagChange, ConfigHealthReport,
} from "./connectorConfigHotReload";
export {
  KernelContainer, ContainerBuilder, ServiceGraph,
  ServiceLocator, InterceptorChain, createKernelContainer,
} from "./connectorDiContainer";
export type {
  ServiceLifecycle, ServiceDescriptor, ServiceState, ServiceInstance,
  ContainerScope, ServiceHealthReport as DiServiceHealthReport,
  ContainerDiagnostics, InitializationTraceEntry,
  ServiceInterceptor, HealthCheckFn, ServiceRegistrationOptions,
} from "./connectorDiContainer";
export {
  connectorLoadBalancer, ConnectorLoadBalancer,
  regionalAffinityRouter, RegionalAffinityRouter,
  DEFAULT_LB_CONFIG,
} from "./connectorLoadBalancer";
export type {
  LBStrategy, InstanceStatus, ConnectorInstance, LBConfig,
  LBDecision, LBStats, LatencyRecord,
} from "./connectorLoadBalancer";
export {
  adaptiveThrottler, ConnectorAdaptiveThrottler,
  parseRetryAfterHeader, DEFAULT_THROTTLE_CONFIG,
} from "./connectorAdaptiveThrottler";
export type {
  ThrottleConfig, ThrottleDecision, ThrottleState,
  BackpressureSignal, UserFairness,
} from "./connectorAdaptiveThrottler";
export {
  healthAggregator, HealthAggregator,
  healthCheckScheduler, HealthCheckScheduler,
  slaEngine, SlaEngine,
  healthReporter, HealthReporter,
  healthEndpointBuilder, HealthEndpointBuilder,
} from "./connectorHealthAggregator";
export type {
  CheckType, HealthStatus, HealthTrend, HealthEventType,
  HealthCheck as HAHealthCheck, HealthPolicy, AggregatedHealth,
  SlaDefinition, SlaStatus, SlaViolation, HealthEvent,
  SystemHealth, HealthReport, IncidentEntry, HealthRecommendation,
  DependencyImpact, LivenessResponse, ReadinessResponse, DetailedHealthResponse,
} from "./connectorHealthAggregator";
export {
  eventStore, EventStore,
  snapshotStore, SnapshotStore,
  eventReplayEngine, EventReplayEngine,
  projectionManager, ProjectionManager,
  eventBusIntegration, EventBusIntegration,
  eventCompaction, EventCompaction,
  connectorEventSourcingFacade, ConnectorEventSourcingFacade,
  CONNECTOR_OPERATION_STARTED, CONNECTOR_OPERATION_COMPLETED, CONNECTOR_OPERATION_FAILED,
  CONNECTOR_CREDENTIAL_REFRESHED, CONNECTOR_CREDENTIAL_REVOKED,
  CONNECTOR_CIRCUIT_OPENED, CONNECTOR_CIRCUIT_CLOSED,
  CONNECTOR_CONFIG_CHANGED, CONNECTOR_RATE_LIMITED,
  CONNECTOR_SLA_VIOLATED, CONNECTOR_HEALTH_CHANGED,
} from "./connectorEventSourcing";
export type {
  ConnectorDomainEvent, EventStream, Snapshot, EventFilter,
  ReplayResult, ProjectionDefinition, ProjectionState, EventSubscription,
  ReplayOptions, ReplayResultWithState, StateDiff,
  CompactionResult, CompactAllResult,
} from "./connectorEventSourcing";
