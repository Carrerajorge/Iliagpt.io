/**
 * PresenceManager.ts
 * Tracks active collaborators: status, avatars, cursor positions, colors.
 * Integrates with CollaborationClient events and provides a
 * subscribe/unsubscribe pattern suitable for React components.
 */

import type { CursorPosition, CollaborationClient, PresenceUpdateMessage, CursorMoveMessage } from "./CollaborationClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserStatus = "online" | "away" | "offline";

export interface UserPresence {
  userId: string;
  name: string;
  /** Absolute URL or data-URI for the avatar image */
  avatar: string;
  /** Hex or CSS color string assigned to this user */
  color: string;
  status: UserStatus;
  /** Unix ms timestamp of the last received event */
  lastSeen: number;
  cursorPosition?: CursorPosition;
}

export type PresenceChangeListener = (users: Map<string, UserPresence>) => void;

// ---------------------------------------------------------------------------
// Color palette – visually distinct, accessible on both light and dark bg
// ---------------------------------------------------------------------------

const COLOR_PALETTE: string[] = [
  "#3B82F6", // blue-500
  "#10B981", // emerald-500
  "#F59E0B", // amber-500
  "#EF4444", // red-500
  "#8B5CF6", // violet-500
  "#EC4899", // pink-500
  "#06B6D4", // cyan-500
  "#84CC16", // lime-500
  "#F97316", // orange-500
  "#6366F1", // indigo-500
  "#14B8A6", // teal-500
  "#A855F7", // purple-500
];

// ---------------------------------------------------------------------------
// PresenceManager
// ---------------------------------------------------------------------------

export interface PresenceManagerOptions {
  /** Local user's ID — kept out of the remote map */
  localUserId: string;
  /** Seconds of silence before a user is marked "away". Default: 30 */
  awayAfterSeconds?: number;
  /** Seconds of silence before a user is marked "offline" and removed. Default: 120 */
  offlineAfterSeconds?: number;
  /** Polling interval (ms) for checking inactivity. Default: 10000 */
  inactivityCheckInterval?: number;
}

export class PresenceManager {
  private users = new Map<string, UserPresence>();
  private listeners = new Set<PresenceChangeListener>();
  private colorAssignments = new Map<string, string>();
  private colorIndex = 0;
  private inactivityTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeCallbacks: (() => void)[] = [];

  private readonly localUserId: string;
  private readonly awayAfterMs: number;
  private readonly offlineAfterMs: number;
  private readonly inactivityCheckInterval: number;

  constructor(options: PresenceManagerOptions) {
    this.localUserId = options.localUserId;
    this.awayAfterMs = (options.awayAfterSeconds ?? 30) * 1000;
    this.offlineAfterMs = (options.offlineAfterSeconds ?? 120) * 1000;
    this.inactivityCheckInterval = options.inactivityCheckInterval ?? 10_000;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Wire the PresenceManager to a live CollaborationClient.
   * Returns a cleanup function that removes all listeners.
   */
  attachClient(client: CollaborationClient): () => void {
    const offPresence = client.on("presence_update", (msg: PresenceUpdateMessage) => {
      this.handlePresenceUpdate(msg);
    });

    const offCursor = client.on("cursor_move", (msg: CursorMoveMessage) => {
      this.handleCursorMove(msg);
    });

    this.startInactivityCheck();

    const cleanup = () => {
      offPresence();
      offCursor();
      this.stopInactivityCheck();
    };

    this.unsubscribeCallbacks.push(cleanup);
    return cleanup;
  }

  destroy(): void {
    this.stopInactivityCheck();
    for (const unsub of this.unsubscribeCallbacks) unsub();
    this.unsubscribeCallbacks = [];
    this.listeners.clear();
    this.users.clear();
  }

  // ---------------------------------------------------------------------------
  // Public queries
  // ---------------------------------------------------------------------------

  getUsers(): Map<string, UserPresence> {
    return new Map(this.users);
  }

  getUsersArray(): UserPresence[] {
    return Array.from(this.users.values());
  }

  getUser(userId: string): UserPresence | undefined {
    return this.users.get(userId);
  }

  getOnlineCount(): number {
    let count = 0;
    for (const u of this.users.values()) {
      if (u.status !== "offline") count++;
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // Subscribe / unsubscribe (React-friendly)
  // ---------------------------------------------------------------------------

  subscribe(listener: PresenceChangeListener): () => void {
    this.listeners.add(listener);
    // Immediately deliver current state
    listener(this.getUsers());
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------------------
  // Color assignment
  // ---------------------------------------------------------------------------

  assignColor(userId: string): string {
    if (this.colorAssignments.has(userId)) {
      return this.colorAssignments.get(userId)!;
    }
    const color = COLOR_PALETTE[this.colorIndex % COLOR_PALETTE.length];
    this.colorIndex++;
    this.colorAssignments.set(userId, color);
    return color;
  }

  getUserColor(userId: string): string {
    return this.colorAssignments.get(userId) ?? COLOR_PALETTE[0];
  }

  // ---------------------------------------------------------------------------
  // Avatar helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns an avatar URL. If the provided URL is empty/undefined,
   * falls back to an initials-based SVG data URI.
   */
  static resolveAvatar(name: string, providedUrl?: string): string {
    if (providedUrl && providedUrl.trim().length > 0) return providedUrl;
    return PresenceManager.generateInitialsAvatar(name);
  }

  static generateInitialsAvatar(name: string, bgColor = "#6366F1"): string {
    const initials = name
      .split(" ")
      .map((part) => part.charAt(0).toUpperCase())
      .slice(0, 2)
      .join("");

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="20" fill="${bgColor}"/>
        <text
          x="20" y="20"
          text-anchor="middle"
          dominant-baseline="central"
          font-family="system-ui, sans-serif"
          font-size="15"
          font-weight="600"
          fill="#ffffff"
        >${initials}</text>
      </svg>
    `.trim();

    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  // ---------------------------------------------------------------------------
  // Internal handlers
  // ---------------------------------------------------------------------------

  private handlePresenceUpdate(msg: PresenceUpdateMessage): void {
    const { userId, name, avatar, color, status } = msg.payload;

    // Never add the local user to the remote map
    if (userId === this.localUserId) return;

    const resolvedColor = this.ensureColor(userId, color);
    const resolvedAvatar = PresenceManager.resolveAvatar(name, avatar);

    const existing = this.users.get(userId);
    const updated: UserPresence = {
      userId,
      name,
      avatar: resolvedAvatar,
      color: resolvedColor,
      status: status === "offline" ? "offline" : status,
      lastSeen: msg.timestamp,
      cursorPosition: existing?.cursorPosition,
    };

    if (status === "offline") {
      this.users.delete(userId);
    } else {
      this.users.set(userId, updated);
    }

    this.notify();
  }

  private handleCursorMove(msg: CursorMoveMessage): void {
    const { senderId, payload } = msg;
    if (senderId === this.localUserId) return;

    const user = this.users.get(senderId);
    if (!user) return;

    this.users.set(senderId, {
      ...user,
      cursorPosition: payload.position,
      lastSeen: msg.timestamp,
    });

    this.notify();
  }

  // ---------------------------------------------------------------------------
  // Inactivity check
  // ---------------------------------------------------------------------------

  private startInactivityCheck(): void {
    if (this.inactivityTimer) return;
    this.inactivityTimer = setInterval(() => {
      this.checkInactivity();
    }, this.inactivityCheckInterval);
  }

  private stopInactivityCheck(): void {
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  private checkInactivity(): void {
    const now = Date.now();
    let changed = false;

    for (const [userId, user] of this.users.entries()) {
      const silence = now - user.lastSeen;

      if (silence >= this.offlineAfterMs && user.status !== "offline") {
        // Remove silently offline users from the map
        this.users.delete(userId);
        changed = true;
      } else if (
        silence >= this.awayAfterMs &&
        silence < this.offlineAfterMs &&
        user.status === "online"
      ) {
        this.users.set(userId, { ...user, status: "away" });
        changed = true;
      }
    }

    if (changed) this.notify();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private ensureColor(userId: string, preferredColor?: string): string {
    if (preferredColor && !this.colorAssignments.has(userId)) {
      this.colorAssignments.set(userId, preferredColor);
      return preferredColor;
    }
    return this.assignColor(userId);
  }

  private notify(): void {
    const snapshot = this.getUsers();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error("[PresenceManager] Error in listener:", err);
      }
    }
  }
}
