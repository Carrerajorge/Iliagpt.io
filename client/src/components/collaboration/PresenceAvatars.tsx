/**
 * PresenceAvatars.tsx
 * Displays an overlapping avatar stack for active collaborators.
 * Supports tooltip, status dots, color-coded borders, and animated
 * entrance/exit via Framer Motion.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { UserPresence } from "../../lib/collaboration/PresenceManager";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AvatarSize = "sm" | "md" | "lg";

export interface PresenceAvatarsProps {
  /** Array of remote users currently present */
  users: UserPresence[];
  /** Maximum number of avatars to show before "+N" overflow. Default: 5 */
  maxVisible?: number;
  /** Whether to render a tooltip on hover. Default: true */
  showTooltip?: boolean;
  /** Size variant. Default: 'md' */
  size?: AvatarSize;
  /** Extra Tailwind classes for the root container */
  className?: string;
}

// ---------------------------------------------------------------------------
// Size map
// ---------------------------------------------------------------------------

const SIZE_MAP: Record<AvatarSize, { container: string; text: string; dot: string; offset: string }> = {
  sm: {
    container: "h-6 w-6 text-[10px]",
    text: "text-[10px]",
    dot: "h-1.5 w-1.5",
    offset: "-ml-1.5",
  },
  md: {
    container: "h-8 w-8 text-xs",
    text: "text-xs",
    dot: "h-2 w-2",
    offset: "-ml-2",
  },
  lg: {
    container: "h-10 w-10 text-sm",
    text: "text-sm",
    dot: "h-2.5 w-2.5",
    offset: "-ml-2.5",
  },
};

// ---------------------------------------------------------------------------
// Status dot color
// ---------------------------------------------------------------------------

function statusDotClass(status: UserPresence["status"]): string {
  switch (status) {
    case "online":
      return "bg-green-400";
    case "away":
      return "bg-amber-400";
    case "offline":
      return "bg-gray-400";
  }
}

function statusLabel(status: UserPresence["status"]): string {
  switch (status) {
    case "online":
      return "Online";
    case "away":
      return "Away";
    case "offline":
      return "Offline";
  }
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

interface TooltipProps {
  name: string;
  status: UserPresence["status"];
  color: string;
}

const Tooltip: React.FC<TooltipProps> = ({ name, status, color }) => (
  <motion.div
    initial={{ opacity: 0, y: 6, scale: 0.92 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: 4, scale: 0.95 }}
    transition={{ duration: 0.15, ease: "easeOut" }}
    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none"
  >
    <div className="flex items-center gap-1.5 bg-gray-900 text-white text-xs rounded-md px-2.5 py-1.5 shadow-lg whitespace-nowrap">
      {/* Color swatch */}
      <span
        className="inline-block h-2 w-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="font-medium">{name}</span>
      <span className="text-gray-400">·</span>
      <span className="text-gray-400 capitalize">{statusLabel(status)}</span>
    </div>
    {/* Arrow */}
    <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-gray-900" />
  </motion.div>
);

// ---------------------------------------------------------------------------
// Single avatar
// ---------------------------------------------------------------------------

interface AvatarItemProps {
  user: UserPresence;
  size: AvatarSize;
  showTooltip: boolean;
  zIndex: number;
  isFirst: boolean;
  offsetClass: string;
}

const AvatarItem: React.FC<AvatarItemProps> = ({
  user,
  size,
  showTooltip,
  zIndex,
  isFirst,
  offsetClass,
}) => {
  const [hovered, setHovered] = useState(false);
  const sizes = SIZE_MAP[size];

  return (
    <motion.div
      key={user.userId}
      layout
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      className={`relative flex-shrink-0 ${isFirst ? "" : offsetClass}`}
      style={{ zIndex }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Border ring using user color */}
      <div
        className={`${sizes.container} rounded-full p-[2px] cursor-default`}
        style={{ backgroundColor: user.color }}
      >
        <img
          src={user.avatar}
          alt={user.name}
          className="h-full w-full rounded-full object-cover bg-gray-200 select-none"
          draggable={false}
          onError={(e) => {
            // Fallback: hide broken image — the parent bg color still shows
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      </div>

      {/* Status dot */}
      <span
        className={`absolute bottom-0 right-0 ${sizes.dot} rounded-full border-2 border-white dark:border-gray-900 ${statusDotClass(user.status)}`}
      />

      {/* Tooltip */}
      <AnimatePresence>
        {showTooltip && hovered && (
          <Tooltip name={user.name} status={user.status} color={user.color} />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ---------------------------------------------------------------------------
// Overflow badge
// ---------------------------------------------------------------------------

interface OverflowBadgeProps {
  count: number;
  size: AvatarSize;
  offsetClass: string;
  hiddenUsers: UserPresence[];
  showTooltip: boolean;
}

const OverflowBadge: React.FC<OverflowBadgeProps> = ({
  count,
  size,
  offsetClass,
  hiddenUsers,
  showTooltip,
}) => {
  const [hovered, setHovered] = useState(false);
  const sizes = SIZE_MAP[size];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      className={`relative flex-shrink-0 ${offsetClass}`}
      style={{ zIndex: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={`${sizes.container} rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center font-semibold text-gray-600 dark:text-gray-300 cursor-default select-none border-2 border-white dark:border-gray-900`}
      >
        +{count}
      </div>

      {/* Tooltip listing hidden users */}
      <AnimatePresence>
        {showTooltip && hovered && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none"
          >
            <div className="bg-gray-900 text-white text-xs rounded-md px-2.5 py-1.5 shadow-lg whitespace-nowrap space-y-1">
              {hiddenUsers.map((u) => (
                <div key={u.userId} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: u.color }}
                  />
                  <span className="font-medium">{u.name}</span>
                  <span className="text-gray-400 capitalize">{statusLabel(u.status)}</span>
                </div>
              ))}
            </div>
            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-gray-900" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ---------------------------------------------------------------------------
// PresenceAvatars (main export)
// ---------------------------------------------------------------------------

export const PresenceAvatars: React.FC<PresenceAvatarsProps> = ({
  users,
  maxVisible = 5,
  showTooltip = true,
  size = "md",
  className = "",
}) => {
  const sizes = SIZE_MAP[size];

  // Sort: online first, then away, then offline
  const sorted = [...users].sort((a, b) => {
    const order = { online: 0, away: 1, offline: 2 };
    return order[a.status] - order[b.status];
  });

  const visible = sorted.slice(0, maxVisible);
  const hidden = sorted.slice(maxVisible);
  const overflowCount = hidden.length;

  if (users.length === 0) return null;

  return (
    <div className={`flex items-center ${className}`} role="list" aria-label="Active collaborators">
      <AnimatePresence mode="popLayout">
        {visible.map((user, index) => (
          <AvatarItem
            key={user.userId}
            user={user}
            size={size}
            showTooltip={showTooltip}
            zIndex={maxVisible - index}
            isFirst={index === 0}
            offsetClass={sizes.offset}
          />
        ))}

        {overflowCount > 0 && (
          <OverflowBadge
            key="__overflow__"
            count={overflowCount}
            size={size}
            offsetClass={sizes.offset}
            hiddenUsers={hidden}
            showTooltip={showTooltip}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// ---------------------------------------------------------------------------
// usePresenceAvatars hook — convenience for consuming PresenceManager
// ---------------------------------------------------------------------------

import type { PresenceManager } from "../../lib/collaboration/PresenceManager";

export function usePresenceUsers(manager: PresenceManager | null): UserPresence[] {
  const [users, setUsers] = useState<UserPresence[]>([]);

  const handleChange = useCallback((map: Map<string, UserPresence>) => {
    setUsers(Array.from(map.values()));
  }, []);

  useEffect(() => {
    if (!manager) return;
    const unsubscribe = manager.subscribe(handleChange);
    return unsubscribe;
  }, [manager, handleChange]);

  return users;
}

export default PresenceAvatars;
