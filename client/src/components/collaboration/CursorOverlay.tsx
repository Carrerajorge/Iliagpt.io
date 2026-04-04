/**
 * CursorOverlay.tsx
 * Renders remote user cursors as colored SVG pointers with animated
 * spring-based movement and inactivity fade-out. Positioned absolutely
 * over the parent chat/editor container.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  createContext,
  useContext,
  useMemo,
} from "react";
import { motion, AnimatePresence, useSpring, useTransform, MotionValue } from "framer-motion";
import type { UserPresence, PresenceManager } from "../../lib/collaboration/PresenceManager";
import type { CollaborationClient, CursorMoveMessage } from "../../lib/collaboration/CollaborationClient";

// ---------------------------------------------------------------------------
// Collaboration context
// ---------------------------------------------------------------------------

interface CollaborationContextValue {
  client: CollaborationClient | null;
  presenceManager: PresenceManager | null;
}

const CollaborationContext = createContext<CollaborationContextValue>({
  client: null,
  presenceManager: null,
});

export const CollaborationProvider: React.FC<{
  client: CollaborationClient | null;
  presenceManager: PresenceManager | null;
  children: React.ReactNode;
}> = ({ client, presenceManager, children }) => {
  const value = useMemo(() => ({ client, presenceManager }), [client, presenceManager]);
  return (
    <CollaborationContext.Provider value={value}>
      {children}
    </CollaborationContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// useCollaboration hook
// ---------------------------------------------------------------------------

export function useCollaboration(): CollaborationContextValue {
  return useContext(CollaborationContext);
}

// ---------------------------------------------------------------------------
// Remote cursor state
// ---------------------------------------------------------------------------

interface RemoteCursorState {
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  lastSeen: number;
}

/** How many ms of inactivity before the cursor starts fading out */
const CURSOR_FADE_AFTER_MS = 3_000;
/** How many ms before a cursor is fully removed */
const CURSOR_REMOVE_AFTER_MS = 8_000;

// ---------------------------------------------------------------------------
// SVG pointer arrow
// ---------------------------------------------------------------------------

const CursorPointer: React.FC<{ color: string }> = ({ color }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: "block" }}
  >
    {/* Drop shadow filter */}
    <defs>
      <filter id="cursor-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#000" floodOpacity="0.25" />
      </filter>
    </defs>
    <path
      d="M3 2L17 10L10 11.5L7 18L3 2Z"
      fill={color}
      stroke="white"
      strokeWidth="1.5"
      strokeLinejoin="round"
      filter="url(#cursor-shadow)"
    />
  </svg>
);

// ---------------------------------------------------------------------------
// Animated cursor for a single user
// ---------------------------------------------------------------------------

interface AnimatedCursorProps {
  cursor: RemoteCursorState;
  now: number;
}

const AnimatedCursor: React.FC<AnimatedCursorProps> = ({ cursor, now }) => {
  const springConfig = { stiffness: 180, damping: 22, mass: 0.6 };

  const springX = useSpring(cursor.x, springConfig);
  const springY = useSpring(cursor.y, springConfig);

  // Update spring targets when position changes
  useEffect(() => {
    springX.set(cursor.x);
    springY.set(cursor.y);
  }, [cursor.x, cursor.y, springX, springY]);

  const silence = now - cursor.lastSeen;
  const opacity = silence > CURSOR_FADE_AFTER_MS ? 0 : 1;

  return (
    <motion.div
      className="absolute top-0 left-0 pointer-events-none select-none"
      style={{ x: springX, y: springY }}
      animate={{ opacity }}
      transition={{ opacity: { duration: 0.6, ease: "easeOut" } }}
    >
      {/* SVG arrow */}
      <CursorPointer color={cursor.color} />

      {/* Name tag */}
      <div
        className="mt-0.5 ml-3.5 px-1.5 py-0.5 rounded text-white text-[11px] font-medium leading-tight whitespace-nowrap shadow-sm"
        style={{ backgroundColor: cursor.color }}
      >
        {cursor.name}
      </div>
    </motion.div>
  );
};

// ---------------------------------------------------------------------------
// useRemoteCursors — subscribes to cursor_move events
// ---------------------------------------------------------------------------

function useRemoteCursors(
  client: CollaborationClient | null,
  presenceManager: PresenceManager | null,
  localUserId: string
): RemoteCursorState[] {
  const [cursors, setCursors] = useState<Map<string, RemoteCursorState>>(new Map());

  const handleCursorMove = useCallback(
    (msg: CursorMoveMessage) => {
      if (msg.senderId === localUserId) return;

      const user = presenceManager?.getUser(msg.senderId);
      const name = user?.name ?? msg.senderId;
      const color = user?.color ?? "#6366F1";

      setCursors((prev) => {
        const next = new Map(prev);
        next.set(msg.senderId, {
          userId: msg.senderId,
          name,
          color,
          x: msg.payload.position.x,
          y: msg.payload.position.y,
          lastSeen: msg.timestamp,
        });
        return next;
      });
    },
    [localUserId, presenceManager]
  );

  // Subscribe to cursor_move events
  useEffect(() => {
    if (!client) return;
    const unsub = client.on("cursor_move", handleCursorMove);
    return unsub;
  }, [client, handleCursorMove]);

  // Prune stale cursors on an interval
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setCursors((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [uid, c] of next.entries()) {
          if (now - c.lastSeen > CURSOR_REMOVE_AFTER_MS) {
            next.delete(uid);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 2_000);
    return () => clearInterval(id);
  }, []);

  // When presence changes, update names/colors in cursor map
  useEffect(() => {
    if (!presenceManager) return;
    const unsub = presenceManager.subscribe((users) => {
      setCursors((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [uid, cursor] of next.entries()) {
          const user = users.get(uid);
          if (!user) continue;
          if (user.name !== cursor.name || user.color !== cursor.color) {
            next.set(uid, { ...cursor, name: user.name, color: user.color });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    return unsub;
  }, [presenceManager]);

  return useMemo(() => Array.from(cursors.values()), [cursors]);
}

// ---------------------------------------------------------------------------
// CursorOverlay (main export)
// ---------------------------------------------------------------------------

export interface CursorOverlayProps {
  /** The local user's ID — their own cursor is never shown */
  localUserId: string;
  /** Extra Tailwind classes applied to the overlay container */
  className?: string;
  /**
   * If true, the component also broadcasts the local user's mouse position.
   * Requires CollaborationProvider to be present in the tree.
   * Default: true
   */
  broadcastLocalCursor?: boolean;
  /** Throttle interval (ms) for outgoing cursor_move messages. Default: 50 */
  broadcastThrottleMs?: number;
}

export const CursorOverlay: React.FC<CursorOverlayProps> = ({
  localUserId,
  className = "",
  broadcastLocalCursor = true,
  broadcastThrottleMs = 50,
}) => {
  const { client, presenceManager } = useCollaboration();
  const overlayRef = useRef<HTMLDivElement>(null);
  const lastBroadcast = useRef<number>(0);
  const [now, setNow] = useState<number>(Date.now());

  // Tick "now" every 500 ms so fade animations update
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  // Broadcast local cursor position
  useEffect(() => {
    if (!broadcastLocalCursor || !client) return;

    const container = overlayRef.current?.parentElement;
    if (!container) return;

    const handleMouseMove = (e: MouseEvent) => {
      const elapsed = Date.now() - lastBroadcast.current;
      if (elapsed < broadcastThrottleMs) return;
      lastBroadcast.current = Date.now();

      const rect = container.getBoundingClientRect();
      client.sendCursorMove({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        containerId: container.id || undefined,
      });
    };

    container.addEventListener("mousemove", handleMouseMove);
    return () => container.removeEventListener("mousemove", handleMouseMove);
  }, [client, broadcastLocalCursor, broadcastThrottleMs]);

  const cursors = useRemoteCursors(client, presenceManager, localUserId);

  return (
    <div
      ref={overlayRef}
      className={`absolute inset-0 overflow-hidden pointer-events-none z-40 ${className}`}
      aria-hidden="true"
    >
      <AnimatePresence>
        {cursors.map((cursor) => (
          <AnimatedCursor key={cursor.userId} cursor={cursor} now={now} />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default CursorOverlay;
