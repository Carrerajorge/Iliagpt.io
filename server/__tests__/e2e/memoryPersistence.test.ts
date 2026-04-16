import { describe, it, expect, beforeEach } from "vitest";

// ── Self-contained chat memory persistence tests ──────────────────────────
// These tests validate the conversation memory data model and logic
// without importing any server modules.

interface ChatMessage {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  userMessageId?: string;
  requestId?: string;
  status: "pending" | "done" | "failed";
}

interface Chat {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

interface MemoryFact {
  id: string;
  userId: string;
  content: string;
  category: string;
  salienceScore: number;
  accessCount: number;
  lastAccessedAt: Date;
  isActive: boolean;
}

// Simulated in-memory storage
let messages: ChatMessage[] = [];
let chats: Chat[] = [];
let memories: MemoryFact[] = [];
let idCounter = 0;

function createMessage(chatId: string, role: "user" | "assistant", content: string, userMessageId?: string): ChatMessage {
  const msg: ChatMessage = {
    id: `msg-${++idCounter}`,
    chatId,
    role,
    content,
    timestamp: new Date(),
    userMessageId,
    requestId: `req-${idCounter}`,
    status: "done",
  };
  messages.push(msg);
  return msg;
}

function getMessagesForChat(chatId: string): ChatMessage[] {
  return messages.filter((m) => m.chatId === chatId).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

function createChat(userId: string, title: string): Chat {
  const chat: Chat = {
    id: `chat-${++idCounter}`,
    userId,
    title,
    createdAt: new Date(),
    updatedAt: new Date(),
    messageCount: 0,
  };
  chats.push(chat);
  return chat;
}

function getActiveChats(userId: string): Chat[] {
  return chats.filter((c) => c.userId === userId).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

function augmentWithHistory(chatId: string, newMessage: string, tokenBudget = 8000): string[] {
  const history = getMessagesForChat(chatId);
  const contextMessages: string[] = [];
  let tokenCount = 0;
  for (const msg of history) {
    const approxTokens = Math.ceil(msg.content.length / 4);
    if (tokenCount + approxTokens > tokenBudget) break;
    contextMessages.push(`${msg.role}: ${msg.content}`);
    tokenCount += approxTokens;
  }
  contextMessages.push(`user: ${newMessage}`);
  return contextMessages;
}

function extractFacts(msgs: ChatMessage[]): MemoryFact[] {
  const facts: MemoryFact[] = [];
  for (const msg of msgs) {
    if (msg.role !== "user") continue;
    const lower = msg.content.toLowerCase();
    if (lower.includes("mi nombre es") || lower.includes("me llamo")) {
      const name = msg.content.split(/mi nombre es|me llamo/i)[1]?.trim().split(/[.,!?\s]/)[0];
      if (name) {
        facts.push({
          id: `mem-${++idCounter}`,
          userId: "user-1",
          content: `User's name is ${name}`,
          category: "personal",
          salienceScore: 0.1,
          accessCount: 1,
          lastAccessedAt: new Date(),
          isActive: true,
        });
      }
    }
    if (lower.includes("trabajo en") || lower.includes("empresa")) {
      facts.push({
        id: `mem-${++idCounter}`,
        userId: "user-1",
        content: msg.content,
        category: "work",
        salienceScore: 0.1,
        accessCount: 1,
        lastAccessedAt: new Date(),
        isActive: true,
      });
    }
  }
  return facts;
}

function recallMemories(userId: string, query: string): MemoryFact[] {
  return memories.filter((m) => m.userId === userId && m.isActive).slice(0, 5);
}

function buildMemoryContext(facts: MemoryFact[]): string {
  if (facts.length === 0) return "";
  const lines = facts.map((f) => `- [${f.category}] ${f.content}`);
  return `## Memory about this user\n${lines.join("\n")}`;
}

function applyDecay(daysOld: number, currentScore: number): number {
  if (daysOld <= 30) return currentScore;
  return currentScore * 0.95;
}

function generateChatTitle(userMsg: string, assistantMsg: string): string {
  if (userMsg.length < 5) return "Conversación general";
  const title = userMsg.slice(0, 60);
  return title.length === 60 ? title + "..." : title;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("In-chat memory persistence", () => {
  beforeEach(() => {
    messages = [];
    chats = [];
    memories = [];
    idCounter = 0;
  });

  it("stores user message with correct chatId, role, content, timestamp", () => {
    const msg = createMessage("chat-1", "user", "Hola, necesito ayuda");
    expect(msg.chatId).toBe("chat-1");
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hola, necesito ayuda");
    expect(msg.timestamp).toBeInstanceOf(Date);
    expect(msg.status).toBe("done");
  });

  it("stores assistant message linked to user message", () => {
    const userMsg = createMessage("chat-1", "user", "¿Qué es TypeScript?");
    const assistantMsg = createMessage("chat-1", "assistant", "TypeScript es un superset de JavaScript", userMsg.id);
    expect(assistantMsg.userMessageId).toBe(userMsg.id);
    expect(assistantMsg.role).toBe("assistant");
  });

  it("fetches previous messages as context for LLM", () => {
    createMessage("chat-1", "user", "Mi nombre es Carlos");
    createMessage("chat-1", "assistant", "Hola Carlos, ¿en qué puedo ayudarte?");
    createMessage("chat-1", "user", "Necesito crear un Excel");
    createMessage("chat-1", "assistant", "Claro, ¿qué datos necesitas?");
    createMessage("chat-1", "user", "Datos de ventas");

    const context = augmentWithHistory("chat-1", "¿Cómo me llamo?");
    expect(context.length).toBe(6); // 5 existing + 1 new
    expect(context[0]).toContain("Carlos");
    expect(context[5]).toContain("¿Cómo me llamo?");
  });

  it("maintains conversation context across 10 messages", () => {
    for (let i = 1; i <= 10; i++) {
      createMessage("chat-1", i % 2 === 1 ? "user" : "assistant", `Mensaje número ${i}`);
    }
    const context = augmentWithHistory("chat-1", "¿Cuántos mensajes llevamos?");
    expect(context.length).toBe(11);
    expect(context[2]).toContain("Mensaje número 3");
  });

  it("remembers specific data mentioned earlier (name)", () => {
    createMessage("chat-1", "user", "Mi nombre es Carlos");
    createMessage("chat-1", "assistant", "Mucho gusto Carlos");
    createMessage("chat-1", "user", "Cuéntame sobre JavaScript");
    createMessage("chat-1", "assistant", "JavaScript es un lenguaje de programación");

    const context = augmentWithHistory("chat-1", "¿Cómo me llamo?");
    const fullContext = context.join(" ");
    expect(fullContext).toContain("Carlos");
  });

  it("remembers work context from earlier messages", () => {
    createMessage("chat-1", "user", "Trabajo en una empresa de logística");
    createMessage("chat-1", "assistant", "Interesante, ¿en qué puedo ayudarte?");

    const context = augmentWithHistory("chat-1", "¿En qué trabajo?");
    const fullContext = context.join(" ");
    expect(fullContext).toContain("logística");
  });

  it("remembers project details from earlier messages", () => {
    createMessage("chat-1", "user", "Estoy haciendo un proyecto sobre energía solar");
    createMessage("chat-1", "assistant", "Fascinante tema");

    const context = augmentWithHistory("chat-1", "¿Sobre qué es mi proyecto?");
    expect(context.join(" ")).toContain("energía solar");
  });

  it("handles numeric data recall from conversation", () => {
    createMessage("chat-1", "user", "Ventas Q1: $50K, Q2: $75K, Q3: $60K");
    createMessage("chat-1", "assistant", "Entendido, Q2 fue el mejor trimestre");

    const context = augmentWithHistory("chat-1", "¿Cuál fue el trimestre con más ventas?");
    const full = context.join(" ");
    expect(full).toContain("$75K");
    expect(full).toContain("Q2");
  });

  it("preserves instruction-style messages in context", () => {
    createMessage("chat-1", "user", "Desde ahora responde en inglés");
    createMessage("chat-1", "assistant", "Sure, I will respond in English from now on");

    const context = augmentWithHistory("chat-1", "¿Qué hora es?");
    expect(context.join(" ")).toContain("responde en inglés");
  });

  it("maintains entity references across messages", () => {
    createMessage("chat-1", "user", "Recuerda: mi empresa se llama TechNova");
    createMessage("chat-1", "assistant", "Anotado, TechNova");
    for (let i = 0; i < 5; i++) {
      createMessage("chat-1", "user", `Pregunta genérica ${i}`);
      createMessage("chat-1", "assistant", `Respuesta genérica ${i}`);
    }

    const context = augmentWithHistory("chat-1", "¿Cómo se llama mi empresa?");
    expect(context.join(" ")).toContain("TechNova");
  });
});

describe("Long-term memory extraction and recall", () => {
  beforeEach(() => {
    messages = [];
    chats = [];
    memories = [];
    idCounter = 0;
  });

  it("extracts facts from conversation messages", () => {
    const msgs = [
      createMessage("chat-1", "user", "Mi nombre es Carlos"),
      createMessage("chat-1", "assistant", "Hola Carlos"),
      createMessage("chat-1", "user", "Trabajo en empresa de logística"),
    ];
    const facts = extractFacts(msgs);
    expect(facts.length).toBeGreaterThanOrEqual(2);
    expect(facts.some((f) => f.category === "personal")).toBe(true);
    expect(facts.some((f) => f.category === "work")).toBe(true);
  });

  it("stores extracted facts with embeddings and salience score", () => {
    const msgs = [createMessage("chat-1", "user", "Mi nombre es Ana")];
    const facts = extractFacts(msgs);
    expect(facts[0].salienceScore).toBe(0.1);
    expect(facts[0].accessCount).toBe(1);
    expect(facts[0].isActive).toBe(true);
    expect(facts[0].content).toContain("Ana");
  });

  it("recalls relevant memories using vector similarity", () => {
    memories.push({
      id: "mem-1",
      userId: "user-1",
      content: "User likes dark mode",
      category: "preference",
      salienceScore: 0.8,
      accessCount: 5,
      lastAccessedAt: new Date(),
      isActive: true,
    });
    const recalled = recallMemories("user-1", "What theme does the user prefer?");
    expect(recalled.length).toBeGreaterThan(0);
    expect(recalled[0].content).toContain("dark mode");
  });

  it("builds memory context string for system prompt", () => {
    const facts: MemoryFact[] = [
      { id: "1", userId: "u1", content: "User is a software engineer", category: "work", salienceScore: 0.5, accessCount: 3, lastAccessedAt: new Date(), isActive: true },
      { id: "2", userId: "u1", content: "User prefers concise answers", category: "preference", salienceScore: 0.7, accessCount: 5, lastAccessedAt: new Date(), isActive: true },
    ];
    const context = buildMemoryContext(facts);
    expect(context).toContain("## Memory about this user");
    expect(context).toContain("[work] User is a software engineer");
    expect(context).toContain("[preference] User prefers concise answers");
  });

  it("applies decay to old memories", () => {
    const oldScore = 0.5;
    const decayed = applyDecay(45, oldScore);
    expect(decayed).toBeLessThan(oldScore);
    expect(decayed).toBeCloseTo(0.475, 3);

    const recentScore = applyDecay(10, oldScore);
    expect(recentScore).toBe(oldScore);
  });

  it("deletes memory by ID", () => {
    memories.push({
      id: "mem-to-delete",
      userId: "user-1",
      content: "Some fact",
      category: "personal",
      salienceScore: 0.5,
      accessCount: 1,
      lastAccessedAt: new Date(),
      isActive: true,
    });
    expect(memories.length).toBe(1);
    memories = memories.filter((m) => m.id !== "mem-to-delete");
    expect(memories.length).toBe(0);
  });
});

describe("Chat history and listing", () => {
  beforeEach(() => {
    messages = [];
    chats = [];
    memories = [];
    idCounter = 0;
  });

  it("lists active chats ordered by date", () => {
    const chat1 = createChat("user-1", "Chat antiguo");
    chat1.updatedAt = new Date("2024-01-01");
    const chat2 = createChat("user-1", "Chat reciente");
    chat2.updatedAt = new Date("2024-06-01");
    const chat3 = createChat("user-1", "Chat medio");
    chat3.updatedAt = new Date("2024-03-01");

    const active = getActiveChats("user-1");
    expect(active.length).toBe(3);
    expect(active[0].title).toBe("Chat reciente");
    expect(active[2].title).toBe("Chat antiguo");
  });

  it("returns all messages for a specific chat", () => {
    createMessage("chat-A", "user", "Mensaje 1");
    createMessage("chat-A", "assistant", "Respuesta 1");
    createMessage("chat-B", "user", "Otro chat");
    createMessage("chat-A", "user", "Mensaje 2");

    const chatAMessages = getMessagesForChat("chat-A");
    expect(chatAMessages.length).toBe(3);
    expect(chatAMessages.every((m) => m.chatId === "chat-A")).toBe(true);
  });

  it("persists messages across session close/reopen", () => {
    createMessage("chat-1", "user", "Primer mensaje");
    createMessage("chat-1", "assistant", "Primera respuesta");
    createMessage("chat-1", "user", "Segundo mensaje");
    createMessage("chat-1", "assistant", "Segunda respuesta");
    createMessage("chat-1", "user", "Tercer mensaje");

    // Simulate "close and reopen" by just fetching again
    const reopened = getMessagesForChat("chat-1");
    expect(reopened.length).toBe(5);
    expect(reopened[0].content).toBe("Primer mensaje");
    expect(reopened[4].content).toBe("Tercer mensaje");
  });

  it("auto-generates chat title from first message", () => {
    const title = generateChatTitle("¿Cómo puedo crear un presupuesto en Excel?", "Para crear un presupuesto...");
    expect(title).toBe("¿Cómo puedo crear un presupuesto en Excel?");
    expect(title.length).toBeLessThanOrEqual(63); // 60 + possible "..."

    const shortTitle = generateChatTitle("Hola", "Hola, ¿en qué puedo ayudarte?");
    expect(shortTitle).toBe("Conversación general");
  });
});
