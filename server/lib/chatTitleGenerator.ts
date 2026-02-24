import { llmGateway } from "./llmGateway";
import { storage } from "../storage";

interface TitleGenerationInput {
  userMessage: string;
  assistantResponse: string;
  language?: string;
}

const TITLE_PROMPT = `Genera un título conciso y descriptivo para esta conversación de chat.

Reglas:
- Máximo 60 caracteres
- Debe capturar el tema principal de la conversación
- Usa el mismo idioma que el usuario
- NO uses comillas ni puntos finales
- NO empieces con "Chat sobre..." ni "Conversación de..."
- Sé específico: en vez de "Pregunta de código", escribe "Ordenar array con quicksort"
- Si el usuario saluda sin tema claro, usa algo como "Conversación general" o "Nuevo saludo"

Responde SOLO con el título, sin explicaciones ni formato adicional.

Mensaje del usuario:
{USER_MESSAGE}

Respuesta del asistente (primeras 300 caracteres):
{ASSISTANT_RESPONSE}

Título:`;

/**
 * Generates a descriptive chat title using AI based on the first
 * user message and the assistant's response.
 */
export async function generateChatTitle(input: TitleGenerationInput): Promise<string> {
  const { userMessage, assistantResponse, language = "es" } = input;

  // For very short messages (greetings, etc.), use smart fallback
  if (userMessage.length < 5) {
    return createFallbackTitle(userMessage, language);
  }

  try {
    const prompt = TITLE_PROMPT
      .replace("{USER_MESSAGE}", userMessage.slice(0, 500))
      .replace("{ASSISTANT_RESPONSE}", assistantResponse.slice(0, 300));

    const response = await llmGateway.chat(
      [{ role: "user", content: prompt }],
      {
        model: "gemini-2.0-flash",
        maxTokens: 80,
        temperature: 0.3,
      }
    );

    const rawTitle = response.content;
    const cleanTitle = sanitizeTitle(rawTitle);

    if (cleanTitle && cleanTitle.length >= 3) {
      return cleanTitle;
    }

    return createFallbackTitle(userMessage, language);
  } catch (error) {
    console.warn("[ChatTitleGenerator] AI title generation failed, using fallback:", error);
    return createFallbackTitle(userMessage, language);
  }
}

/**
 * Generates a title and persists it to the database.
 * Fire-and-forget — does not throw on failure.
 */
export async function generateAndPersistChatTitle(
  chatId: string,
  userMessage: string,
  assistantResponse: string,
): Promise<string | null> {
  try {
    // Verify chat still needs a title (hasn't been manually renamed)
    const chat = await storage.getChat(chatId);
    if (!chat) return null;

    // Only generate if title is still a placeholder
    if (!isTitlePlaceholder(chat.title)) {
      return chat.title;
    }

    const title = await generateChatTitle({ userMessage, assistantResponse });
    await storage.updateChat(chatId, { title });

    console.log(`[ChatTitleGenerator] Generated title for chat ${chatId}: "${title}"`);
    return title;
  } catch (error) {
    console.error("[ChatTitleGenerator] Failed to generate/persist title:", error);
    return null;
  }
}

/**
 * Checks whether a chat title is a placeholder that should be replaced.
 */
export function isTitlePlaceholder(title: string): boolean {
  if (!title) return true;
  if (title === "New Chat" || title === "Nuevo Chat") return true;
  // A title that's just a truncated message (ends with "..." and is <=53 chars)
  // is also considered a placeholder that can be improved
  if (title.endsWith("...") && title.length <= 53) return true;
  return false;
}

function sanitizeTitle(raw: string): string {
  let title = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")   // strip quotes
    .replace(/\.+$/, "")                // strip trailing dots
    .replace(/^(Título|Title):\s*/i, "") // strip "Título:" prefix
    .replace(/\n.*/s, "")              // take only first line
    .trim();

  // Enforce max length
  if (title.length > 60) {
    title = title.slice(0, 57) + "...";
  }

  return title;
}

function createFallbackTitle(userMessage: string, language: string): string {
  const msg = userMessage.trim();

  // Common greetings → generic title
  const greetings = /^(hola|hi|hello|hey|buenas|buenos días|buenas tardes|buenas noches|qué tal|saludos)/i;
  if (greetings.test(msg)) {
    return language === "es" ? "Conversación general" : "General conversation";
  }

  // Questions → use the question as title
  if (msg.endsWith("?") && msg.length <= 60) {
    return msg;
  }

  // Default: smart truncation at word boundary
  if (msg.length <= 60) {
    return msg;
  }

  const truncated = msg.slice(0, 57);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 30) {
    return truncated.slice(0, lastSpace) + "...";
  }
  return truncated + "...";
}

export default {
  generateChatTitle,
  generateAndPersistChatTitle,
  isTitlePlaceholder,
};
