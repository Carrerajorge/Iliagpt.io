import { createLogger } from "../utils/logger";
import { EventEmitter } from "events";

const log = createLogger("presence");

export interface UserPresence {
  userId: string;
  username?: string;
  status: "online" | "away" | "offline";
  currentChatId?: string;
  isTyping: boolean;
  lastSeen: number;
  connectedAt: number;
}

export interface PresenceUpdate {
  type: "join" | "leave" | "typing_start" | "typing_stop" | "chat_focus" | "status_change";
  userId: string;
  username?: string;
  chatId?: string;
  timestamp: number;
}

const TYPING_TIMEOUT_MS = 5_000;
const OFFLINE_THRESHOLD_MS = 2 * 60 * 1_000; // 2 minutes
const CLEANUP_INTERVAL_MS = 30_000;

export class PresenceManager extends EventEmitter {
  private users: Map<string, UserPresence> = new Map();
  private typingTimers: Map<string, NodeJS.Timeout> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    super();
    this.cleanupInterval = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    // Allow Node to exit even if the interval is still running
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  join(userId: string, username?: string): void {
    const existing = this.users.get(userId);
    const now = Date.now();

    const presence: UserPresence = {
      userId,
      username: username ?? existing?.username,
      status: "online",
      currentChatId: existing?.currentChatId,
      isTyping: false,
      lastSeen: now,
      connectedAt: existing?.connectedAt ?? now,
    };

    this.users.set(userId, presence);
    log.info("User joined presence", { userId });

    const update: PresenceUpdate = {
      type: "join",
      userId,
      username: presence.username,
      timestamp: now,
    };
    this.emit("update", update);
  }

  leave(userId: string): void {
    const user = this.users.get(userId);
    if (!user) return;

    // Clear any typing timer
    this.clearTypingTimer(userId);

    user.status = "offline";
    user.isTyping = false;
    user.lastSeen = Date.now();
    this.users.set(userId, user);

    log.info("User left presence", { userId });

    const update: PresenceUpdate = {
      type: "leave",
      userId,
      username: user.username,
      timestamp: Date.now(),
    };
    this.emit("update", update);
  }

  heartbeat(userId: string): void {
    const user = this.users.get(userId);
    if (!user) return;

    const wasAway = user.status === "away";
    user.lastSeen = Date.now();
    user.status = "online";
    this.users.set(userId, user);

    if (wasAway) {
      const update: PresenceUpdate = {
        type: "status_change",
        userId,
        username: user.username,
        timestamp: Date.now(),
      };
      this.emit("update", update);
    }
  }

  startTyping(userId: string, chatId: string): void {
    const user = this.users.get(userId);
    if (!user) return;

    // Clear any existing typing timer for this user
    this.clearTypingTimer(userId);

    user.isTyping = true;
    user.currentChatId = chatId;
    user.lastSeen = Date.now();
    this.users.set(userId, user);

    // Auto-clear typing after TYPING_TIMEOUT_MS
    const timer = setTimeout(() => {
      this.stopTyping(userId);
    }, TYPING_TIMEOUT_MS);
    this.typingTimers.set(userId, timer);

    const update: PresenceUpdate = {
      type: "typing_start",
      userId,
      username: user.username,
      chatId,
      timestamp: Date.now(),
    };
    this.emit("update", update);
  }

  stopTyping(userId: string): void {
    const user = this.users.get(userId);
    if (!user || !user.isTyping) return;

    this.clearTypingTimer(userId);

    user.isTyping = false;
    this.users.set(userId, user);

    const update: PresenceUpdate = {
      type: "typing_stop",
      userId,
      username: user.username,
      chatId: user.currentChatId,
      timestamp: Date.now(),
    };
    this.emit("update", update);
  }

  focusChat(userId: string, chatId: string): void {
    const user = this.users.get(userId);
    if (!user) return;

    user.currentChatId = chatId;
    user.lastSeen = Date.now();
    this.users.set(userId, user);

    const update: PresenceUpdate = {
      type: "chat_focus",
      userId,
      username: user.username,
      chatId,
      timestamp: Date.now(),
    };
    this.emit("update", update);
  }

  getOnlineUsers(): UserPresence[] {
    return Array.from(this.users.values()).filter(
      (u) => u.status === "online" || u.status === "away"
    );
  }

  getChatViewers(chatId: string): UserPresence[] {
    return Array.from(this.users.values()).filter(
      (u) => u.currentChatId === chatId && (u.status === "online" || u.status === "away")
    );
  }

  getTypingUsers(chatId: string): UserPresence[] {
    return Array.from(this.users.values()).filter(
      (u) => u.currentChatId === chatId && u.isTyping && (u.status === "online" || u.status === "away")
    );
  }

  cleanup(): void {
    const now = Date.now();
    for (const [userId, user] of this.users) {
      if (user.status === "offline") {
        // Remove users who have been offline for longer than the threshold
        if (now - user.lastSeen > OFFLINE_THRESHOLD_MS) {
          this.users.delete(userId);
          this.clearTypingTimer(userId);
        }
        continue;
      }

      // Mark users with stale lastSeen as away, then offline
      const elapsed = now - user.lastSeen;
      if (elapsed > OFFLINE_THRESHOLD_MS) {
        this.clearTypingTimer(userId);
        user.status = "offline";
        user.isTyping = false;
        this.users.set(userId, user);

        log.info("User marked offline by cleanup", { userId, elapsed });

        const update: PresenceUpdate = {
          type: "leave",
          userId,
          username: user.username,
          timestamp: now,
        };
        this.emit("update", update);
      } else if (elapsed > OFFLINE_THRESHOLD_MS / 2) {
        // Mark as away after half the offline threshold (1 min)
        if (user.status !== "away") {
          user.status = "away";
          this.users.set(userId, user);

          const update: PresenceUpdate = {
            type: "status_change",
            userId,
            username: user.username,
            timestamp: now,
          };
          this.emit("update", update);
        }
      }
    }
  }

  /** Stop the cleanup interval (for graceful shutdown / tests). */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    for (const timer of this.typingTimers.values()) {
      clearTimeout(timer);
    }
    this.typingTimers.clear();
    this.users.clear();
    this.removeAllListeners();
  }

  private clearTypingTimer(userId: string): void {
    const timer = this.typingTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(userId);
    }
  }
}

export const presenceManager = new PresenceManager();
