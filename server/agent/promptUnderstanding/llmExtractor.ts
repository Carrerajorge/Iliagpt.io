/**
 * LLM Extractor Module
 * 
 * Uses Grok API to intelligently extract UserSpec from user prompts.
 * Falls back to heuristic extraction if LLM fails.
 */

import { UserSpec, UserSpecSchema, RiskSpec, ConstraintSpec, TaskSpec } from "./types";
import { TextBlock } from "./lexer";
import { randomUUID } from "crypto";

// Lazy import of OpenAI to avoid initialization errors in test environments
let _openai: any = null;
let _MODELS: any = null;

async function getOpenAI() {
    if (!_openai) {
        try {
            // @ts-ignore
            const lib = await import("../../lib/openai");
            _openai = lib.openai;
            _MODELS = lib.MODELS;
        } catch (e) {
            console.warn("[LLMExtractor] OpenAI initialization failed:", e);
            return null;
        }
    }
    return _openai;
}

async function getMODELS() {
    if (!_MODELS) {
        await getOpenAI();
    }
    return _MODELS;
}

const EXTRACTION_PROMPT = `You are an AI assistant that extracts structured information from user requests.

Given a user message, extract a JSON object with these fields:
- goal: string (the main objective)
- tasks: array of {verb: string, object: string} (action items)
- constraints: array of {type: "format"|"language"|"style"|"length"|"source"|"time"|"security"|"other", value: string, isHardConstraint: boolean}
- risks: array of {type: "ambiguity"|"contradiction"|"security"|"privacy"|"resource"|"ethical", description: string, severity: "low"|"medium"|"high"|"critical", requiresConfirmation: boolean}
- missing_inputs: array of strings (data needed but not provided)
- success_criteria: array of strings (how to know the task is done well)
- assumptions: array of strings (reasonable assumptions made)
- questions: array of strings (critical clarifications needed)
- confidence: number 0.0-1.0 (how confident you are in this extraction)

Rules:
- Detect destructive actions (delete, remove, overwrite) as security risks requiring confirmation
- Detect ambiguous pronouns ("it", "that") as missing_inputs if unclear
- Detect format requirements (JSON, PDF, etc.) as constraints
- Detect language requirements as constraints
- If instructions conflict, add to risks with type "contradiction"
- Return ONLY valid JSON, no markdown, no explanation

User message:
`;

export interface LLMExtractionResult {
    spec: UserSpec;
    usedLLM: boolean;
    error?: string;
    rawResponse?: string;
}

export class LLMExtractor {
    private fallbackExtractor: HeuristicExtractor;

    constructor() {
        this.fallbackExtractor = new HeuristicExtractor();
    }

    async extractWithLLM(text: string): Promise<LLMExtractionResult> {
        const openai = await getOpenAI();
        const MODELS = await getMODELS();

        if (!openai) {
            console.warn("[LLMExtractor] OpenAI not available, using fallback");
            return {
                spec: this.fallbackExtractor.extractFromText(text),
                usedLLM: false,
                error: "OpenAI not configured"
            };
        }

        // AGGRESSIVE PROMPT ENGINEERING FOR ZERO-FAILURE ORCHESTRATION
        // Forces explicit detection of Multi-Format, exact entities, and tool chains
        const AGGRESSIVE_EXTRACTION_PROMPT = `You are an elite intent extraction engine for a SuperAgent system.
 Your job is to extract highly structured execution specifications from user prompts with 100% precision.

CRITICAL RULES:
1. DETECT MULTIPLE FORMATS: If user asks for "Word AND Excel", you MUST extract TWO separate tasks or constraints for each format.
2. EXTRACT EXACT ENTITIES: "30 articles", "2020-2024", "citations > 50" must be extracted as specific query constraints.
3. DETECT IMPLICIT TOOLS: "Research X and create Y" implies a search tool followed by a generation tool.
4. DETECT DEPENDENCIES: Document generation ALWAYS depends on search results.

OUTPUT JSON FORMAT:
{
  "goal": "string (high level objective)",
  "tasks": [
    {
      "id": "task_1",
      "verb": "SEARCH_ACADEMIC" | "SEARCH_WEB" | "CREATE_DOCUMENT" | "CREATE_SPREADSHEET" | "CREATE_PRESENTATION" | "ANALYZE" | "TRANSLATE",
      "object": "string (what to act on)",
      "tool_hints": ["string (suggested tool name)"],
      "params": [{"name": "string", "value": "string"}],
      "dependencies": ["task_id"]
    }
  ],
  "constraints": [
    {
      "type": "FORMAT" | "QUANTITY" | "TIME_RANGE" | "LANGUAGE" | "STYLE" | "TOOL_REQUIRED",
      "value": "string",
      "isHardConstraint": boolean
    }
  ],
  "risks": [],
  "missing_inputs": [],
  "confidence": number
}

EXAMPLES:
Input: "Busca 30 papers sobre IA (2020-2024) y crea un Excel con los datos y un Word con resúmenes"
Output:
{
  "goal": "Research AI papers and generate multi-format reports",
  "tasks": [
    {
      "id": "t1",
      "verb": "SEARCH_ACADEMIC",
      "object": "papers sobre IA",
      "params": [{"name": "query", "value": "inteligencia artificial"}, {"name": "limit", "value": "30"}, {"name": "year_start", "value": "2020"}, {"name": "year_end", "value": "2024"}],
      "tool_hints": ["academic_search"]
    },
    {
      "id": "t2",
      "verb": "CREATE_SPREADSHEET",
      "object": "Excel con datos",
      "params": [{"name": "format", "value": "xlsx"}, {"name": "columns", "value": "auto"}],
      "dependencies": ["t1"],
      "tool_hints": ["excel_generator"]
    },
    {
      "id": "t3",
      "verb": "CREATE_DOCUMENT",
      "object": "Word con resúmenes",
      "params": [{"name": "format", "value": "docx"}, {"name": "content", "value": "resúmenes ejecutivos"}],
      "dependencies": ["t1"],
      "tool_hints": ["word_generator"]
    }
  ],
  "constraints": [
    {"type": "QUANTITY", "value": "30", "isHardConstraint": true},
    {"type": "TIME_RANGE", "value": "2020-2024", "isHardConstraint": true},
    {"type": "FORMAT", "value": "xlsx", "isHardConstraint": true},
    {"type": "FORMAT", "value": "docx", "isHardConstraint": true}
  ]
}`;

        try {
            console.log("[LLMExtractor] Sending aggressive extraction request...");
            const response = await openai.chat.completions.create({
                model: MODELS.TEXT, // Uses strongest available model
                messages: [
                    { role: "system", content: AGGRESSIVE_EXTRACTION_PROMPT },
                    { role: "user", content: text }
                ],
                temperature: 0.0, // Zero temperature for maximum determinism
                max_tokens: 3000,
                response_format: { type: "json_object" }
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error("Empty response from LLM");
            }

            const parsed = JSON.parse(content);
            console.log("[LLMExtractor] Parsed aggressive spec:", JSON.stringify(parsed, null, 2));

            // Normalize and validates the aggressive output into standard UserSpec
            const normalizedTasks: TaskSpec[] = (parsed.tasks || []).map((t: any) => ({
                id: t.id || `task_${randomUUID().substring(0, 4)}`,
                verb: t.verb || "unknown",
                object: t.object || "",
                params: t.params || [],
                dependencies: t.dependencies || []
            }));

            const normalizedConstraints: ConstraintSpec[] = (parsed.constraints || []).map((c: any) => ({
                type: (c.type || "other").toLowerCase(),
                value: c.value || "",
                isHardConstraint: c.isHardConstraint ?? true
            }));

            const spec: UserSpec = {
                goal: parsed.goal || text.substring(0, 50),
                tasks: normalizedTasks,
                inputs_provided: {},
                missing_inputs: parsed.missing_inputs || [],
                constraints: normalizedConstraints,
                success_criteria: parsed.success_criteria || [],
                assumptions: [],
                risks: parsed.risks || [],
                questions: [],
                confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.95
            };

            return {
                spec,
                usedLLM: true,
                rawResponse: content
            };

        } catch (error) {
            console.error("[LLMExtractor] Aggressive extraction failed, falling back:", error);
            return {
                spec: this.fallbackExtractor.extractFromText(text),
                usedLLM: false,
                error: (error as Error).message
            };
        }
    }

    extractWithHeuristics(text: string): UserSpec {
        return this.fallbackExtractor.extractFromText(text);
    }
}

/**
 * Heuristic Extractor (Fallback)
 * Fast, deterministic extraction using pattern matching.
 */
class HeuristicExtractor {
    extractFromText(text: string): UserSpec {
        const lowerText = text.toLowerCase();
        const spec: UserSpec = {
            goal: text.split(/[.!?]/)[0]?.trim() || text.substring(0, 100),
            tasks: [],
            inputs_provided: {},
            missing_inputs: [],
            constraints: [],
            success_criteria: [],
            assumptions: [],
            risks: [],
            questions: [],
            confidence: 0.4 // Lower confidence for heuristics
        };

        // Extract tasks from verbs (English + Spanish)
        const verbs = [
            // English - common actions
            "create", "generate", "write", "update", "delete", "remove", "search", "find", "analyze", "send", "fetch", "build", "deploy",
            // English - data operations
            "download", "upload", "import", "export", "migrate", "backup", "restore", "sync",
            // English - processing
            "clean", "normalize", "train", "evaluate", "calculate", "validate", "transform", "process",
            // English - documents
            "draft", "summarize", "translate", "compile", "format", "extract", "parse",
            // Spanish  
            "crear", "generar", "genera", "escribir", "actualizar", "borrar", "eliminar", "buscar", "busca", "analizar", "enviar", "construir", "descargar", "limpiar"
        ];
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);

        for (const sentence of sentences) {
            const lowerSentence = sentence.toLowerCase();
            for (const verb of verbs) {
                if (lowerSentence.includes(verb)) {
                    spec.tasks.push({
                        id: randomUUID(),
                        verb,
                        object: sentence.trim(),
                        params: [],
                        dependencies: []
                    });
                    break; // One task per sentence
                }
            }
        }

        // Detect constraints
        if (lowerText.includes("json")) spec.constraints.push({ type: "format", value: "JSON", isHardConstraint: true });
        if (lowerText.includes("pdf")) spec.constraints.push({ type: "format", value: "PDF", isHardConstraint: true });
        if (lowerText.includes("markdown") || lowerText.includes("md")) spec.constraints.push({ type: "format", value: "Markdown", isHardConstraint: true });
        if (lowerText.includes("english") || lowerText.includes("inglés")) spec.constraints.push({ type: "language", value: "English", isHardConstraint: true });
        if (lowerText.includes("spanish") || lowerText.includes("español")) spec.constraints.push({ type: "language", value: "Spanish", isHardConstraint: true });

        // Detect risks (English + Spanish + Shell commands)
        const riskyVerbs = [
            // English destructive
            "delete", "remove", "drop", "truncate", "overwrite", "erase", "wipe", "purge", "destroy",
            // Spanish destructive
            "borrar", "eliminar", "elimina", "borra",
            // Shell commands
            "rm ", "rm -", "sudo", "chmod", "chown", "kill", "format", "mkfs", "fdisk"
        ];
        for (const verb of riskyVerbs) {
            if (lowerText.includes(verb)) {
                spec.risks.push({
                    type: "security",
                    description: `Destructive action detected: ${verb}`,
                    severity: "high",
                    requiresConfirmation: true
                });
                break;
            }
        }

        // Detect ambiguity
        const ambiguousPronouns = ["it", "that", "this", "these", "those"];
        for (const pronoun of ambiguousPronouns) {
            const regex = new RegExp(`\\b${pronoun}\\b`, "i");
            if (regex.test(text) && text.length < 50) {
                spec.risks.push({
                    type: "ambiguity",
                    description: `Ambiguous reference: "${pronoun}" - context unclear`,
                    severity: "medium",
                    requiresConfirmation: false
                });
                spec.missing_inputs.push(`Clarification for "${pronoun}"`);
                break;
            }
        }

        return spec;
    }
}

export { HeuristicExtractor };
