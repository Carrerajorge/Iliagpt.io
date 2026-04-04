// ============================================================
// Design System – Barrel Export
// ============================================================

// ---------------------------------------------------------------------------
// Token exports
// ---------------------------------------------------------------------------

// Colors
export type {
  ColorShade,
  ColorScale,
  SemanticColors,
  PaletteName,
} from './tokens/colors';
export {
  primary,
  secondary,
  accent,
  success,
  warning,
  error,
  info,
  palettes,
  lightTheme,
  darkTheme,
  getCSSVars,
  contrastRatio,
  meetsAA,
  meetsAAA,
} from './tokens/colors';

// Typography
export type {
  FontSizeKey,
  TypeScale,
  TypeScaleName,
  FontFamily,
} from './tokens/typography';
export {
  fontSizePx,
  pxToRem,
  typeScales,
  typographyTokens,
  fontFamilies,
  fontFamilyString,
  tailwindClasses as typographyTailwindClasses,
  getTypographyCSSVars,
  TypographyToken,
} from './tokens/typography';

// Spacing
export type {
  SpacingKey,
  SemanticSpacing,
  SemanticSpacingKey,
  LayoutTokens,
  BreakpointKey,
} from './tokens/spacing';
export {
  spacingPx,
  spacingRem,
  semanticSpacing,
  layoutTokens,
  breakpoints,
  breakpointPx,
  breakpointRem,
  toRem,
  pxToTailwindUnit,
  mediaQuery,
  spacingToTailwind,
  semanticToTailwind,
  fluidSpacing,
  getSpacingCSSVars,
} from './tokens/spacing';

// Animations
export type {
  DurationKey,
  EasingKey,
  VariantName,
} from './tokens/animations';
export {
  duration,
  durationMs,
  easing,
  transitions,
  // Framer Motion variants
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
  reducedMotion,
  getVariants,
  animateClasses,
  cssTransition,
} from './tokens/animations';

// ---------------------------------------------------------------------------
// Component exports
// ---------------------------------------------------------------------------

// AIStreamText
export { AIStreamText } from './components/AIStreamText';
export type { default as AIStreamTextDefault } from './components/AIStreamText';

// ToolExecutionCard
export { ToolExecutionCard } from './components/ToolExecutionCard';
export type { default as ToolExecutionCardDefault } from './components/ToolExecutionCard';

// AgentStatusPanel
export { AgentStatusPanel } from './components/AgentStatusPanel';
export type { default as AgentStatusPanelDefault } from './components/AgentStatusPanel';

// ModelSelector
export { ModelSelector, MODELS } from './components/ModelSelector';
export type { default as ModelSelectorDefault } from './components/ModelSelector';

// CostIndicator
export { CostIndicator } from './components/CostIndicator';
export type { default as CostIndicatorDefault } from './components/CostIndicator';

// ThemeProvider
export type { ThemeMode, ResolvedMode, ThemeContextValue } from './components/ThemeProvider';
export {
  ThemeProvider,
  ThemeToggle,
  useTheme,
} from './components/ThemeProvider';
