
import { openai, MODELS } from "../lib/openai";
import { llmGateway } from "../lib/llmGateway";
import { geminiChat, geminiStreamChat, GEMINI_MODELS, GeminiChatMessage } from "../lib/gemini";
import { LIMITS, MEMORY_INTENT_KEYWORDS } from "../lib/constants";
import {
  DEFAULT_TEXT_MODEL as REGISTRY_DEFAULT_MODEL,
  DEFAULT_PROVIDER as REGISTRY_DEFAULT_PROVIDER,
} from "../lib/modelRegistry";
import { storage } from "../storage";
import { generateEmbedding } from "../embeddingService";
import { searchWeb, searchScholar, needsWebSearch, needsAcademicSearch } from "./webSearch";
import { routeMessage, runPipeline, ProgressUpdate, checkDomainPolicy, checkRateLimit, sanitizeUrl, isValidObjective, multiIntentManager, multiIntentPipeline } from "../agent";
import type { PipelineResponse } from "../../shared/schemas/multiIntent";
import { checkToolPolicy, logToolCall } from "./integrationPolicyService";
import { detectEmailIntent, handleEmailChatRequest } from "./gmailChatIntegration";
import { productionWorkflowRunner, classifyIntent, isGenerationIntent } from "../agent/registry/productionWorkflowRunner";
import { agentLoopFacade, promptAnalyzer, type ComplexityLevel } from "../agent/orchestration";
import { buildSystemPromptWithContext, isToolAllowed, getEnforcedModel, type GptSessionContract } from "./gptSessionService";
import { intentEnginePipeline, type PipelineOptions } from "../intent-engine";
import { handleChatRequest } from "./chatService";

// Re-export constants
export const AVAILABLE_MODELS = {
    xai: {
        name: "xAI Grok",
        models: [
            { id: "grok-4-1-fast-non-reasoning", name: "Grok 4.1 Fast", description: "Respuestas rápidas con 2M de contexto" },
            { id: "grok-4-1-fast-reasoning", name: "Grok 4.1 Fast Reasoning", description: "Razonamiento avanzado con 2M de contexto" },
            { id: "grok-4-fast-non-reasoning", name: "Grok 4 Fast", description: "Modelo rápido y eficiente" },
            { id: "grok-4-fast-reasoning", name: "Grok 4 Fast Reasoning", description: "Razonamiento paso a paso" },
            { id: "grok-code-fast-1", name: "Grok Code", description: "Especializado en código" },
            { id: "grok-4-0709", name: "Grok 4 Premium", description: "Modelo premium de alta calidad" },
            { id: "grok-3-fast", name: "Grok 3 Fast", description: "Respuestas rápidas" },
            { id: "grok-2-vision-1212", name: "Grok 2 Vision", description: "Comprensión de imágenes" },
        ]
    },
    gemini: {
        name: "Google Gemini",
        models: [
            { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", description: "Rápido y eficiente", default: true },
            { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview", description: "Preview (puede variar disponibilidad)" },
            { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", description: "El modelo más avanzado de Google (Preview)" },
            { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", description: "El más capaz" },
        ]
    }
} as const;

export const DEFAULT_PROVIDER = REGISTRY_DEFAULT_PROVIDER;
export const DEFAULT_MODEL = REGISTRY_DEFAULT_MODEL;

// Interfaces
export interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
}

export interface GptConfig {
    id: string;
    systemPrompt: string;
    temperature: number;
    topP: number;
}

export interface GptSessionInfo {
    contract: GptSessionContract | null;
    legacyConfig?: {
        id: string;
        systemPrompt: string;
        temperature: number;
        topP: number;
    };
}

interface DocumentMode {
    type: "word" | "excel" | "ppt";
}

type DiagramType = "flowchart" | "orgchart" | "mindmap";

interface FigmaDiagram {
    diagramType: DiagramType;
    nodes: Array<{
        id: string;
        type: "start" | "end" | "process" | "decision" | "role" | "department" | "person";
        label: string;
        x: number;
        y: number;
        level?: number;
        parentId?: string;
    }>;
    connections: Array<{
        from: string;
        to: string;
        label?: string;
    }>;
    title?: string;
}

interface ChatSource {
    fileName: string;
    content: string;
}

interface WebSource {
    url: string;
    title: string;
    domain: string;
    favicon?: string;
    snippet?: string;
    date?: string;
    imageUrl?: string;
    canonicalUrl?: string;
    siteName?: string;
    source?: {
        name: string;
        domain: string;
    };
}

export interface ChatResponse {
    content: string;
    role: string;
    sources?: ChatSource[];
    webSources?: WebSource[];
    agentRunId?: string;
    wasAgentTask?: boolean;
    pipelineSteps?: number;
    pipelineSuccess?: boolean;
    browserSessionId?: string | null;
    figmaDiagram?: FigmaDiagram;
    multiIntentResponse?: PipelineResponse;
    gpt_id?: string;
    config_version?: number;
    tool_permissions?: {
        mode: 'allowlist' | 'denylist';
        allowedTools: string[];
        actionsEnabled: boolean;
    };
    metadata?: {
        verified?: boolean;
        verificationAttempts?: number;
        [key: string]: any;
    };
    artifact?: any;
    artifacts?: any[];
    agenticMetadata?: any;
    documentAgenticMetadata?: any;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

export type LLMProvider = "xai" | "gemini";

// Helper Functions (Private to module ideally, but kept here)
function detectDiagramType(prompt: string): DiagramType {
    const lowerPrompt = prompt.toLowerCase();
    const orgChartKeywords = ["organigrama", "org chart", "estructura organizacional", "jerarqu", "organización", "equipo", "departamento", "ceo", "director", "gerente", "jefe"];
    const mindmapKeywords = ["mapa mental", "mindmap", "lluvia de ideas", "brainstorm"];

    if (orgChartKeywords.some(kw => lowerPrompt.includes(kw))) return "orgchart";
    if (mindmapKeywords.some(kw => lowerPrompt.includes(kw))) return "mindmap";
    return "flowchart";
}

function detectMemoryIntent(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    return MEMORY_INTENT_KEYWORDS.some(keyword => lowerMessage.includes(keyword));
}

interface AgenticContext {
    hasAttachments: boolean;
    hasActiveDocuments: boolean;
    conversationLength: number;
}

function shouldUseAgenticPipeline(message: string, context: AgenticContext): boolean {
    // ... (Simplified for V2, referencing original logic or keeping it inline)
    // Logic copied from original
    const lowerMessage = message.toLowerCase();
    const COMPLEX_PATTERNS = [
        /\b(investiga|research|analiza\s+a\s+fondo|deep\s+dive)\b/i,
        /\b(crea|genera|build|create)\b.*\b(y|and|then|luego|después)\b/i,
        // ... truncated simple patterns ...
        /\b(planifica|plan|diseña|design)\b.*\b(estrategia|strategy|proyecto|project)\b/i,
    ];
    if (COMPLEX_PATTERNS.some(p => p.test(lowerMessage))) return true;
    return false;
}

// DEPENDENCY INJECTION INTERFACE
export interface ChatServiceDependencies {
    storage: typeof storage;
    llmGateway: typeof llmGateway;
}

export class ChatService {
    private storage: typeof storage;
    private llmGateway: typeof llmGateway;

    constructor(dependencies?: Partial<ChatServiceDependencies>) {
        this.storage = dependencies?.storage || storage;
        this.llmGateway = dependencies?.llmGateway || llmGateway;
    }

    public async chat(
        messages: ChatMessage[],
        options: {
            useRag?: boolean;
            conversationId?: string;
            userId?: string;
            images?: string[];
            onAgentProgress?: (update: ProgressUpdate) => void;
            gptSession?: GptSessionInfo;
            gptConfig?: GptConfig;
            documentMode?: DocumentMode;
            figmaMode?: boolean;
            provider?: LLMProvider;
            model?: string;
            attachmentContext?: string;
            forceDirectResponse?: boolean;
            hasRawAttachments?: boolean;
            lastImageBase64?: string;
            lastImageId?: string;
        } = {}
    ): Promise<ChatResponse> {
        return handleChatRequest(messages, options);
    }
}

// Singleton export
export const chatService = new ChatService();
