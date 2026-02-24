/**
 * Advanced UX/UI Module v4.0
 * Improvements 701-800: UX/UI
 * 
 * 701-720: Responsive Design
 * 721-740: Theming
 * 741-760: Microinteractions
 * 761-780: Feedback & Help
 * 781-800: Search UI
 */

// ============================================
// TYPES
// ============================================

export interface Breakpoint {
  name: string;
  minWidth: number;
  maxWidth?: number;
}

export interface Theme {
  name: string;
  colors: ThemeColors;
  fonts: ThemeFonts;
  spacing: ThemeSpacing;
  shadows: ThemeShadows;
  borderRadius: ThemeBorderRadius;
}

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  success: string;
  warning: string;
  error: string;
  info: string;
}

export interface ThemeFonts {
  heading: string;
  body: string;
  mono: string;
  sizeBase: number;
  lineHeight: number;
}

export interface ThemeSpacing {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
}

export interface ThemeShadows {
  sm: string;
  md: string;
  lg: string;
  xl: string;
}

export interface ThemeBorderRadius {
  sm: string;
  md: string;
  lg: string;
  full: string;
}

export interface Animation {
  name: string;
  duration: number;
  easing: string;
  keyframes: string;
}

export interface ToastMessage {
  id: string;
  type: "success" | "error" | "warning" | "info";
  message: string;
  duration?: number;
  dismissible?: boolean;
}

// ============================================
// 701-720: RESPONSIVE DESIGN
// ============================================

// 701-705. Breakpoints
export const BREAKPOINTS: Breakpoint[] = [
  { name: "xs", minWidth: 0, maxWidth: 575 },
  { name: "sm", minWidth: 576, maxWidth: 767 },
  { name: "md", minWidth: 768, maxWidth: 991 },
  { name: "lg", minWidth: 992, maxWidth: 1199 },
  { name: "xl", minWidth: 1200, maxWidth: 1399 },
  { name: "xxl", minWidth: 1400 }
];

export function getBreakpoint(width: number): string {
  for (let i = BREAKPOINTS.length - 1; i >= 0; i--) {
    if (width >= BREAKPOINTS[i].minWidth) {
      return BREAKPOINTS[i].name;
    }
  }
  return "xs";
}

// 708. Fluid grid system
export function generateGridCSS(columns = 12, gutter = 16): string {
  let css = `
.grid {
  display: grid;
  gap: ${gutter}px;
}

.grid-cols-1 { grid-template-columns: repeat(1, 1fr); }
.grid-cols-2 { grid-template-columns: repeat(2, 1fr); }
.grid-cols-3 { grid-template-columns: repeat(3, 1fr); }
.grid-cols-4 { grid-template-columns: repeat(4, 1fr); }
.grid-cols-6 { grid-template-columns: repeat(6, 1fr); }
.grid-cols-${columns} { grid-template-columns: repeat(${columns}, 1fr); }
`;

  // Responsive grid
  for (const bp of BREAKPOINTS) {
    if (bp.maxWidth) {
      css += `
@media (max-width: ${bp.maxWidth}px) {
  .${bp.name}\\:grid-cols-1 { grid-template-columns: repeat(1, 1fr); }
  .${bp.name}\\:grid-cols-2 { grid-template-columns: repeat(2, 1fr); }
  .${bp.name}\\:grid-cols-3 { grid-template-columns: repeat(3, 1fr); }
}
`;
    }
  }

  return css;
}

// 709. Fluid typography
export function generateFluidTypography(minSize = 14, maxSize = 18, minWidth = 320, maxWidth = 1200): string {
  const slope = (maxSize - minSize) / (maxWidth - minWidth);
  const yAxisIntersection = -minWidth * slope + minSize;
  
  return `
:root {
  --fluid-type-min: ${minSize}px;
  --fluid-type-max: ${maxSize}px;
  --fluid-type: clamp(
    var(--fluid-type-min),
    ${yAxisIntersection.toFixed(4)}rem + ${(slope * 100).toFixed(4)}vw,
    var(--fluid-type-max)
  );
}

body {
  font-size: var(--fluid-type);
}
`;
}

// 710-712. Responsive media
export function generateResponsiveImageCSS(): string {
  return `
.responsive-image {
  max-width: 100%;
  height: auto;
  display: block;
}

.responsive-video {
  position: relative;
  padding-bottom: 56.25%; /* 16:9 */
  height: 0;
  overflow: hidden;
}

.responsive-video iframe,
.responsive-video video {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.responsive-table {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
`;
}

// 713-720. Mobile-specific
export function generateMobileCSS(): string {
  return `
/* Touch targets */
.touch-target {
  min-height: 44px;
  min-width: 44px;
  padding: 12px;
}

/* Swipe area */
.swipeable {
  touch-action: pan-y;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
}

.swipeable > * {
  scroll-snap-align: start;
}

/* Pull to refresh indicator */
.pull-indicator {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%) translateY(-100%);
  transition: transform 0.2s;
}

.pull-indicator.active {
  transform: translateX(-50%) translateY(0);
}

/* Bottom navigation */
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-around;
  padding: 8px 0;
  padding-bottom: env(safe-area-inset-bottom, 8px);
  background: var(--surface);
  border-top: 1px solid var(--border);
  z-index: 100;
}

/* Mobile hamburger menu */
.hamburger {
  display: none;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  cursor: pointer;
}

.hamburger span {
  display: block;
  width: 24px;
  height: 2px;
  background: var(--text);
  transition: all 0.3s;
}

@media (max-width: 767px) {
  .hamburger { display: flex; }
  .desktop-nav { display: none; }
}
`;
}

// ============================================
// 721-740: THEMING
// ============================================

// 721-722. Light and dark themes
export const LIGHT_THEME: Theme = {
  name: "light",
  colors: {
    primary: "#2563eb",
    secondary: "#7c3aed",
    accent: "#f59e0b",
    background: "#ffffff",
    surface: "#f8fafc",
    text: "#0f172a",
    textSecondary: "#64748b",
    border: "#e2e8f0",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
    info: "#3b82f6"
  },
  fonts: {
    heading: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    body: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', monospace",
    sizeBase: 16,
    lineHeight: 1.6
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  shadows: {
    sm: "0 1px 2px rgba(0,0,0,0.05)",
    md: "0 4px 6px rgba(0,0,0,0.1)",
    lg: "0 10px 15px rgba(0,0,0,0.1)",
    xl: "0 25px 50px rgba(0,0,0,0.15)"
  },
  borderRadius: { sm: "4px", md: "8px", lg: "12px", full: "9999px" }
};

export const DARK_THEME: Theme = {
  name: "dark",
  colors: {
    primary: "#3b82f6",
    secondary: "#8b5cf6",
    accent: "#fbbf24",
    background: "#0f172a",
    surface: "#1e293b",
    text: "#f1f5f9",
    textSecondary: "#94a3b8",
    border: "#334155",
    success: "#22c55e",
    warning: "#fbbf24",
    error: "#f87171",
    info: "#60a5fa"
  },
  fonts: LIGHT_THEME.fonts,
  spacing: LIGHT_THEME.spacing,
  shadows: {
    sm: "0 1px 2px rgba(0,0,0,0.3)",
    md: "0 4px 6px rgba(0,0,0,0.4)",
    lg: "0 10px 15px rgba(0,0,0,0.4)",
    xl: "0 25px 50px rgba(0,0,0,0.5)"
  },
  borderRadius: LIGHT_THEME.borderRadius
};

// 723. System preference sync
export function generateThemeCSS(theme: Theme): string {
  return `
:root {
  --color-primary: ${theme.colors.primary};
  --color-secondary: ${theme.colors.secondary};
  --color-accent: ${theme.colors.accent};
  --color-background: ${theme.colors.background};
  --color-surface: ${theme.colors.surface};
  --color-text: ${theme.colors.text};
  --color-text-secondary: ${theme.colors.textSecondary};
  --color-border: ${theme.colors.border};
  --color-success: ${theme.colors.success};
  --color-warning: ${theme.colors.warning};
  --color-error: ${theme.colors.error};
  --color-info: ${theme.colors.info};
  
  --font-heading: ${theme.fonts.heading};
  --font-body: ${theme.fonts.body};
  --font-mono: ${theme.fonts.mono};
  --font-size-base: ${theme.fonts.sizeBase}px;
  --line-height: ${theme.fonts.lineHeight};
  
  --spacing-xs: ${theme.spacing.xs}px;
  --spacing-sm: ${theme.spacing.sm}px;
  --spacing-md: ${theme.spacing.md}px;
  --spacing-lg: ${theme.spacing.lg}px;
  --spacing-xl: ${theme.spacing.xl}px;
  --spacing-xxl: ${theme.spacing.xxl}px;
  
  --shadow-sm: ${theme.shadows.sm};
  --shadow-md: ${theme.shadows.md};
  --shadow-lg: ${theme.shadows.lg};
  --shadow-xl: ${theme.shadows.xl};
  
  --radius-sm: ${theme.borderRadius.sm};
  --radius-md: ${theme.borderRadius.md};
  --radius-lg: ${theme.borderRadius.lg};
  --radius-full: ${theme.borderRadius.full};
}

body {
  background-color: var(--color-background);
  color: var(--color-text);
  font-family: var(--font-body);
  font-size: var(--font-size-base);
  line-height: var(--line-height);
}
`;
}

// 726-729. Mode variants
export function generateModeCSS(): string {
  return `
/* Compact mode */
.mode-compact {
  --spacing-sm: 4px;
  --spacing-md: 8px;
  --spacing-lg: 12px;
  --font-size-base: 14px;
}

/* Comfortable mode */
.mode-comfortable {
  --spacing-sm: 12px;
  --spacing-md: 20px;
  --spacing-lg: 28px;
  --font-size-base: 16px;
}

/* Focus mode */
.mode-focus main > *:not(.focus-target) {
  opacity: 0.5;
  filter: blur(1px);
  transition: all 0.3s;
}

.mode-focus main > *:not(.focus-target):hover {
  opacity: 1;
  filter: none;
}

/* Reading mode */
.mode-reading {
  --font-size-base: 18px;
  --line-height: 1.8;
}

.mode-reading main {
  max-width: 65ch;
  margin: 0 auto;
}

/* High contrast mode */
.mode-high-contrast {
  --color-text: #000000;
  --color-background: #ffffff;
  --color-border: #000000;
}

.mode-high-contrast * {
  border-color: #000000 !important;
}
`;
}

// ============================================
// 741-760: MICROINTERACTIONS
// ============================================

// 741-760. Animation definitions
export const ANIMATIONS: Animation[] = [
  {
    name: "fadeIn",
    duration: 300,
    easing: "ease-out",
    keyframes: `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
    `
  },
  {
    name: "fadeOut",
    duration: 300,
    easing: "ease-in",
    keyframes: `
      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }
    `
  },
  {
    name: "slideUp",
    duration: 300,
    easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    keyframes: `
      @keyframes slideUp {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `
  },
  {
    name: "slideDown",
    duration: 300,
    easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    keyframes: `
      @keyframes slideDown {
        from { transform: translateY(-20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `
  },
  {
    name: "scaleIn",
    duration: 200,
    easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    keyframes: `
      @keyframes scaleIn {
        from { transform: scale(0.9); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }
    `
  },
  {
    name: "bounce",
    duration: 500,
    easing: "cubic-bezier(0.68, -0.55, 0.265, 1.55)",
    keyframes: `
      @keyframes bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
      }
    `
  },
  {
    name: "pulse",
    duration: 1000,
    easing: "ease-in-out",
    keyframes: `
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    `
  },
  {
    name: "shake",
    duration: 500,
    easing: "ease-in-out",
    keyframes: `
      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
      }
    `
  },
  {
    name: "ripple",
    duration: 600,
    easing: "ease-out",
    keyframes: `
      @keyframes ripple {
        from { transform: scale(0); opacity: 1; }
        to { transform: scale(4); opacity: 0; }
      }
    `
  },
  {
    name: "spin",
    duration: 1000,
    easing: "linear",
    keyframes: `
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `
  },
  {
    name: "shimmer",
    duration: 2000,
    easing: "linear",
    keyframes: `
      @keyframes shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
    `
  }
];

export function generateAnimationCSS(): string {
  let css = ANIMATIONS.map(a => a.keyframes).join("\n\n");
  
  css += `\n\n/* Animation utilities */\n`;
  
  for (const anim of ANIMATIONS) {
    css += `.animate-${anim.name} { animation: ${anim.name} ${anim.duration}ms ${anim.easing}; }\n`;
  }
  
  css += `
/* Transition utilities */
.transition { transition: all 0.3s ease; }
.transition-fast { transition: all 0.15s ease; }
.transition-slow { transition: all 0.5s ease; }

/* Hover effects */
.hover-lift:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
.hover-glow:hover { box-shadow: 0 0 20px var(--color-primary); }
.hover-scale:hover { transform: scale(1.05); }

/* Skeleton loading */
.skeleton {
  background: linear-gradient(90deg, var(--color-surface) 25%, var(--color-border) 50%, var(--color-surface) 75%);
  background-size: 200% 100%;
  animation: shimmer 2s infinite linear;
}

/* Ripple effect */
.ripple {
  position: relative;
  overflow: hidden;
}

.ripple::after {
  content: "";
  position: absolute;
  border-radius: 50%;
  background: rgba(255,255,255,0.3);
  transform: scale(0);
  pointer-events: none;
}

.ripple:active::after {
  animation: ripple 0.6s ease-out;
}
`;

  return css;
}

// ============================================
// 761-780: FEEDBACK & HELP
// ============================================

// 761-768. Notification system
export function createToast(
  type: ToastMessage["type"],
  message: string,
  duration = 5000
): ToastMessage {
  return {
    id: `toast_${Date.now()}`,
    type,
    message,
    duration,
    dismissible: true
  };
}

export function generateToastCSS(): string {
  return `
.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.toast {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
  animation: slideDown 0.3s ease-out;
  max-width: 400px;
}

.toast-success { border-left: 4px solid var(--color-success); }
.toast-error { border-left: 4px solid var(--color-error); }
.toast-warning { border-left: 4px solid var(--color-warning); }
.toast-info { border-left: 4px solid var(--color-info); }

.toast-icon {
  font-size: 20px;
}

.toast-message {
  flex: 1;
  font-size: 14px;
}

.toast-dismiss {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  opacity: 0.5;
  transition: opacity 0.2s;
}

.toast-dismiss:hover {
  opacity: 1;
}

.toast.exiting {
  animation: fadeOut 0.3s ease-in forwards;
}
`;
}

// 772-775. Help system
export interface HelpTip {
  id: string;
  target: string;
  title: string;
  content: string;
  position: "top" | "bottom" | "left" | "right";
}

export function generateTooltipCSS(): string {
  return `
.tooltip {
  position: relative;
  display: inline-block;
}

.tooltip-content {
  visibility: hidden;
  opacity: 0;
  position: absolute;
  z-index: 1000;
  padding: 8px 12px;
  background: var(--color-text);
  color: var(--color-background);
  border-radius: var(--radius-sm);
  font-size: 12px;
  white-space: nowrap;
  transition: opacity 0.2s, visibility 0.2s;
}

.tooltip:hover .tooltip-content {
  visibility: visible;
  opacity: 1;
}

.tooltip-top .tooltip-content { bottom: 100%; left: 50%; transform: translateX(-50%) translateY(-8px); }
.tooltip-bottom .tooltip-content { top: 100%; left: 50%; transform: translateX(-50%) translateY(8px); }
.tooltip-left .tooltip-content { right: 100%; top: 50%; transform: translateY(-50%) translateX(-8px); }
.tooltip-right .tooltip-content { left: 100%; top: 50%; transform: translateY(-50%) translateX(8px); }

/* Arrow */
.tooltip-content::after {
  content: "";
  position: absolute;
  border: 5px solid transparent;
}

.tooltip-top .tooltip-content::after {
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border-top-color: var(--color-text);
}
`;
}

// 776-780. Empty and error states
export interface StateConfig {
  icon: string;
  title: string;
  description: string;
  action?: { label: string; href?: string };
}

export const EMPTY_STATES: Record<string, StateConfig> = {
  noResults: {
    icon: "🔍",
    title: "No results found",
    description: "Try adjusting your search terms or filters",
    action: { label: "Clear filters" }
  },
  noData: {
    icon: "📭",
    title: "No data yet",
    description: "Start by adding some items",
    action: { label: "Add first item" }
  },
  offline: {
    icon: "📡",
    title: "You're offline",
    description: "Check your internet connection and try again",
    action: { label: "Retry" }
  },
  error: {
    icon: "⚠️",
    title: "Something went wrong",
    description: "We're working on fixing this. Please try again later.",
    action: { label: "Retry" }
  },
  maintenance: {
    icon: "🔧",
    title: "Under maintenance",
    description: "We'll be back shortly. Thanks for your patience!",
  }
};

export function generateEmptyStateHTML(state: StateConfig): string {
  return `
<div class="empty-state">
  <div class="empty-state-icon">${state.icon}</div>
  <h3 class="empty-state-title">${state.title}</h3>
  <p class="empty-state-description">${state.description}</p>
  ${state.action ? `
    <button class="empty-state-action"${state.action.href ? ` onclick="window.location='${state.action.href}'"` : ""}>
      ${state.action.label}
    </button>
  ` : ""}
</div>
`;
}

// ============================================
// 781-800: SEARCH UI
// ============================================

// 781-790. Search bar components
export function generateSearchBarCSS(): string {
  return `
.search-container {
  position: relative;
  max-width: 600px;
  margin: 0 auto;
}

.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.search-input {
  width: 100%;
  padding: 12px 16px 12px 44px;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-lg);
  font-size: 16px;
  background: var(--color-surface);
  color: var(--color-text);
  transition: all 0.2s;
}

.search-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.search-icon {
  position: absolute;
  left: 14px;
  color: var(--color-text-secondary);
  pointer-events: none;
}

.search-clear {
  position: absolute;
  right: 44px;
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 8px;
  opacity: 0;
  transition: opacity 0.2s;
}

.search-input:not(:placeholder-shown) ~ .search-clear {
  opacity: 1;
}

.search-submit {
  position: absolute;
  right: 6px;
  padding: 8px 16px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.2s;
}

.search-submit:hover {
  background: var(--color-secondary);
}

/* Suggestions dropdown */
.search-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  max-height: 300px;
  overflow-y: auto;
  z-index: 100;
}

.suggestion-item {
  padding: 10px 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: background 0.15s;
}

.suggestion-item:hover,
.suggestion-item.selected {
  background: var(--color-border);
}

.suggestion-icon {
  color: var(--color-text-secondary);
  font-size: 14px;
}

.suggestion-text {
  flex: 1;
}

.suggestion-type {
  font-size: 12px;
  color: var(--color-text-secondary);
}

/* Recent searches */
.recent-searches {
  padding: 8px 0;
}

.recent-header {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 500;
}

/* Search filters */
.search-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.filter-chip:hover {
  border-color: var(--color-primary);
}

.filter-chip.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.filter-chip-remove {
  background: none;
  border: none;
  padding: 0;
  margin-left: 4px;
  cursor: pointer;
  opacity: 0.7;
}

/* Results count */
.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
  border-bottom: 1px solid var(--color-border);
}

.results-count {
  font-size: 14px;
  color: var(--color-text-secondary);
}

.results-sort {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sort-select {
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 13px;
}
`;
}

// 795-800. Search state management
export interface SearchState {
  query: string;
  filters: Record<string, any>;
  sort: string;
  page: number;
  resultsPerPage: number;
  suggestions: string[];
  recentSearches: string[];
  isLoading: boolean;
  hasResults: boolean;
}

export function createInitialSearchState(): SearchState {
  return {
    query: "",
    filters: {},
    sort: "relevance",
    page: 1,
    resultsPerPage: 20,
    suggestions: [],
    recentSearches: [],
    isLoading: false,
    hasResults: false
  };
}

export function generateSearchBreadcrumbsHTML(state: SearchState): string {
  const parts: string[] = [];
  
  if (state.query) {
    parts.push(`<span class="breadcrumb-item">Search: "${state.query}"</span>`);
  }
  
  for (const [key, value] of Object.entries(state.filters)) {
    if (value) {
      parts.push(`<span class="breadcrumb-item">${key}: ${value}</span>`);
    }
  }
  
  return `<div class="search-breadcrumbs">${parts.join('<span class="breadcrumb-separator">/</span>')}</div>`;
}
