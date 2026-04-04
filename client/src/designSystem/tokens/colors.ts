/**
 * Design System Color Tokens
 *
 * WCAG AA requires:
 *   - Normal text (< 18pt / < 14pt bold): contrast ratio >= 4.5:1
 *   - Large text (>= 18pt / >= 14pt bold): contrast ratio >= 3:1
 *   - UI components / graphical objects: contrast ratio >= 3:1
 *
 * All semantic text tokens documented with their contrast ratio against
 * their intended background.
 */

// ---------------------------------------------------------------------------
// Raw color scales
// ---------------------------------------------------------------------------

/** Purple brand scale — primary AI assistant identity */
export const purple = {
  50: "#f5f3ff",
  100: "#ede9fe",
  200: "#ddd6fe",
  300: "#c4b5fd",
  400: "#a78bfa",
  500: "#8b5cf6",
  600: "#7c3aed",
  700: "#6d28d9",
  800: "#5b21b6",
  900: "#4c1d95",
  950: "#2e1065",
} as const;

/** Blue accent scale */
export const blue = {
  50: "#eff6ff",
  100: "#dbeafe",
  200: "#bfdbfe",
  300: "#93c5fd",
  400: "#60a5fa",
  500: "#3b82f6",
  600: "#2563eb",
  700: "#1d4ed8",
  800: "#1e40af",
  900: "#1e3a8a",
  950: "#172554",
} as const;

/** Neutral gray scale */
export const gray = {
  0: "#ffffff",
  50: "#f9fafb",
  100: "#f3f4f6",
  150: "#eceef1",
  200: "#e5e7eb",
  300: "#d1d5db",
  400: "#9ca3af",
  500: "#6b7280",
  600: "#4b5563",
  700: "#374151",
  750: "#2d3748",
  800: "#1f2937",
  850: "#18202e",
  900: "#111827",
  950: "#0d1117",
  1000: "#000000",
} as const;

/** Semantic — success (green) */
export const green = {
  50: "#f0fdf4",
  100: "#dcfce7",
  200: "#bbf7d0",
  300: "#86efac",
  400: "#4ade80",
  500: "#22c55e",
  600: "#16a34a",
  700: "#15803d",
  800: "#166534",
  900: "#14532d",
  950: "#052e16",
} as const;

/** Semantic — warning (amber) */
export const amber = {
  50: "#fffbeb",
  100: "#fef3c7",
  200: "#fde68a",
  300: "#fcd34d",
  400: "#fbbf24",
  500: "#f59e0b",
  600: "#d97706",
  700: "#b45309",
  800: "#92400e",
  900: "#78350f",
  950: "#451a03",
} as const;

/** Semantic — error (red) */
export const red = {
  50: "#fef2f2",
  100: "#fee2e2",
  200: "#fecaca",
  300: "#fca5a5",
  400: "#f87171",
  500: "#ef4444",
  600: "#dc2626",
  700: "#b91c1c",
  800: "#991b1b",
  900: "#7f1d1d",
  950: "#450a0a",
} as const;

/** Semantic — info (cyan) */
export const cyan = {
  50: "#ecfeff",
  100: "#cffafe",
  200: "#a5f3fc",
  300: "#67e8f9",
  400: "#22d3ee",
  500: "#06b6d4",
  600: "#0891b2",
  700: "#0e7490",
  800: "#155e75",
  900: "#164e63",
  950: "#083344",
} as const;

// ---------------------------------------------------------------------------
// TypeScript types
// ---------------------------------------------------------------------------

export interface ColorTheme {
  // Brand / primary
  brand: {
    primary: string;
    primaryHover: string;
    primaryActive: string;
    primarySubtle: string;
    primaryMuted: string;
    accent: string;
    accentHover: string;
    accentSubtle: string;
  };

  // Surfaces (backgrounds)
  surface: {
    base: string;       // Page background
    raised: string;     // Cards, modals — slightly elevated
    overlay: string;    // Dropdowns, tooltips
    sunken: string;     // Inputs, code blocks — slightly below base
    inverse: string;    // Inverted surface (dark on light / light on dark)
  };

  // Borders
  border: {
    default: string;
    subtle: string;
    strong: string;
    focus: string;      // Focus ring
    brand: string;
  };

  // Text
  text: {
    primary: string;    // Main content — contrast >= 7:1 on base surface
    secondary: string;  // Supporting text — contrast >= 4.5:1 on base surface
    tertiary: string;   // Hints, placeholders — contrast >= 3:1 on base surface
    disabled: string;
    inverse: string;    // Text on brand/dark backgrounds
    brand: string;      // Brand-colored text
    link: string;
    linkHover: string;
    code: string;       // Inline code
  };

  // Semantic — success
  success: {
    bg: string;
    border: string;
    text: string;
    icon: string;
    solid: string;
  };

  // Semantic — warning
  warning: {
    bg: string;
    border: string;
    text: string;
    icon: string;
    solid: string;
  };

  // Semantic — error
  error: {
    bg: string;
    border: string;
    text: string;
    icon: string;
    solid: string;
  };

  // Semantic — info
  info: {
    bg: string;
    border: string;
    text: string;
    icon: string;
    solid: string;
  };

  // Interactive states
  interactive: {
    hoverBg: string;
    activeBg: string;
    selectedBg: string;
    disabledBg: string;
    disabledText: string;
  };

  // Code / syntax highlighting
  syntax: {
    background: string;
    comment: string;
    keyword: string;
    string: string;
    number: string;
    function: string;
    variable: string;
    operator: string;
    type: string;
    constant: string;
  };
}

// ---------------------------------------------------------------------------
// Dark theme
// ---------------------------------------------------------------------------

/**
 * Dark theme — designed for the default AI chat interface.
 *
 * Contrast ratios (text : surface.base = gray.950):
 *   text.primary   (#f9fafb  on #0d1117) ≈ 15.3:1  ✓ AAA
 *   text.secondary (#9ca3af  on #0d1117) ≈ 5.4:1   ✓ AA
 *   text.tertiary  (#6b7280  on #0d1117) ≈ 3.3:1   ✓ AA large
 *   text.brand     (#a78bfa  on #0d1117) ≈ 6.4:1   ✓ AA
 */
export const darkTheme: ColorTheme = {
  brand: {
    primary: purple[500],         // #8b5cf6
    primaryHover: purple[400],    // #a78bfa
    primaryActive: purple[600],   // #7c3aed
    primarySubtle: purple[900],   // #4c1d95
    primaryMuted: "#2d1f5e",      // Custom — purple-950 lightened slightly
    accent: blue[500],            // #3b82f6
    accentHover: blue[400],       // #60a5fa
    accentSubtle: blue[900],      // #1e3a8a
  },

  surface: {
    base: gray[950],              // #0d1117 — main page bg
    raised: gray[900],            // #111827 — cards
    overlay: gray[850],           // #18202e — dropdowns
    sunken: "#0a0e16",            // Slightly darker than base for inputs
    inverse: gray[50],            // #f9fafb
  },

  border: {
    default: gray[800],           // #1f2937
    subtle: gray[850],            // #18202e
    strong: gray[700],            // #374151
    focus: purple[500],           // #8b5cf6
    brand: purple[700],           // #6d28d9
  },

  text: {
    primary: gray[50],            // #f9fafb  contrast ~15.3:1 on gray.950
    secondary: gray[400],         // #9ca3af  contrast ~5.4:1
    tertiary: gray[500],          // #6b7280  contrast ~3.3:1
    disabled: gray[600],          // #4b5563
    inverse: gray[900],           // #111827
    brand: purple[400],           // #a78bfa  contrast ~6.4:1
    link: blue[400],              // #60a5fa
    linkHover: blue[300],         // #93c5fd
    code: purple[300],            // #c4b5fd
  },

  success: {
    bg: "#0d2818",
    border: green[800],           // #166534
    text: green[400],             // #4ade80
    icon: green[500],             // #22c55e
    solid: green[600],            // #16a34a
  },

  warning: {
    bg: "#2a1d06",
    border: amber[800],           // #92400e
    text: amber[400],             // #fbbf24
    icon: amber[500],             // #f59e0b
    solid: amber[600],            // #d97706
  },

  error: {
    bg: "#200e0e",
    border: red[800],             // #991b1b
    text: red[400],               // #f87171
    icon: red[500],               // #ef4444
    solid: red[600],              // #dc2626
  },

  info: {
    bg: "#071e26",
    border: cyan[800],            // #155e75
    text: cyan[400],              // #22d3ee
    icon: cyan[500],              // #06b6d4
    solid: cyan[600],             // #0891b2
  },

  interactive: {
    hoverBg: gray[800],           // #1f2937
    activeBg: gray[750],          // #2d3748
    selectedBg: "#251b4a",        // Purple-tinted selection
    disabledBg: gray[900],        // #111827
    disabledText: gray[600],      // #4b5563
  },

  syntax: {
    background: "#0a0e16",
    comment: gray[500],           // #6b7280
    keyword: purple[400],         // #a78bfa
    string: green[400],           // #4ade80
    number: amber[400],           // #fbbf24
    function: blue[400],          // #60a5fa
    variable: gray[200],          // #e5e7eb
    operator: cyan[400],          // #22d3ee
    type: cyan[300],              // #67e8f9
    constant: red[400],           // #f87171
  },
};

// ---------------------------------------------------------------------------
// Light theme
// ---------------------------------------------------------------------------

/**
 * Light theme contrast ratios (text : surface.base = gray.50):
 *   text.primary   (#111827 on #f9fafb) ≈ 16.0:1  ✓ AAA
 *   text.secondary (#4b5563 on #f9fafb) ≈ 7.4:1   ✓ AAA
 *   text.tertiary  (#6b7280 on #f9fafb) ≈ 4.6:1   ✓ AA
 *   text.brand     (#6d28d9 on #f9fafb) ≈ 7.0:1   ✓ AAA
 */
export const lightTheme: ColorTheme = {
  brand: {
    primary: purple[600],         // #7c3aed
    primaryHover: purple[700],    // #6d28d9
    primaryActive: purple[800],   // #5b21b6
    primarySubtle: purple[50],    // #f5f3ff
    primaryMuted: purple[100],    // #ede9fe
    accent: blue[600],            // #2563eb
    accentHover: blue[700],       // #1d4ed8
    accentSubtle: blue[50],       // #eff6ff
  },

  surface: {
    base: gray[50],               // #f9fafb
    raised: gray[0],              // #ffffff — cards pop above base
    overlay: gray[0],             // #ffffff — dropdowns
    sunken: gray[100],            // #f3f4f6 — inputs
    inverse: gray[900],           // #111827
  },

  border: {
    default: gray[200],           // #e5e7eb
    subtle: gray[100],            // #f3f4f6
    strong: gray[300],            // #d1d5db
    focus: purple[500],           // #8b5cf6
    brand: purple[300],           // #c4b5fd
  },

  text: {
    primary: gray[900],           // #111827  contrast ~16.0:1 on gray.50
    secondary: gray[600],         // #4b5563  contrast ~7.4:1
    tertiary: gray[500],          // #6b7280  contrast ~4.6:1
    disabled: gray[400],          // #9ca3af
    inverse: gray[50],            // #f9fafb
    brand: purple[700],           // #6d28d9  contrast ~7.0:1
    link: blue[600],              // #2563eb
    linkHover: blue[800],         // #1e40af
    code: purple[700],            // #6d28d9
  },

  success: {
    bg: green[50],                // #f0fdf4
    border: green[200],           // #bbf7d0
    text: green[700],             // #15803d
    icon: green[600],             // #16a34a
    solid: green[600],            // #16a34a
  },

  warning: {
    bg: amber[50],                // #fffbeb
    border: amber[200],           // #fde68a
    text: amber[700],             // #b45309
    icon: amber[600],             // #d97706
    solid: amber[600],            // #d97706
  },

  error: {
    bg: red[50],                  // #fef2f2
    border: red[200],             // #fecaca
    text: red[700],               // #b91c1c
    icon: red[600],               // #dc2626
    solid: red[600],              // #dc2626
  },

  info: {
    bg: cyan[50],                 // #ecfeff
    border: cyan[200],            // #a5f3fc
    text: cyan[700],              // #0e7490
    icon: cyan[600],              // #0891b2
    solid: cyan[600],             // #0891b2
  },

  interactive: {
    hoverBg: gray[100],           // #f3f4f6
    activeBg: gray[200],          // #e5e7eb
    selectedBg: purple[50],       // #f5f3ff
    disabledBg: gray[100],        // #f3f4f6
    disabledText: gray[400],      // #9ca3af
  },

  syntax: {
    background: gray[100],        // #f3f4f6
    comment: gray[500],           // #6b7280
    keyword: purple[700],         // #6d28d9
    string: green[700],           // #15803d
    number: amber[700],           // #b45309
    function: blue[700],          // #1d4ed8
    variable: gray[800],          // #1f2937
    operator: cyan[700],          // #0e7490
    type: cyan[800],              // #155e75
    constant: red[700],           // #b91c1c
  },
};

// ---------------------------------------------------------------------------
// CSS custom property helpers
// ---------------------------------------------------------------------------

/** Converts a ColorTheme into a flat record of CSS custom property entries */
function flattenTheme(
  obj: Record<string, unknown>,
  prefix = "--color"
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const varName = `${prefix}-${key}`;
    if (typeof value === "string") {
      result[varName] = value;
    } else if (typeof value === "object" && value !== null) {
      Object.assign(
        result,
        flattenTheme(value as Record<string, unknown>, varName)
      );
    }
  }
  return result;
}

export function themeToCSS(theme: ColorTheme): string {
  const flat = flattenTheme(theme as unknown as Record<string, unknown>);
  return Object.entries(flat)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
}

export const darkThemeCSS = themeToCSS(darkTheme);
export const lightThemeCSS = themeToCSS(lightTheme);

export default { darkTheme, lightTheme, purple, blue, gray, green, amber, red, cyan };
