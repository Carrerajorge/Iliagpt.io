import { z } from "zod";
import { randomUUID } from "crypto";
import {
  AgentContract,
  AgentContractSchema,
  IntentType,
  Requirements,
  PlanStep,
  ToolCall,
  AcceptanceCheck,
} from "./contracts";
import { shouldResearch, extractSourceRequirement, extractSearchQueries } from "./researchPolicy";

interface RouterConfig {
  maxRetries: number;
  defaultLanguage: string;
  enforceMinSources: boolean;
}

const DEFAULT_CONFIG: RouterConfig = {
  maxRetries: 2,
  defaultLanguage: "es",
  enforceMinSources: true,
};

const DOCUMENT_PATTERNS = {
  xlsx: [
    /\b(excel|xlsx|spreadsheet|hoja de cálculo|planilla)\b/i,
    /\b(crear|create|genera|generate)\s+.*(excel|xlsx|spreadsheet)\b/i,
  ],
  docx: [
    /\b(word|docx|documento|document)\b/i,
    /\b(crear|create|genera|generate)\s+.*(word|docx|documento)\b/i,
  ],
  pptx: [
    /\b(powerpoint|pptx|presentación|presentation|slides?|diapositivas?)\b/i,
  ],
};

function detectDocumentTypes(prompt: string): Array<"docx" | "xlsx" | "pptx"> {
  const types: Array<"docx" | "xlsx" | "pptx"> = [];
  
  for (const [type, patterns] of Object.entries(DOCUMENT_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(prompt)) {
        types.push(type as "docx" | "xlsx" | "pptx");
        break;
      }
    }
  }
  
  return types;
}

function detectIntent(prompt: string): IntentType {
  const researchDecision = shouldResearch(prompt);
  const docTypes = detectDocumentTypes(prompt);
  
  if (docTypes.length > 0 && researchDecision.shouldResearch) {
    return "mixed";
  }
  
  if (docTypes.includes("xlsx")) {
    return "create_xlsx";
  }
  
  if (docTypes.includes("docx")) {
    return "create_docx";
  }
  
  if (researchDecision.shouldResearch) {
    return "research";
  }
  
  return "answer";
}

function detectLanguage(prompt: string): string {
  const spanishPatterns = /\b(el|la|los|las|de|en|que|es|un|una|para|con|por|como|más|se|su|qué|cómo|dónde|cuándo)\b/gi;
  const englishPatterns = /\b(the|is|are|was|were|have|has|had|will|would|can|could|should|this|that|these|those|with|from|for|but|and|or)\b/gi;
  
  const spanishCount = (prompt.match(spanishPatterns) || []).length;
  const englishCount = (prompt.match(englishPatterns) || []).length;
  
  return spanishCount >= englishCount ? "es" : "en";
}

function extractEntities(prompt: string): string[] {
  const entities: string[] = [];
  
  const quotedMatches = prompt.match(/"([^"]+)"|'([^']+)'/g);
  if (quotedMatches) {
    quotedMatches.forEach(match => {
      entities.push(match.replace(/['"]/g, ''));
    });
  }
  
  const properNouns = prompt.match(/\b[A-Z][a-záéíóúñ]+(?:\s+[A-Z][a-záéíóúñ]+)*/g);
  if (properNouns) {
    entities.push(...properNouns.filter(n => n.length > 2));
  }
  
  return [...new Set(entities)].slice(0, 10);
}

function buildPlan(intent: IntentType, requirements: Requirements, queries: string[]): PlanStep[] {
  const steps: PlanStep[] = [];
  
  if (requirements.min_sources > 0 || intent === "research" || intent === "mixed") {
    steps.push({
      id: "signals",
      action: `Gather ${requirements.min_sources || 100} source signals`,
      tool: "search_web_parallel",
      input: { queries, max_results_per_query: Math.ceil((requirements.min_sources || 100) / queries.length) },
      depends_on: [],
      status: "pending",
    });
    
    steps.push({
      id: "deep_dive",
      action: "Deep fetch top 10-20 sources for content extraction",
      tool: "fetch_url_parallel",
      input: { max_sources: 20 },
      depends_on: ["signals"],
      status: "pending",
    });
  }
  
  if (requirements.must_create.includes("xlsx") || intent === "create_xlsx") {
    steps.push({
      id: "create_xlsx",
      action: "Generate Excel document",
      tool: "create_xlsx",
      input: {},
      depends_on: requirements.min_sources > 0 ? ["deep_dive"] : [],
      status: "pending",
    });
  }
  
  if (requirements.must_create.includes("docx") || intent === "create_docx") {
    steps.push({
      id: "create_docx",
      action: "Generate Word document",
      tool: "create_docx",
      input: {},
      depends_on: requirements.min_sources > 0 ? ["deep_dive"] : [],
      status: "pending",
    });
  }
  
  steps.push({
    id: "quality_gate",
    action: "Verify all requirements met",
    tool: "quality_gate",
    input: {},
    depends_on: steps.map(s => s.id).filter(id => id !== "quality_gate"),
    status: "pending",
  });
  
  steps.push({
    id: "finalize",
    action: "Generate final response",
    tool: "finalize",
    input: {},
    depends_on: ["quality_gate"],
    status: "pending",
  });
  
  return steps;
}

function buildToolCalls(plan: PlanStep[], requirements: Requirements, queries: string[]): ToolCall[] {
  const calls: ToolCall[] = [];
  
  for (const step of plan) {
    if (step.tool && step.tool !== "finalize") {
      calls.push({
        id: `tc_${step.id}`,
        tool: step.tool,
        input: step.input || {},
        phase: step.tool.includes("search") ? "signals" : 
               step.tool.includes("fetch") ? "deep" :
               step.tool.includes("create") ? "create" : "verify",
      });
    }
  }
  
  return calls;
}

function buildAcceptanceChecks(requirements: Requirements, intent: IntentType): AcceptanceCheck[] {
  const checks: AcceptanceCheck[] = [];
  
  if (requirements.min_sources > 0) {
    checks.push({
      id: "check_sources",
      condition: `sources_count >= ${requirements.min_sources}`,
      threshold: requirements.min_sources,
      required: true,
    });
  }
  
  for (const docType of requirements.must_create) {
    checks.push({
      id: `check_${docType}`,
      condition: `artifact_exists(${docType})`,
      required: true,
    });
  }
  
  if (requirements.verify_facts) {
    checks.push({
      id: "check_facts_verified",
      condition: "all_claims_verified",
      required: true,
    });
  }
  
  checks.push({
    id: "check_response",
    condition: "final_response_exists",
    required: true,
  });
  
  return checks;
}

export function parsePromptToContract(
  prompt: string,
  config: Partial<RouterConfig> = {}
): AgentContract {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  const intent = detectIntent(prompt);
  const language = detectLanguage(prompt);
  const entities = extractEntities(prompt);
  const researchDecision = shouldResearch(prompt);
  const docTypes = detectDocumentTypes(prompt);
  
  const requirements: Requirements = {
    min_sources: researchDecision.minSources,
    must_create: docTypes,
    language,
    verify_facts: /\b(verificar?|validar?|confirmar?|verify|validate|confirm)\b/i.test(prompt),
    include_citations: researchDecision.shouldResearch,
    max_depth: researchDecision.researchType === "both" ? 5 : 3,
  };
  
  if (cfg.enforceMinSources && researchDecision.shouldResearch && requirements.min_sources === 0) {
    requirements.min_sources = 10;
  }
  
  const queries = researchDecision.searchQueries.length > 0 
    ? researchDecision.searchQueries 
    : [prompt.substring(0, 100)];
  
  const plan = buildPlan(intent, requirements, queries);
  const toolCalls = buildToolCalls(plan, requirements, queries);
  const acceptanceChecks = buildAcceptanceChecks(requirements, intent);
  
  const contract: AgentContract = {
    contract_id: randomUUID(),
    timestamp: Date.now(),
    intent,
    requirements,
    plan,
    tool_calls: toolCalls,
    acceptance_checks: acceptanceChecks,
    original_prompt: prompt,
    parsed_entities: entities,
    language_detected: language,
  };
  
  return AgentContractSchema.parse(contract);
}

export function validateContract(contract: AgentContract): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (contract.requirements.min_sources > 0 && contract.plan.every(s => s.tool !== "search_web_parallel")) {
    errors.push("Contract requires sources but no search step in plan");
  }
  
  for (const docType of contract.requirements.must_create) {
    if (!contract.plan.some(s => s.tool === `create_${docType}`)) {
      errors.push(`Contract requires ${docType} but no creation step in plan`);
    }
  }
  
  if (!contract.plan.some(s => s.tool === "quality_gate")) {
    errors.push("Contract missing quality_gate step");
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function repairContract(contract: AgentContract): AgentContract {
  const validation = validateContract(contract);
  
  if (validation.valid) {
    return contract;
  }
  
  const repairedPlan = [...contract.plan];
  const repairedToolCalls = [...contract.tool_calls];
  
  if (contract.requirements.min_sources > 0 && !repairedPlan.some(s => s.tool === "search_web_parallel")) {
    repairedPlan.unshift({
      id: "signals",
      action: `Gather ${contract.requirements.min_sources} source signals`,
      tool: "search_web_parallel",
      input: { queries: extractSearchQueries(contract.original_prompt) },
      depends_on: [],
      status: "pending",
    });
    
    repairedToolCalls.unshift({
      id: "tc_signals",
      tool: "search_web_parallel",
      input: { queries: extractSearchQueries(contract.original_prompt) },
      phase: "signals",
    });
  }
  
  for (const docType of contract.requirements.must_create) {
    if (!repairedPlan.some(s => s.tool === `create_${docType}`)) {
      repairedPlan.push({
        id: `create_${docType}`,
        action: `Generate ${docType.toUpperCase()} document`,
        tool: `create_${docType}`,
        input: {},
        depends_on: [],
        status: "pending",
      });
      
      repairedToolCalls.push({
        id: `tc_create_${docType}`,
        tool: `create_${docType}`,
        input: {},
        phase: "create",
      });
    }
  }
  
  return {
    ...contract,
    plan: repairedPlan,
    tool_calls: repairedToolCalls,
  };
}
