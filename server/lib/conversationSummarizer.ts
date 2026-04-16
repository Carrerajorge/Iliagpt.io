import { llmGateway } from "./llmGateway";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface SummaryResult {
  summary: string;
  keyTopics: string[];
  actionItems: string[];
  questionsAsked: number;
  estimatedTokensSaved: number;
}

const SUMMARY_PROMPT = `Eres un experto en resumir conversaciones. Genera un resumen conciso pero completo de la siguiente conversación.

El resumen debe incluir:
1. Los temas principales discutidos
2. Las decisiones o conclusiones alcanzadas
3. Las tareas o acciones pendientes
4. Cualquier información importante compartida

Responde en formato JSON con la siguiente estructura:
{
  "summary": "Resumen en 2-3 párrafos",
  "keyTopics": ["tema1", "tema2", "tema3"],
  "actionItems": ["acción1", "acción2"]
}

Conversación:
`;

export async function summarizeConversation(
  messages: Message[],
  options: {
    maxLength?: number;
    language?: string;
    includeActionItems?: boolean;
  } = {}
): Promise<SummaryResult> {
  const { 
    maxLength = 500, 
    language = "es",
    includeActionItems = true 
  } = options;

  if (messages.length < 3) {
    return {
      summary: "Conversación muy corta para resumir.",
      keyTopics: [],
      actionItems: [],
      questionsAsked: messages.filter(m => m.role === "user").length,
      estimatedTokensSaved: 0,
    };
  }

  const conversationText = messages
    .filter(m => m.role !== "system")
    .map(m => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content}`)
    .join("\n\n");

  const prompt = SUMMARY_PROMPT + conversationText + `\n\nIdioma del resumen: ${language === "es" ? "español" : "inglés"}`;

  try {
    const response = await llmGateway.sendMessage({
      messages: [{ role: "user", content: prompt }],
      model: "gemini-2.0-flash",
      maxTokens: 1000,
      temperature: 0.3,
    });

    const responseText = typeof response === "string" ? response : response.content;
    
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        summary: responseText.slice(0, maxLength),
        keyTopics: [],
        actionItems: [],
        questionsAsked: messages.filter(m => m.role === "user").length,
        estimatedTokensSaved: estimateTokensSaved(messages, responseText),
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    return {
      summary: parsed.summary?.slice(0, maxLength) || responseText.slice(0, maxLength),
      keyTopics: parsed.keyTopics || [],
      actionItems: includeActionItems ? (parsed.actionItems || []) : [],
      questionsAsked: messages.filter(m => m.role === "user").length,
      estimatedTokensSaved: estimateTokensSaved(messages, parsed.summary || responseText),
    };
  } catch (error) {
    console.error("[ConversationSummarizer] Error:", error);
    
    return createBasicSummary(messages, maxLength);
  }
}

function estimateTokensSaved(messages: Message[], summary: string): number {
  const originalTokens = messages.reduce((acc, m) => acc + estimateTokens(m.content), 0);
  const summaryTokens = estimateTokens(summary);
  return Math.max(0, originalTokens - summaryTokens);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function createBasicSummary(messages: Message[], maxLength: number): SummaryResult {
  const userMessages = messages.filter(m => m.role === "user");
  const assistantMessages = messages.filter(m => m.role === "assistant");

  const topics = new Set<string>();
  for (const msg of userMessages) {
    const words = msg.content.split(/\s+/).filter(w => w.length > 5).slice(0, 3);
    words.forEach(w => topics.add(w.toLowerCase()));
  }

  const summary = `Conversación con ${userMessages.length} preguntas del usuario y ${assistantMessages.length} respuestas del asistente. ` +
    `Temas principales: ${Array.from(topics).slice(0, 5).join(", ")}.`;

  return {
    summary: summary.slice(0, maxLength),
    keyTopics: Array.from(topics).slice(0, 5),
    actionItems: [],
    questionsAsked: userMessages.length,
    estimatedTokensSaved: 0,
  };
}

export async function generateQuickSummary(messages: Message[]): Promise<string> {
  if (messages.length < 2) {
    return "Inicio de conversación";
  }

  const lastUserMessage = messages.filter(m => m.role === "user").pop();
  const lastAssistantMessage = messages.filter(m => m.role === "assistant").pop();

  if (lastUserMessage && lastAssistantMessage) {
    const userPreview = lastUserMessage.content.slice(0, 50);
    return `${userPreview}${lastUserMessage.content.length > 50 ? "..." : ""}`;
  }

  return `Conversación de ${messages.length} mensajes`;
}

export async function compressContextForMemory(
  messages: Message[],
  maxTokens: number = 2000
): Promise<Message[]> {
  const totalTokens = messages.reduce((acc, m) => acc + estimateTokens(m.content), 0);
  
  if (totalTokens <= maxTokens) {
    return messages;
  }

  const systemMessages = messages.filter(m => m.role === "system");
  const recentMessages = messages.slice(-6);
  const remainingTokens = maxTokens - recentMessages.reduce((acc, m) => acc + estimateTokens(m.content), 0);

  if (remainingTokens <= 200) {
    return [...systemMessages, ...recentMessages];
  }

  const middleMessages = messages.slice(systemMessages.length, -6);
  if (middleMessages.length > 0) {
    const summary = await summarizeConversation(middleMessages, { maxLength: remainingTokens * 3 });
    
    return [
      ...systemMessages,
      { 
        role: "system" as const, 
        content: `[Resumen de conversación anterior: ${summary.summary}]` 
      },
      ...recentMessages,
    ];
  }

  return [...systemMessages, ...recentMessages];
}

export default {
  summarizeConversation,
  generateQuickSummary,
  compressContextForMemory,
};
