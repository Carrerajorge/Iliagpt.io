import { EventEmitter } from "events";

export type WhatsAppConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface WhatsAppMediaAttachment {
  mimeType: string;
  fileName?: string;
  dataBase64?: string;
  url?: string;
}

export interface WhatsAppStatus {
  state: WhatsAppConnectionState;
  me?: { id: string } | null;
  qr?: string | null;
  error?: string | null;
  updatedAt: number;
}

type StartOptions = { phone?: string };

class WhatsAppWebManager extends EventEmitter {
  private readonly statuses = new Map<string, WhatsAppStatus>();
  private readonly autoReplyEnabled = new Map<string, boolean>();
  private readonly autoReplyToContacts = new Map<string, boolean>();
  private readonly autoReplyPrompt = new Map<string, string>();
  private readonly processedMessages = new Set<string>();

  private ensureStatus(userId: string): WhatsAppStatus {
    const existing = this.statuses.get(userId);
    if (existing) return existing;
    const initial: WhatsAppStatus = {
      state: "disconnected",
      me: null,
      qr: null,
      error: null,
      updatedAt: Date.now(),
    };
    this.statuses.set(userId, initial);
    return initial;
  }

  getStatus(userId: string): WhatsAppStatus {
    return this.ensureStatus(userId);
  }

  async startWithOptions(userId: string, options?: StartOptions): Promise<WhatsAppStatus> {
    const meId = options?.phone
      ? `${String(options.phone).replace(/\D/g, "")}@s.whatsapp.net`
      : `${userId}@s.whatsapp.net`;

    const status: WhatsAppStatus = {
      state: "connected",
      me: { id: meId },
      qr: null,
      error: null,
      updatedAt: Date.now(),
    };
    this.statuses.set(userId, status);
    this.emit("status", userId, status);
    return status;
  }

  async restart(userId: string, options?: StartOptions): Promise<WhatsAppStatus> {
    await this.disconnect(userId);
    return this.startWithOptions(userId, options);
  }

  async disconnect(userId: string): Promise<void> {
    const status: WhatsAppStatus = {
      state: "disconnected",
      me: null,
      qr: null,
      error: null,
      updatedAt: Date.now(),
    };
    this.statuses.set(userId, status);
    this.emit("status", userId, status);
  }

  async shutdownAll(): Promise<void> {
    const userIds = Array.from(this.statuses.keys());
    for (const userId of userIds) {
      await this.disconnect(userId);
    }
  }

  setAutoReply(userId: string, enabled: boolean): void {
    this.autoReplyEnabled.set(userId, enabled);
  }

  isAutoReplyEnabled(userId: string): boolean {
    return this.autoReplyEnabled.get(userId) ?? false;
  }

  setAutoReplyToContacts(userId: string, enabled: boolean): void {
    this.autoReplyToContacts.set(userId, enabled);
  }

  isAutoReplyToContactsEnabled(userId: string): boolean {
    return this.autoReplyToContacts.get(userId) ?? false;
  }

  setAutoReplyPrompt(userId: string, prompt: string): void {
    this.autoReplyPrompt.set(userId, prompt);
  }

  getAutoReplyPrompt(userId: string): string {
    return this.autoReplyPrompt.get(userId) ?? "";
  }

  markMessageProcessed(messageId: string): boolean {
    if (!messageId) return false;
    if (this.processedMessages.has(messageId)) return true;
    this.processedMessages.add(messageId);
    return false;
  }

  async sendText(userId: string, to: string, text: string): Promise<void> {
    this.emit("outbound_message", userId, { to, text, timestamp: Date.now() });
  }
}

export const whatsappWebManager = new WhatsAppWebManager();
