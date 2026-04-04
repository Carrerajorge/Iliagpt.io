import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { lightTheme, darkTheme, getCSSVars } from '../tokens/colors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThemeMode = 'light' | 'dark' | 'auto';
export type ResolvedMode = 'light' | 'dark';

export interface ThemeContextValue {
  /** The user's explicit preference: light, dark, or auto (follow system). */
  mode: ThemeMode;
  /** The actually-applied theme after resolving 'auto'. */
  resolvedMode: ResolvedMode;
  /** Change the theme preference. */
  setMode: (mode: ThemeMode) => void;
  /** Toggle between light ↔ dark (cycles through light → dark → auto). */
  toggleMode: () => void;
}

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'iliaGPT_theme';

// ---------------------------------------------------------------------------
// CSS variable injection
// ---------------------------------------------------------------------------

function injectCSSVars(resolved: ResolvedMode): void {
  const theme = resolved === 'dark' ? darkTheme : lightTheme;
  const vars  = getCSSVars(theme);

  // Remove existing injected style if present
  const existingId = 'iliaGPT-theme-vars';
  const existing   = document.getElementById(existingId);
  if (existing) existing.remove();

  const el = document.createElement('style');
  el.id          = existingId;
  el.textContent = vars;
  document.head.appendChild(el);
}

// ---------------------------------------------------------------------------
// System preference helper
// ---------------------------------------------------------------------------

function getSystemPreference(): ResolvedMode {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveMode(mode: ThemeMode, system: ResolvedMode): ResolvedMode {
  if (mode === 'auto') return system;
  return mode;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultMode?: ThemeMode;
}

export function ThemeProvider({ children, defaultMode = 'auto' }: ThemeProviderProps) {
  // Read persisted preference
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return defaultMode;
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
    return defaultMode;
  });

  const [systemPref, setSystemPref] = useState<ResolvedMode>(getSystemPreference);

  // Listen to system preference changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq      = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemPref(e.matches ? 'dark' : 'light');
    };

    // Modern API
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }

    // Legacy fallback
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  const resolvedMode: ResolvedMode = useMemo(
    () => resolveMode(mode, systemPref),
    [mode, systemPref],
  );

  // Apply theme to DOM whenever resolved changes
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    root.classList.toggle('dark', resolvedMode === 'dark');
    root.dataset.theme = resolvedMode;

    injectCSSVars(resolvedMode);
  }, [resolvedMode]);

  // Persist preference
  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    try {
      localStorage.setItem(STORAGE_KEY, newMode);
    } catch {
      // Private browsing or storage quota
    }
  }, []);

  const toggleMode = useCallback(() => {
    setMode(
      mode === 'light' ? 'dark'
        : mode === 'dark' ? 'auto'
          : 'light',
    );
  }, [mode, setMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolvedMode, setMode, toggleMode }),
    [mode, resolvedMode, setMode, toggleMode],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Convenience toggle button component (optional, always exported)
// ---------------------------------------------------------------------------

import { Sun, Moon, SunMoon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ThemeToggleProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function ThemeToggle({ className, size = 'md' }: ThemeToggleProps) {
  const { mode, toggleMode } = useTheme();

  const sizeClasses = {
    sm: 'h-7 w-7 text-sm',
    md: 'h-9 w-9',
    lg: 'h-11 w-11 text-lg',
  }[size];

  const Icon =
    mode === 'light' ? Sun
      : mode === 'dark' ? Moon
        : SunMoon;

  const label =
    mode === 'light' ? 'Switch to dark mode'
      : mode === 'dark' ? 'Switch to auto mode'
        : 'Switch to light mode';

  return (
    <button
      onClick={toggleMode}
      aria-label={label}
      title={label}
      className={cn(
        'flex items-center justify-center rounded-lg',
        'border border-slate-200 dark:border-slate-700',
        'bg-white dark:bg-slate-900',
        'hover:bg-slate-50 dark:hover:bg-slate-800',
        'text-slate-600 dark:text-slate-400',
        'transition-colors',
        sizeClasses,
        className,
      )}
    >
      <Icon size={size === 'sm' ? 14 : size === 'lg' ? 20 : 16} />
    </button>
  );
}
