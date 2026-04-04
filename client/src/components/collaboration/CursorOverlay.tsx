import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence, useSpring, useTransform } from 'framer-motion';
import { usePresence } from '@/lib/collaboration/PresenceManager';
import { CollaborationUser } from '@/lib/collaboration/CollaborationClient';

// ─── Constants ────────────────────────────────────────────────────────────────

const CURSOR_FADE_MS = 3000;
const SPRING_CONFIG = { stiffness: 280, damping: 30, mass: 0.5 };

// ─── Types ────────────────────────────────────────────────────────────────────

interface CursorPosition {
  x: number;
  y: number;
  userId: string;
  lastMove: number;
}

// ─── Cursor SVG ───────────────────────────────────────────────────────────────

const CursorSVG: React.FC<{ color: string }> = ({ color }) => (
  <svg
    width="18"
    height="22"
    viewBox="0 0 18 22"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
  >
    <path
      d="M0.5 0.5L0.5 17.5L4.5 13.5L7.5 21L10 20L7 13L13 13L0.5 0.5Z"
      fill={color}
      stroke="white"
      strokeWidth="1"
      strokeLinejoin="round"
    />
  </svg>
);

// ─── AnimatedCursor – interpolates a single remote cursor ────────────────────

interface AnimatedCursorProps {
  user: CollaborationUser;
  position: CursorPosition;
}

const AnimatedCursor: React.FC<AnimatedCursorProps> = ({ user, position }) => {
  const springX = useSpring(position.x, SPRING_CONFIG);
  const springY = useSpring(position.y, SPRING_CONFIG);

  // Fade out after CURSOR_FADE_MS of inactivity
  const [isActive, setIsActive] = useState(true);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    springX.set(position.x);
    springY.set(position.y);

    setIsActive(true);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => setIsActive(false), CURSOR_FADE_MS);

    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, [position.x, position.y, springX, springY]);

  const opacity = useTransform(springX, () => (isActive ? 1 : 0));

  return (
    <motion.div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        x: springX,
        y: springY,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
      animate={{ opacity: isActive ? 1 : 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Cursor pointer */}
      <CursorSVG color={user.color} />

      {/* Name badge */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        style={{
          position: 'absolute',
          top: 18,
          left: 12,
          whiteSpace: 'nowrap',
        }}
      >
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white shadow-md select-none"
          style={{ backgroundColor: user.color, letterSpacing: '0.02em' }}
        >
          {user.name}
        </span>
      </motion.div>
    </motion.div>
  );
};

// ─── CursorOverlay ────────────────────────────────────────────────────────────

interface CursorOverlayProps {
  chatId: string;
  /** Optional: constrain to a specific element ref */
  containerRef?: React.RefObject<HTMLElement>;
  className?: string;
}

export const CursorOverlay: React.FC<CursorOverlayProps> = ({
  chatId,
  containerRef,
  className = '',
}) => {
  const users = usePresence(chatId);
  const [positions, setPositions] = useState<Map<string, CursorPosition>>(
    new Map(),
  );

  // Build a map of userId → CollaborationUser for quick lookup
  const userMap = useRef<Map<string, CollaborationUser>>(new Map());
  useEffect(() => {
    userMap.current = new Map(users.map((u) => [u.id, u]));
  }, [users]);

  // Sync positions from presence cursor data
  useEffect(() => {
    setPositions((prev) => {
      const next = new Map(prev);
      let changed = false;

      for (const user of users) {
        if (!user.cursor) continue;
        const existing = prev.get(user.id);
        if (
          !existing ||
          existing.x !== user.cursor.x ||
          existing.y !== user.cursor.y
        ) {
          next.set(user.id, {
            x: user.cursor.x,
            y: user.cursor.y,
            userId: user.id,
            lastMove: Date.now(),
          });
          changed = true;
        }
      }

      // Remove users that no longer have cursors
      for (const [uid] of prev) {
        const u = userMap.current.get(uid);
        if (!u || !u.cursor) {
          next.delete(uid);
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [users]);

  // Overlay container style
  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    overflow: 'hidden',
    zIndex: 100,
  };

  const visibleUsers = users.filter(
    (u) => u.cursor && positions.has(u.id),
  );

  return (
    <div
      className={className}
      style={overlayStyle}
      aria-hidden="true"
    >
      <AnimatePresence>
        {visibleUsers.map((user) => {
          const pos = positions.get(user.id);
          if (!pos) return null;
          return (
            <AnimatedCursor
              key={user.id}
              user={user}
              position={pos}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
};

// ─── Hook: useCursorTracking ──────────────────────────────────────────────────
// Convenience hook to send local cursor position to collaboration client

import { CollaborationClient } from '@/lib/collaboration/CollaborationClient';

const CURSOR_THROTTLE_MS = 50; // ~20fps

export function useCursorTracking(
  client: CollaborationClient | null,
  targetRef: React.RefObject<HTMLElement>,
): void {
  const lastSendRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);

  const flush = useCallback(() => {
    if (!pendingRef.current || !client) return;
    const { x, y } = pendingRef.current;
    client.sendCursorPosition(x, y);
    pendingRef.current = null;
    lastSendRef.current = Date.now();
  }, [client]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el || !client) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      pendingRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      const now = Date.now();
      if (now - lastSendRef.current >= CURSOR_THROTTLE_MS) {
        cancelAnimationFrame(rafRef.current);
        flush();
      } else {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(flush);
      }
    };

    const handleMouseLeave = () => {
      cancelAnimationFrame(rafRef.current);
      pendingRef.current = null;
      client.stopCursor();
    };

    el.addEventListener('mousemove', handleMouseMove, { passive: true });
    el.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      el.removeEventListener('mousemove', handleMouseMove);
      el.removeEventListener('mouseleave', handleMouseLeave);
      cancelAnimationFrame(rafRef.current);
    };
  }, [client, targetRef, flush]);
}

export default CursorOverlay;
