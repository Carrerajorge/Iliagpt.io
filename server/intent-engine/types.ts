export type IntentType =
  | 'CONSTRAINED_REWRITE'
  | 'TITLE_IDEATION'
  | 'OUTLINE'
  | 'SUMMARIZE'
  | 'EXPLAIN'
  | 'TRANSLATE'
  | 'CODE_GENERATION'
  | 'DATA_ANALYSIS'
  | 'RESEARCH'
  | 'ACADEMIC_SEARCH'
  | 'CITATION_FORMAT'
  | 'COMPARISON'
  | 'CREATIVE_WRITING'
  | 'FACT_CHECK'
  | 'GENERAL_CHAT';

export type TaskDomain =
  | 'marketing'
  | 'academic'
  | 'business'
  | 'technology'
  | 'legal'
  | 'medical'
  | 'education'
  | 'creative'
  | 'general';

export interface NormalizedInput {
  originalText: string;
  cleanedText: string;
  language: string;
  entities: ExtractedEntities;
  metadata: InputMetadata;
}

export interface ExtractedEntities {
  topic: string | null;
  domain: TaskDomain;
  quantity: number | null;
  prohibitions: string[];
  fixedParts: string[];
  keywords: string[];
}

export interface InputMetadata {
  hasEmojis: boolean;
  hasUrls: boolean;
  wordCount: number;
  sentenceCount: number;
  isQuestion: boolean;
  urgencyLevel: 'low' | 'medium' | 'high';
}

export interface IntentClassification {
  intent: IntentType;
  confidence: number;
  subIntent?: string;
  matchedRules: string[];
}

export interface Constraints {
  domain: TaskDomain;
  task: IntentType;
  n: number | null;
  mustKeep: string[];
  mustNotUse: string[];
  editableParts: string[];
  tone: ToneType;
  language: string;
  format: OutputFormat;
  maxLength?: number;
  minLength?: number;
  citationStyle?: 'apa7' | 'apa6' | 'mla' | 'chicago' | 'vancouver' | 'ieee' | 'harvard' | 'iso690';
  citationEdition?: string;
  academicDepth?: 'surface' | 'standard' | 'deep';
}

export type ToneType =
  | 'formal'
  | 'informal'
  | 'academic'
  | 'professional'
  | 'creative'
  | 'neutral';

export type OutputFormat =
  | 'text'
  | 'json'
  | 'markdown'
  | 'list'
  | 'table'
  | 'structured';

export interface ResolverResult<T = unknown> {
  success: boolean;
  data: T;
  rawOutput?: string;
  tokensUsed: number;
  latencyMs: number;
}

export interface StructuredOutput {
  type: 'titles' | 'outline' | 'summary' | 'content' | 'list' | 'analysis';
  items?: string[];
  content?: string;
  sections?: OutlineSection[];
  metadata?: Record<string, unknown>;
}

export interface OutlineSection {
  title: string;
  level: number;
  subsections?: OutlineSection[];
}

export interface QualityCheckResult {
  passed: boolean;
  checks: QualityCheck[];
  failedChecks: string[];
  score: number;
}

export interface QualityCheck {
  name: string;
  passed: boolean;
  message?: string;
  severity: 'error' | 'warning' | 'info';
}

export interface RepairAttempt {
  attemptNumber: number;
  failedChecks: string[];
  repairStrategy: string;
  success: boolean;
  result?: StructuredOutput;
}

export interface SessionState {
  sessionId: string;
  userId: string;
  domain: TaskDomain;
  constraints: Constraints;
  history: ConversationTurn[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  intent?: IntentType;
  timestamp: Date;
}

export interface PipelineContext {
  sessionState: SessionState;
  normalizedInput: NormalizedInput;
  intentClassification: IntentClassification;
  constraints: Constraints;
  resolverResult?: ResolverResult;
  qualityResult?: QualityCheckResult;
  repairAttempts: RepairAttempt[];
  finalOutput?: StructuredOutput;
}

export interface IntentRule {
  id: string;
  keywords: string[];
  patterns: RegExp[];
  intent: IntentType;
  priority: number;
}

export interface ResolverConfig {
  maxRetries: number;
  temperature: number;
  maxTokens: number;
  model: string;
}
