import React, { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTypingUsers } from '@/lib/collaboration/PresenceManager';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_SHOWN_NAMES = 2;

// ─── Dot animation variants ───────────────────────────────────────────────────

const DOT_CONTAINER_VARIANTS = {
  animate: {
    transition: {
      staggerChildren: 0.18,
    },
  },
};

const DOT_VARIANTS = {
  initial: { y: 0, opacity: 0.4 },
  animate: {
    y: [-3, 0, -3],
    opacity: [0.4, 1, 0.4],
    transition: {
      duration: 0.9,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};

// ─── Build label text ─────────────────────────────────────────────────────────

function buildLabel(names: string[], total: number): string {
  if (total === 1) {
    return `${names[0]} is typing`;
  }

  if (total === 2) {
    return `${names[0]} and ${names[1]} are typing`;
  }

  // 3+ people
  if (names.length >= MAX_SHOWN_NAMES) {
    const shownNames = names.slice(0, MAX_SHOWN_NAMES).join(', ');
    const others = total - MAX_SHOWN_NAMES;
    return `${shownNames} and ${others} other${others !== 1 ? 's' : ''} are typing`;
  }

  return `${names.join(', ')} are typing`;
}

// ─── BouncingDots ─────────────────────────────────────────────────────────────

const BouncingDots: React.FC = () => (
  <motion.span
    className="inline-flex items-end gap-[3px] ml-1 mb-0.5"
    variants={DOT_CONTAINER_VARIANTS}
    initial="initial"
    animate="animate"
    aria-hidden="true"
  >
    {[0, 1, 2].map((i) => (
      <motion.span
        key={i}
        className="inline-block w-1 h-1 rounded-full bg-current"
        variants={DOT_VARIANTS}
      />
    ))}
  </motion.span>
);

// ─── TypingIndicator ──────────────────────────────────────────────────────────

interface TypingIndicatorProps {
  chatId: string;
  className?: string;
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({
  chatId,
  className = '',
}) => {
  const typingUsers = useTypingUsers(chatId);

  const label = useMemo(() => {
    if (typingUsers.length === 0) return '';
    const names = typingUsers
      .slice(0, MAX_SHOWN_NAMES)
      .map((u) => u.name.split(' ')[0]); // First name only
    return buildLabel(names, typingUsers.length);
  }, [typingUsers]);

  const isVisible = typingUsers.length > 0;

  return (
    <AnimatePresence mode="wait">
      {isVisible && (
        <motion.div
          key="typing-indicator"
          initial={{ opacity: 0, y: 6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: 6, height: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className={`overflow-hidden ${className}`}
        >
          <motion.div
            className="flex items-center gap-1 px-3 py-1.5 text-xs text-zinc-400 select-none"
            role="status"
            aria-live="polite"
            aria-label={`${label}...`}
          >
            {/* Avatars (small) */}
            <span className="flex -space-x-1 mr-0.5">
              {typingUsers.slice(0, 3).map((user) => (
                <span
                  key={user.id}
                  className="inline-flex items-center justify-center rounded-full text-white font-semibold text-[8px] border border-zinc-900"
                  style={{
                    width: 16,
                    height: 16,
                    backgroundColor: user.color,
                  }}
                  title={user.name}
                >
                  {user.avatar ? (
                    <img
                      src={user.avatar}
                      alt={user.name}
                      className="w-full h-full rounded-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    user.name[0].toUpperCase()
                  )}
                </span>
              ))}
            </span>

            {/* Label */}
            <span className="italic">{label}</span>

            {/* Animated dots */}
            <BouncingDots />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default TypingIndicator;
