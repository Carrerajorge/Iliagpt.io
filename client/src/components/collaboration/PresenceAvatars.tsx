import React, { useId } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import * as Tooltip from '@radix-ui/react-tooltip';
import { usePresence } from '@/lib/collaboration/PresenceManager';
import { CollaborationUser, ActivityState } from '@/lib/collaboration/CollaborationClient';

// ─── Props ────────────────────────────────────────────────────────────────────

interface PresenceAvatarsProps {
  chatId: string;
  maxVisible?: number;
  className?: string;
}

// ─── Status dot colors ────────────────────────────────────────────────────────

const STATUS_COLOR: Record<ActivityState, string> = {
  ACTIVE: 'bg-emerald-400',
  IDLE: 'bg-yellow-400',
  AWAY: 'bg-orange-400',
  OFFLINE: 'bg-zinc-400',
};

const STATUS_LABEL: Record<ActivityState, string> = {
  ACTIVE: 'Active',
  IDLE: 'Idle',
  AWAY: 'Away',
  OFFLINE: 'Offline',
};

// ─── Avatar helpers ───────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ─── Single Avatar ────────────────────────────────────────────────────────────

interface AvatarProps {
  user: CollaborationUser;
  zIndex: number;
  /** Offset in pixels (negative = overlap) */
  offset: number;
}

const AVATAR_SIZE = 32; // px
const OVERLAP = 8;      // px

const Avatar: React.FC<AvatarProps> = ({ user, zIndex, offset }) => {
  const tooltipText = `${user.name} · ${STATUS_LABEL[user.activityState]}`;

  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <motion.div
            key={user.id}
            initial={{ opacity: 0, scale: 0.5, x: -10 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.5, x: -10 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            style={{
              position: 'absolute',
              left: offset,
              zIndex,
              width: AVATAR_SIZE,
              height: AVATAR_SIZE,
            }}
            className="rounded-full cursor-pointer focus:outline-none"
          >
            {/* Colored ring */}
            <div
              className="rounded-full p-[2px]"
              style={{ backgroundColor: user.color }}
            >
              <div
                className="rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center text-white font-semibold select-none"
                style={{
                  width: AVATAR_SIZE - 4,
                  height: AVATAR_SIZE - 4,
                  fontSize: 11,
                }}
              >
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <span>{getInitials(user.name)}</span>
                )}
              </div>
            </div>

            {/* Status dot */}
            <span
              className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-zinc-900 ${STATUS_COLOR[user.activityState]}`}
              aria-hidden
            />
          </motion.div>
        </Tooltip.Trigger>

        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            sideOffset={6}
            className="z-50 rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs text-white shadow-lg select-none"
          >
            {tooltipText}
            {user.isTyping && (
              <span className="ml-1 text-zinc-400 italic">typing…</span>
            )}
            <Tooltip.Arrow className="fill-zinc-800" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
};

// ─── Overflow Badge ───────────────────────────────────────────────────────────

interface OverflowBadgeProps {
  count: number;
  offset: number;
  zIndex: number;
  names: string[];
}

const OverflowBadge: React.FC<OverflowBadgeProps> = ({
  count,
  offset,
  zIndex,
  names,
}) => {
  const tooltipText = names.join(', ');

  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            style={{
              position: 'absolute',
              left: offset,
              zIndex,
              width: AVATAR_SIZE,
              height: AVATAR_SIZE,
            }}
            className="rounded-full cursor-default focus:outline-none"
          >
            <div className="rounded-full bg-zinc-700 border-2 border-zinc-900 flex items-center justify-center text-white text-[10px] font-bold select-none"
              style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
            >
              +{count}
            </div>
          </motion.div>
        </Tooltip.Trigger>

        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            sideOffset={6}
            className="z-50 rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs text-white shadow-lg max-w-[200px] select-none"
          >
            {tooltipText}
            <Tooltip.Arrow className="fill-zinc-800" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
};

// ─── PresenceAvatars ──────────────────────────────────────────────────────────

export const PresenceAvatars: React.FC<PresenceAvatarsProps> = ({
  chatId,
  maxVisible = 4,
  className = '',
}) => {
  const users = usePresence(chatId);
  const uid = useId();

  if (users.length === 0) return null;

  const visible = users.slice(0, maxVisible);
  const overflow = users.slice(maxVisible);

  // Total width of the stack
  const totalSlots = visible.length + (overflow.length > 0 ? 1 : 0);
  const containerWidth = AVATAR_SIZE + (totalSlots - 1) * (AVATAR_SIZE - OVERLAP);

  return (
    <div
      className={`relative flex items-center ${className}`}
      style={{ width: containerWidth, height: AVATAR_SIZE }}
      aria-label={`${users.length} collaborator${users.length !== 1 ? 's' : ''} online`}
      role="group"
    >
      <AnimatePresence mode="popLayout">
        {visible.map((user, idx) => (
          <Avatar
            key={`${uid}-${user.id}`}
            user={user}
            zIndex={visible.length - idx}
            offset={idx * (AVATAR_SIZE - OVERLAP)}
          />
        ))}

        {overflow.length > 0 && (
          <OverflowBadge
            key={`${uid}-overflow`}
            count={overflow.length}
            offset={visible.length * (AVATAR_SIZE - OVERLAP)}
            zIndex={0}
            names={overflow.map((u) => u.name)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default PresenceAvatars;
