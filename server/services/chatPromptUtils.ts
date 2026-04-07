export interface PromptChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export function extractSystemMessages<T extends PromptChatMessage>(messages: T[]): {
  systemMessages: string[];
  conversationMessages: T[];
} {
  const systemMessages: string[] = [];
  const conversationMessages: T[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      const content = typeof message.content === "string" ? message.content.trim() : "";
      if (content) {
        systemMessages.push(content);
      }
      continue;
    }

    conversationMessages.push(message);
  }

  return { systemMessages, conversationMessages };
}
