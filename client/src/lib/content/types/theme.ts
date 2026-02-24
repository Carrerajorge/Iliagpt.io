/**
 * Theme Token Definitions
 * 
 * Enterprise-grade theming system for content blocks.
 * Supports light/dark modes with full customization.
 */

// ============================================================================
// COLOR TOKENS
// ============================================================================

export interface ColorTokens {
    // Base colors
    background: string;
    foreground: string;
    muted: string;
    mutedForeground: string;
    accent: string;
    accentForeground: string;

    // Border colors
    border: string;
    borderHover: string;
    borderFocus: string;

    // Semantic colors
    primary: string;
    primaryForeground: string;
    secondary: string;
    secondaryForeground: string;
    destructive: string;
    destructiveForeground: string;

    // Status colors
    success: string;
    successBackground: string;
    warning: string;
    warningBackground: string;
    error: string;
    errorBackground: string;
    info: string;
    infoBackground: string;

    // Code colors
    codeBg: string;
    codeFg: string;
    codeComment: string;
    codeKeyword: string;
    codeString: string;
    codeNumber: string;
    codeFunction: string;
}

// ============================================================================
// TYPOGRAPHY TOKENS
// ============================================================================

export interface TypographyTokens {
    // Font families
    fontSans: string;
    fontMono: string;
    fontSerif: string;

    // Font sizes (in px)
    fontSize: {
        xs: number;
        sm: number;
        base: number;
        lg: number;
        xl: number;
        '2xl': number;
        '3xl': number;
        '4xl': number;
    };

    // Font weights
    fontWeight: {
        normal: number;
        medium: number;
        semibold: number;
        bold: number;
    };

    // Line heights
    lineHeight: {
        tight: number;
        snug: number;
        normal: number;
        relaxed: number;
        loose: number;
    };

    // Letter spacing
    letterSpacing: {
        tight: string;
        normal: string;
        wide: string;
    };
}

// ============================================================================
// SPACING TOKENS
// ============================================================================

export interface SpacingTokens {
    0: number;
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
    6: number;
    8: number;
    10: number;
    12: number;
    16: number;
    20: number;
    24: number;
    32: number;
}

// ============================================================================
// BLOCK-SPECIFIC TOKENS
// ============================================================================

export interface BlockTokens {
    // Divider
    divider: {
        height: { thin: number; thick: number };
        color: string;
        margin: { sm: number; md: number; lg: number };
    };

    // Heading
    heading: {
        sizes: { h1: number; h2: number; h3: number; h4: number; h5: number; h6: number };
        weights: { h1: number; h2: number; h3: number; h4: number; h5: number; h6: number };
        margins: { h1: number; h2: number; h3: number; h4: number; h5: number; h6: number };
    };

    // Code
    code: {
        background: string;
        border: string;
        borderRadius: number;
        padding: { x: number; y: number };
        fontSize: number;
        lineNumbers: {
            width: number;
            color: string;
            background: string;
        };
    };

    // Quote
    quote: {
        borderLeft: { width: number; color: string };
        background: string;
        padding: { x: number; y: number };
        fontStyle: string;
    };

    // Image
    image: {
        borderRadius: number;
        maxWidth: string;
        shadow: string;
        captionSize: number;
        captionColor: string;
    };

    // Table
    table: {
        headerBackground: string;
        headerColor: string;
        rowBackground: string;
        rowAlternate: string;
        borderColor: string;
        cellPadding: { x: number; y: number };
    };

    // Card
    card: {
        background: string;
        border: string;
        borderRadius: number;
        shadow: string;
        padding: number;
        hoverShadow: string;
    };

    // Callout
    callout: {
        borderRadius: number;
        borderWidth: number;
        padding: { x: number; y: number };
        iconSize: number;
        variants: {
            info: { background: string; border: string; icon: string };
            warning: { background: string; border: string; icon: string };
            error: { background: string; border: string; icon: string };
            success: { background: string; border: string; icon: string };
            tip: { background: string; border: string; icon: string };
            note: { background: string; border: string; icon: string };
        };
    };

    // Button
    button: {
        borderRadius: number;
        sizes: {
            sm: { height: number; padding: number; fontSize: number };
            md: { height: number; padding: number; fontSize: number };
            lg: { height: number; padding: number; fontSize: number };
        };
    };

    // List
    list: {
        indent: number;
        markerColor: string;
        itemSpacing: number;
        checkboxSize: number;
    };
}

// ============================================================================
// ANIMATION TOKENS
// ============================================================================

export interface AnimationTokens {
    duration: {
        fast: string;
        normal: string;
        slow: string;
    };
    easing: {
        default: string;
        in: string;
        out: string;
        inOut: string;
    };
}

// ============================================================================
// FULL THEME
// ============================================================================

export interface ContentTheme {
    name: string;
    mode: 'light' | 'dark';
    colors: ColorTokens;
    typography: TypographyTokens;
    spacing: SpacingTokens;
    blocks: BlockTokens;
    animations: AnimationTokens;
    borderRadius: {
        sm: number;
        md: number;
        lg: number;
        xl: number;
        full: string;
    };
    shadows: {
        sm: string;
        md: string;
        lg: string;
        xl: string;
    };
}

// ============================================================================
// DEFAULT THEME
// ============================================================================

export const lightTheme: ContentTheme = {
    name: 'light',
    mode: 'light',
    colors: {
        background: '#ffffff',
        foreground: '#0f172a',
        muted: '#f1f5f9',
        mutedForeground: '#64748b',
        accent: '#f1f5f9',
        accentForeground: '#0f172a',
        border: '#e2e8f0',
        borderHover: '#cbd5e1',
        borderFocus: '#3b82f6',
        primary: '#3b82f6',
        primaryForeground: '#ffffff',
        secondary: '#64748b',
        secondaryForeground: '#ffffff',
        destructive: '#ef4444',
        destructiveForeground: '#ffffff',
        success: '#22c55e',
        successBackground: '#f0fdf4',
        warning: '#f59e0b',
        warningBackground: '#fffbeb',
        error: '#ef4444',
        errorBackground: '#fef2f2',
        info: '#3b82f6',
        infoBackground: '#eff6ff',
        codeBg: '#1e293b',
        codeFg: '#e2e8f0',
        codeComment: '#64748b',
        codeKeyword: '#c084fc',
        codeString: '#4ade80',
        codeNumber: '#fb923c',
        codeFunction: '#60a5fa',
    },
    typography: {
        fontSans: 'Inter, system-ui, sans-serif',
        fontMono: 'JetBrains Mono, Consolas, monospace',
        fontSerif: 'Georgia, serif',
        fontSize: { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30, '4xl': 36 },
        fontWeight: { normal: 400, medium: 500, semibold: 600, bold: 700 },
        lineHeight: { tight: 1.25, snug: 1.375, normal: 1.5, relaxed: 1.625, loose: 2 },
        letterSpacing: { tight: '-0.025em', normal: '0', wide: '0.025em' },
    },
    spacing: { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96, 32: 128 },
    blocks: {
        divider: { height: { thin: 1, thick: 2 }, color: '#e2e8f0', margin: { sm: 8, md: 16, lg: 24 } },
        heading: {
            sizes: { h1: 36, h2: 30, h3: 24, h4: 20, h5: 18, h6: 16 },
            weights: { h1: 700, h2: 700, h3: 600, h4: 600, h5: 600, h6: 600 },
            margins: { h1: 32, h2: 28, h3: 24, h4: 20, h5: 16, h6: 16 },
        },
        code: {
            background: '#1e293b',
            border: '#334155',
            borderRadius: 8,
            padding: { x: 16, y: 12 },
            fontSize: 14,
            lineNumbers: { width: 40, color: '#64748b', background: '#0f172a' },
        },
        quote: {
            borderLeft: { width: 4, color: '#3b82f6' },
            background: '#f8fafc',
            padding: { x: 16, y: 12 },
            fontStyle: 'italic',
        },
        image: {
            borderRadius: 8,
            maxWidth: '100%',
            shadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            captionSize: 14,
            captionColor: '#64748b',
        },
        table: {
            headerBackground: '#f1f5f9',
            headerColor: '#0f172a',
            rowBackground: '#ffffff',
            rowAlternate: '#f8fafc',
            borderColor: '#e2e8f0',
            cellPadding: { x: 12, y: 8 },
        },
        card: {
            background: '#ffffff',
            border: '#e2e8f0',
            borderRadius: 12,
            shadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
            padding: 16,
            hoverShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
        },
        callout: {
            borderRadius: 8,
            borderWidth: 1,
            padding: { x: 16, y: 12 },
            iconSize: 20,
            variants: {
                info: { background: '#eff6ff', border: '#3b82f6', icon: '💡' },
                warning: { background: '#fffbeb', border: '#f59e0b', icon: '⚠️' },
                error: { background: '#fef2f2', border: '#ef4444', icon: '❌' },
                success: { background: '#f0fdf4', border: '#22c55e', icon: '✅' },
                tip: { background: '#f0fdf4', border: '#22c55e', icon: '💡' },
                note: { background: '#f8fafc', border: '#64748b', icon: '📝' },
            },
        },
        button: {
            borderRadius: 8,
            sizes: {
                sm: { height: 32, padding: 12, fontSize: 14 },
                md: { height: 40, padding: 16, fontSize: 14 },
                lg: { height: 48, padding: 24, fontSize: 16 },
            },
        },
        list: { indent: 24, markerColor: '#64748b', itemSpacing: 8, checkboxSize: 18 },
    },
    animations: {
        duration: { fast: '150ms', normal: '200ms', slow: '300ms' },
        easing: { default: 'ease', in: 'ease-in', out: 'ease-out', inOut: 'ease-in-out' },
    },
    borderRadius: { sm: 4, md: 8, lg: 12, xl: 16, full: '9999px' },
    shadows: {
        sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
        md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
        xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
    },
};

export const darkTheme: ContentTheme = {
    ...lightTheme,
    name: 'dark',
    mode: 'dark',
    colors: {
        ...lightTheme.colors,
        background: '#0f172a',
        foreground: '#f8fafc',
        muted: '#1e293b',
        mutedForeground: '#94a3b8',
        accent: '#1e293b',
        accentForeground: '#f8fafc',
        border: '#334155',
        borderHover: '#475569',
        codeBg: '#0f172a',
        codeFg: '#f8fafc',
    },
    blocks: {
        ...lightTheme.blocks,
        quote: { ...lightTheme.blocks.quote, background: '#1e293b' },
        table: {
            ...lightTheme.blocks.table,
            headerBackground: '#1e293b',
            headerColor: '#f8fafc',
            rowBackground: '#0f172a',
            rowAlternate: '#1e293b',
            borderColor: '#334155',
        },
        card: { ...lightTheme.blocks.card, background: '#1e293b', border: '#334155' },
        callout: {
            ...lightTheme.blocks.callout,
            variants: {
                info: { background: '#1e3a5f', border: '#3b82f6', icon: '💡' },
                warning: { background: '#422006', border: '#f59e0b', icon: '⚠️' },
                error: { background: '#450a0a', border: '#ef4444', icon: '❌' },
                success: { background: '#052e16', border: '#22c55e', icon: '✅' },
                tip: { background: '#052e16', border: '#22c55e', icon: '💡' },
                note: { background: '#1e293b', border: '#64748b', icon: '📝' },
            },
        },
    },
};

export function getTheme(mode: 'light' | 'dark'): ContentTheme {
    return mode === 'dark' ? darkTheme : lightTheme;
}
