// ============================================================
// Design System – Animation Tokens
// ============================================================

import type { Variants, Transition } from 'framer-motion';

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

export const duration = {
  instant: 0,
  fast:    0.15,  // 150ms
  normal:  0.25,  // 250ms
  slow:    0.4,   // 400ms
  slower:  0.6,   // 600ms
} as const;

export type DurationKey = keyof typeof duration;

// CSS ms values for non-Framer contexts
export const durationMs: Record<DurationKey, string> = {
  instant: '0ms',
  fast:    '150ms',
  normal:  '250ms',
  slow:    '400ms',
  slower:  '600ms',
};

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

export const easing = {
  easeIn:    'cubic-bezier(0.4, 0, 1, 1)',
  easeOut:   'cubic-bezier(0, 0, 0.2, 1)',
  easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  spring:    'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  bounce:    'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

export type EasingKey = keyof typeof easing;

// Framer Motion transition presets
export const transitions: Record<EasingKey, Transition> = {
  easeIn:    { ease: [0.4, 0, 1, 1],           duration: duration.normal },
  easeOut:   { ease: [0, 0, 0.2, 1],           duration: duration.normal },
  easeInOut: { ease: [0.4, 0, 0.2, 1],         duration: duration.normal },
  spring:    { type: 'spring', stiffness: 400, damping: 25 },
  bounce:    { type: 'spring', stiffness: 500, damping: 20, mass: 0.8 },
};

// ---------------------------------------------------------------------------
// Framer Motion variants
// ---------------------------------------------------------------------------

export const fadeIn: Variants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.normal, ease: [0, 0, 0.2, 1] } },
  exit:    { opacity: 0, transition: { duration: duration.fast,   ease: [0.4, 0, 1, 1] } },
};

export const fadeOut: Variants = {
  hidden:  { opacity: 1 },
  visible: { opacity: 0, transition: { duration: duration.normal, ease: [0.4, 0, 1, 1] } },
};

export const slideInUp: Variants = {
  hidden:  { opacity: 0, y: 16 },
  visible: {
    opacity: 1, y: 0,
    transition: { duration: duration.normal, ease: [0, 0, 0.2, 1] },
  },
  exit: {
    opacity: 0, y: 8,
    transition: { duration: duration.fast, ease: [0.4, 0, 1, 1] },
  },
};

export const slideInDown: Variants = {
  hidden:  { opacity: 0, y: -16 },
  visible: {
    opacity: 1, y: 0,
    transition: { duration: duration.normal, ease: [0, 0, 0.2, 1] },
  },
  exit: {
    opacity: 0, y: -8,
    transition: { duration: duration.fast, ease: [0.4, 0, 1, 1] },
  },
};

export const slideInLeft: Variants = {
  hidden:  { opacity: 0, x: -24 },
  visible: {
    opacity: 1, x: 0,
    transition: { duration: duration.normal, ease: [0, 0, 0.2, 1] },
  },
  exit: {
    opacity: 0, x: -12,
    transition: { duration: duration.fast, ease: [0.4, 0, 1, 1] },
  },
};

export const slideInRight: Variants = {
  hidden:  { opacity: 0, x: 24 },
  visible: {
    opacity: 1, x: 0,
    transition: { duration: duration.normal, ease: [0, 0, 0.2, 1] },
  },
  exit: {
    opacity: 0, x: 12,
    transition: { duration: duration.fast, ease: [0.4, 0, 1, 1] },
  },
};

export const scaleIn: Variants = {
  hidden:  { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1, scale: 1,
    transition: { duration: duration.normal, ease: [0, 0, 0.2, 1] },
  },
  exit: {
    opacity: 0, scale: 0.96,
    transition: { duration: duration.fast, ease: [0.4, 0, 1, 1] },
  },
};

export const scaleOut: Variants = {
  hidden:  { opacity: 1, scale: 1 },
  visible: {
    opacity: 0, scale: 0.92,
    transition: { duration: duration.normal, ease: [0.4, 0, 1, 1] },
  },
};

export const popIn: Variants = {
  hidden:  { opacity: 0, scale: 0.8 },
  visible: {
    opacity: 1, scale: 1,
    transition: {
      type: 'spring',
      stiffness: 500,
      damping: 20,
      mass: 0.8,
    },
  },
  exit: {
    opacity: 0, scale: 0.9,
    transition: { duration: duration.fast, ease: [0.4, 0, 1, 1] },
  },
};

export const staggerContainer: Variants = {
  hidden:  { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren:  0.05,
      delayChildren:    0.02,
      when: 'beforeChildren',
    },
  },
  exit: {
    opacity: 0,
    transition: { staggerChildren: 0.03, staggerDirection: -1 },
  },
};

export const listItem: Variants = {
  hidden:  { opacity: 0, y: 8 },
  visible: {
    opacity: 1, y: 0,
    transition: { duration: duration.fast, ease: [0, 0, 0.2, 1] },
  },
  exit: {
    opacity: 0, y: -4,
    transition: { duration: duration.fast, ease: [0.4, 0, 1, 1] },
  },
};

// ---------------------------------------------------------------------------
// Reduced-motion safe variants
// ---------------------------------------------------------------------------

/** All transitions run at 0 duration (instant) for reduced-motion preference. */
const instantTransition: Transition = { duration: 0 };

function instantify(variants: Variants): Variants {
  const result: Variants = {};
  for (const [key, value] of Object.entries(variants)) {
    if (typeof value === 'object' && value !== null) {
      result[key] = { ...value, transition: instantTransition };
    } else {
      result[key] = value;
    }
  }
  return result;
}

export const reducedMotion = {
  fadeIn:          instantify(fadeIn),
  fadeOut:         instantify(fadeOut),
  slideInUp:       instantify(slideInUp),
  slideInDown:     instantify(slideInDown),
  slideInLeft:     instantify(slideInLeft),
  slideInRight:    instantify(slideInRight),
  scaleIn:         instantify(scaleIn),
  scaleOut:        instantify(scaleOut),
  popIn:           instantify(popIn),
  staggerContainer:instantify(staggerContainer),
  listItem:        instantify(listItem),
};

// ---------------------------------------------------------------------------
// Variant registry
// ---------------------------------------------------------------------------

export type VariantName =
  | 'fadeIn' | 'fadeOut'
  | 'slideInUp' | 'slideInDown' | 'slideInLeft' | 'slideInRight'
  | 'scaleIn' | 'scaleOut' | 'popIn'
  | 'staggerContainer' | 'listItem';

const variantMap: Record<VariantName, Variants> = {
  fadeIn,
  fadeOut,
  slideInUp,
  slideInDown,
  slideInLeft,
  slideInRight,
  scaleIn,
  scaleOut,
  popIn,
  staggerContainer,
  listItem,
};

/**
 * Returns the appropriate Framer Motion variant set for a given name.
 * Automatically returns reduced-motion-safe variants when the user
 * has `prefers-reduced-motion: reduce` set.
 */
export function getVariants(name: VariantName): Variants {
  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (prefersReduced) {
    return reducedMotion[name];
  }

  return variantMap[name];
}

// ---------------------------------------------------------------------------
// CSS animation helpers
// ---------------------------------------------------------------------------

/** Tailwind animate class names for common animations. */
export const animateClasses = {
  spin:    'animate-spin',
  ping:    'animate-ping',
  pulse:   'animate-pulse',
  bounce:  'animate-bounce',
  fadeIn:  'animate-fade-in',
  fadeOut: 'animate-fade-out',
} as const;

/** Returns a CSS transition shorthand string. */
export function cssTransition(
  property = 'all',
  dur: DurationKey = 'normal',
  ease: EasingKey = 'easeInOut',
): string {
  return `${property} ${durationMs[dur]} ${easing[ease]}`;
}
