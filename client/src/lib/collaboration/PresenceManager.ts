import { useEffect, useState, useRef, useCallback } from 'react';
import { logger } from '@/lib/logger';
import {
  CollaborationClient,
  CollaborationUser,
  ActivityState,
} from './CollaborationClient';

// ─── Constants ───────────────────────────────────────────────────────────────

const INACTIVITY_TIMEOUT_MS = 30_000; // 30 s → remove user
const IDLE_TIMEOUT_MS = 10_000;       // 10 s without activity → IDLE
const AWAY_TIMEOUT_MS = 20_000;       // 20 s → AWAY
const MAX_UPDATES_PER_SEC = 10;
const THROTTLE_INTERVAL_MS = 1000 / MAX_UPDATES_PER_SEC;

// ─── PresenceManager ─────────────────────────────────────────────────────────

export class PresenceManager {
  /** chatId → userId → CollaborationUser */
  private rooms = new Map<string, Map<string, CollaborationUser>>();

  /** Subscribers per chatId */
  private subscribers = new Map<string, Set<() => void>>();

  /** Per-user cleanup timers */
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Throttle state per chatId per userId */
  private throttleState = new Map<string, { lastUpdate: number; pending?: ReturnType<typeof setTimeout> }>();

  private client: CollaborationClient | null = null;

  // ─── Client Binding ────────────────────────────────────────────────────

  bindClient(client: CollaborationClient): void {
    this.client = client;

    client.on('CHAT_JOIN', ({ user }) => {
      this.updatePresence(user.id.split(':')[0] ?? '', user);
    });

    client.on('CHAT_LEAVE', ({ userId }) => {
      if (!this.client) return;
      // We don't know chatId here; scan all rooms
      for (const [chatId, room] of this.rooms) {
        if (room.has(userId)) {
          this.removeUser(chatId, userId);
        }
      }
    });

    client.on('PRESENCE_UPDATE', (user) => {
      // server echoes back with chatId embedded in user or we extract from context
      // For flexibility, scan rooms for the userId
      for (const [chatId, room] of this.rooms) {
        if (room.has(user.id)) {
          this.upsertUser(chatId, user);
          break;
        }
      }
    });

    client.on('TYPING_START', ({ userId }) => {
      this.setTyping(userId, true);
    });

    client.on('TYPING_STOP', ({ userId }) => {
      this.setTyping(userId, false);
    });

    client.on('CURSOR_MOVE', ({ userId, x, y }) => {
      this.setCursor(userId, x, y);
    });

    client.on('CURSOR_STOP', ({ userId }) => {
      this.clearCursor(userId);
    });
  }

  // ─── Presence CRUD ─────────────────────────────────────────────────────

  /**
   * Throttled update – emits at most MAX_UPDATES_PER_SEC per chatId+userId pair.
   */
  updatePresence(chatId: string, user: CollaborationUser): void {
    const key = `${chatId}:${user.id}`;
    const now = Date.now();
    let state = this.throttleState.get(key);

    if (!state) {
      state = { lastUpdate: 0 };
      this.throttleState.set(key, state);
    }

    const elapsed = now - state.lastUpdate;

    if (elapsed >= THROTTLE_INTERVAL_MS) {
      state.lastUpdate = now;
      this.upsertUser(chatId, user);
    } else {
      // Schedule a deferred update
      if (state.pending) clearTimeout(state.pending);
      state.pending = setTimeout(() => {
        state!.lastUpdate = Date.now();
        state!.pending = undefined;
        this.upsertUser(chatId, user);
      }, THROTTLE_INTERVAL_MS - elapsed);
    }
  }

  getPresence(chatId: string): CollaborationUser[] {
    const room = this.rooms.get(chatId);
    if (!room) return [];
    return Array.from(room.values()).filter(
      (u) => u.activityState !== 'OFFLINE',
    );
  }

  removeUser(chatId: string, userId: string): void {
    const room = this.rooms.get(chatId);
    if (!room) return;
    room.delete(userId);
    this.cancelCleanupTimer(`${chatId}:${userId}`);
    this.notify(chatId);
    logger.debug({ chatId, userId }, '[PresenceManager] user removed');
  }

  // ─── Subscribe ────────────────────────────────────────────────────────

  subscribe(chatId: string, callback: () => void): () => void {
    if (!this.subscribers.has(chatId)) {
      this.subscribers.set(chatId, new Set());
    }
    this.subscribers.get(chatId)!.add(callback);
    return () => {
      this.subscribers.get(chatId)?.delete(callback);
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private upsertUser(chatId: string, user: CollaborationUser): void {
    if (!this.rooms.has(chatId)) {
      this.rooms.set(chatId, new Map());
    }
    const room = this.rooms.get(chatId)!;
    const existing = room.get(user.id);
    const merged: CollaborationUser = {
      ...(existing ?? {}),
      ...user,
      lastSeen: Date.now(),
    };
    room.set(user.id, merged);
    this.scheduleCleanup(chatId, user.id);
    this.computeActivityState(chatId, user.id);
    this.notify(chatId);
  }

  private setTyping(userId: string, isTyping: boolean): void {
    for (const [chatId, room] of this.rooms) {
      const user = room.get(userId);
      if (user) {
        room.set(userId, { ...user, isTyping, lastSeen: Date.now() });
        this.scheduleCleanup(chatId, userId);
        this.notify(chatId);
        break;
      }
    }
  }

  private setCursor(userId: string, x: number, y: number): void {
    for (const [chatId, room] of this.rooms) {
      const user = room.get(userId);
      if (user) {
        room.set(userId, { ...user, cursor: { x, y }, lastSeen: Date.now() });
        this.scheduleCleanup(chatId, userId);
        this.notify(chatId);
        break;
      }
    }
  }

  private clearCursor(userId: string): void {
    for (const [chatId, room] of this.rooms) {
      const user = room.get(userId);
      if (user) {
        const { cursor: _cursor, ...rest } = user;
        room.set(userId, { ...rest, lastSeen: Date.now() });
        this.notify(chatId);
        break;
      }
    }
  }

  private computeActivityState(chatId: string, userId: string): void {
    const room = this.rooms.get(chatId);
    if (!room) return;
    const user = room.get(userId);
    if (!user) return;

    const elapsed = Date.now() - user.lastSeen;
    let activityState: ActivityState = 'ACTIVE';
    if (elapsed >= INACTIVITY_TIMEOUT_MS) activityState = 'OFFLINE';
    else if (elapsed >= AWAY_TIMEOUT_MS) activityState = 'AWAY';
    else if (elapsed >= IDLE_TIMEOUT_MS) activityState = 'IDLE';

    if (activityState !== user.activityState) {
      room.set(userId, { ...user, activityState });
      this.notify(chatId);
    }
  }

  private scheduleCleanup(chatId: string, userId: string): void {
    const key = `${chatId}:${userId}`;
    this.cancelCleanupTimer(key);
    this.cleanupTimers.set(
      key,
      setTimeout(() => {
        this.removeUser(chatId, userId);
      }, INACTIVITY_TIMEOUT_MS),
    );
  }

  private cancelCleanupTimer(key: string): void {
    const timer = this.cleanupTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(key);
    }
  }

  private notify(chatId: string): void {
    const set = this.subscribers.get(chatId);
    if (!set) return;
    for (const cb of set) {
      try {
        cb();
      } catch (err) {
        logger.error({ err }, '[PresenceManager] subscriber error');
      }
    }
  }

  destroy(): void {
    for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
    for (const state of this.throttleState.values()) {
      if (state.pending) clearTimeout(state.pending);
    }
    this.cleanupTimers.clear();
    this.throttleState.clear();
    this.rooms.clear();
    this.subscribers.clear();
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const presenceManager = new PresenceManager();

// ─── React Hook ───────────────────────────────────────────────────────────────

export function usePresence(chatId: string): CollaborationUser[] {
  const [users, setUsers] = useState<CollaborationUser[]>(() =>
    presenceManager.getPresence(chatId),
  );
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;

  const refresh = useCallback(() => {
    setUsers(presenceManager.getPresence(chatIdRef.current));
  }, []);

  useEffect(() => {
    // Immediately sync
    setUsers(presenceManager.getPresence(chatId));

    const unsubscribe = presenceManager.subscribe(chatId, refresh);
    return unsubscribe;
  }, [chatId, refresh]);

  return users;
}

// ─── Convenience: useTypingUsers ─────────────────────────────────────────────

export function useTypingUsers(chatId: string): CollaborationUser[] {
  const users = usePresence(chatId);
  return users.filter((u) => u.isTyping);
}
