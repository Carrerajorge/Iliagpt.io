/**
 * Professional PPT Template Engine
 * 
 * Provides professional themes, layouts, and AI-generated images for presentations.
 */

import { randomUUID } from "crypto";

// ============================================
// Professional Themes
// ============================================

export interface ThemeColors {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    lightText: string;
    gradient?: [string, string];
}

export interface ThemeFonts {
    title: string;
    body: string;
    code?: string;
}

export interface ProfessionalTheme {
    name: string;
    colors: ThemeColors;
    fonts: ThemeFonts;
    slideStyles: {
        titleSlide: SlideStyle;
        contentSlide: SlideStyle;
        sectionSlide: SlideStyle;
        closingSlide: SlideStyle;
    };
}

export interface SlideStyle {
    background: string | { gradient: [string, string]; direction: "horizontal" | "vertical" | "diagonal" };
    titleColor: string;
    titleSize: number;
    titlePosition: { x: number; y: number; w: number; h: number };
    subtitleColor?: string;
    subtitleSize?: number;
    contentColor: string;
    contentSize: number;
    accentShape?: AccentShape;
}

export interface AccentShape {
    type: "rect" | "circle" | "line" | "triangle" | "svg";
    position: { x: number; y: number; w: number; h: number };
    color: string;
    opacity?: number;
}

// Professional themes library
export const PROFESSIONAL_THEMES: Record<string, ProfessionalTheme> = {
    corporate: {
        name: "Corporate Professional",
        colors: {
            primary: "#1a365d",
            secondary: "#2b6cb0",
            accent: "#ed8936",
            background: "#ffffff",
            text: "#2d3748",
            lightText: "#718096",
            gradient: ["#1a365d", "#2b6cb0"]
        },
        fonts: {
            title: "Calibri",
            body: "Calibri Light",
        },
        slideStyles: {
            titleSlide: {
                background: { gradient: ["#1a365d", "#2b6cb0"], direction: "diagonal" },
                titleColor: "#ffffff",
                titleSize: 48,
                titlePosition: { x: 0.5, y: 2, w: 9, h: 1.5 },
                subtitleColor: "#e2e8f0",
                subtitleSize: 24,
                contentColor: "#ffffff",
                contentSize: 18,
                accentShape: {
                    type: "rect",
                    position: { x: 0, y: 5, w: 10, h: 0.625 },
                    color: "#ed8936",
                    opacity: 0.8
                }
            },
            contentSlide: {
                background: "#ffffff",
                titleColor: "#1a365d",
                titleSize: 32,
                titlePosition: { x: 0.5, y: 0.3, w: 9, h: 0.8 },
                contentColor: "#2d3748",
                contentSize: 18,
                accentShape: {
                    type: "line",
                    position: { x: 0.5, y: 1, w: 9, h: 0.02 },
                    color: "#2b6cb0"
                }
            },
            sectionSlide: {
                background: { gradient: ["#2b6cb0", "#1a365d"], direction: "horizontal" },
                titleColor: "#ffffff",
                titleSize: 44,
                titlePosition: { x: 0.5, y: 2.2, w: 9, h: 1.2 },
                contentColor: "#e2e8f0",
                contentSize: 20
            },
            closingSlide: {
                background: "#1a365d",
                titleColor: "#ffffff",
                titleSize: 40,
                titlePosition: { x: 0.5, y: 2, w: 9, h: 1.5 },
                contentColor: "#e2e8f0",
                contentSize: 24
            }
        }
    },

    modern: {
        name: "Modern Gradient",
        colors: {
            primary: "#667eea",
            secondary: "#764ba2",
            accent: "#f093fb",
            background: "#f7fafc",
            text: "#1a202c",
            lightText: "#4a5568",
            gradient: ["#667eea", "#764ba2"]
        },
        fonts: {
            title: "Inter",
            body: "Roboto",
        },
        slideStyles: {
            titleSlide: {
                background: { gradient: ["#667eea", "#764ba2"], direction: "diagonal" },
                titleColor: "#ffffff",
                titleSize: 52,
                titlePosition: { x: 0.5, y: 1.8, w: 9, h: 1.5 },
                subtitleColor: "#e2e8f0",
                subtitleSize: 22,
                contentColor: "#ffffff",
                contentSize: 18,
                accentShape: {
                    type: "circle",
                    position: { x: 8, y: 4, w: 1.5, h: 1.5 },
                    color: "#f093fb",
                    opacity: 0.3
                }
            },
            contentSlide: {
                background: "#f7fafc",
                titleColor: "#667eea",
                titleSize: 30,
                titlePosition: { x: 0.5, y: 0.3, w: 9, h: 0.8 },
                contentColor: "#1a202c",
                contentSize: 16,
                accentShape: {
                    type: "rect",
                    position: { x: 0, y: 0, w: 0.15, h: 5.625 },
                    color: "#667eea"
                }
            },
            sectionSlide: {
                background: { gradient: ["#764ba2", "#667eea"], direction: "vertical" },
                titleColor: "#ffffff",
                titleSize: 44,
                titlePosition: { x: 0.5, y: 2.2, w: 9, h: 1.2 },
                contentColor: "#e2e8f0",
                contentSize: 20
            },
            closingSlide: {
                background: { gradient: ["#667eea", "#764ba2"], direction: "horizontal" },
                titleColor: "#ffffff",
                titleSize: 38,
                titlePosition: { x: 0.5, y: 2, w: 9, h: 1.5 },
                contentColor: "#e2e8f0",
                contentSize: 22
            }
        }
    },

    academic: {
        name: "Academic Classic",
        colors: {
            primary: "#2c5282",
            secondary: "#4a5568",
            accent: "#38b2ac",
            background: "#f8f9fa",
            text: "#1a202c",
            lightText: "#718096"
        },
        fonts: {
            title: "Georgia",
            body: "Times New Roman",
        },
        slideStyles: {
            titleSlide: {
                background: "#2c5282",
                titleColor: "#ffffff",
                titleSize: 44,
                titlePosition: { x: 0.5, y: 1.8, w: 9, h: 1.5 },
                subtitleColor: "#bee3f8",
                subtitleSize: 20,
                contentColor: "#ffffff",
                contentSize: 16,
                accentShape: {
                    type: "line",
                    position: { x: 2, y: 3.5, w: 6, h: 0.02 },
                    color: "#38b2ac"
                }
            },
            contentSlide: {
                background: "#f8f9fa",
                titleColor: "#2c5282",
                titleSize: 28,
                titlePosition: { x: 0.5, y: 0.3, w: 9, h: 0.8 },
                contentColor: "#1a202c",
                contentSize: 16
            },
            sectionSlide: {
                background: "#4a5568",
                titleColor: "#ffffff",
                titleSize: 40,
                titlePosition: { x: 0.5, y: 2.2, w: 9, h: 1.2 },
                contentColor: "#e2e8f0",
                contentSize: 18
            },
            closingSlide: {
                background: "#2c5282",
                titleColor: "#ffffff",
                titleSize: 36,
                titlePosition: { x: 0.5, y: 2, w: 9, h: 1.5 },
                contentColor: "#bee3f8",
                contentSize: 20
            }
        }
    },

    dark: {
        name: "Dark Executive",
        colors: {
            primary: "#1a202c",
            secondary: "#2d3748",
            accent: "#63b3ed",
            background: "#1a202c",
            text: "#e2e8f0",
            lightText: "#a0aec0",
            gradient: ["#1a202c", "#2d3748"]
        },
        fonts: {
            title: "Segoe UI",
            body: "Segoe UI",
        },
        slideStyles: {
            titleSlide: {
                background: { gradient: ["#1a202c", "#2d3748"], direction: "diagonal" },
                titleColor: "#ffffff",
                titleSize: 50,
                titlePosition: { x: 0.5, y: 1.8, w: 9, h: 1.5 },
                subtitleColor: "#a0aec0",
                subtitleSize: 22,
                contentColor: "#e2e8f0",
                contentSize: 18,
                accentShape: {
                    type: "line",
                    position: { x: 0.5, y: 3.5, w: 2, h: 0.05 },
                    color: "#63b3ed"
                }
            },
            contentSlide: {
                background: "#1a202c",
                titleColor: "#63b3ed",
                titleSize: 30,
                titlePosition: { x: 0.5, y: 0.3, w: 9, h: 0.8 },
                contentColor: "#e2e8f0",
                contentSize: 16
            },
            sectionSlide: {
                background: "#2d3748",
                titleColor: "#ffffff",
                titleSize: 44,
                titlePosition: { x: 0.5, y: 2.2, w: 9, h: 1.2 },
                contentColor: "#a0aec0",
                contentSize: 20
            },
            closingSlide: {
                background: "#1a202c",
                titleColor: "#63b3ed",
                titleSize: 38,
                titlePosition: { x: 0.5, y: 2, w: 9, h: 1.5 },
                contentColor: "#e2e8f0",
                contentSize: 22
            }
        }
    },

    minimalist: {
        name: "Minimalist Clean",
        colors: {
            primary: "#000000",
            secondary: "#333333",
            accent: "#ff6b6b",
            background: "#ffffff",
            text: "#000000",
            lightText: "#666666"
        },
        fonts: {
            title: "Helvetica Neue",
            body: "Helvetica",
        },
        slideStyles: {
            titleSlide: {
                background: "#ffffff",
                titleColor: "#000000",
                titleSize: 56,
                titlePosition: { x: 0.5, y: 2.2, w: 9, h: 1.5 },
                subtitleColor: "#666666",
                subtitleSize: 20,
                contentColor: "#333333",
                contentSize: 16,
                accentShape: {
                    type: "rect",
                    position: { x: 0.5, y: 3.8, w: 0.8, h: 0.1 },
                    color: "#ff6b6b"
                }
            },
            contentSlide: {
                background: "#ffffff",
                titleColor: "#000000",
                titleSize: 28,
                titlePosition: { x: 0.5, y: 0.3, w: 9, h: 0.8 },
                contentColor: "#333333",
                contentSize: 16
            },
            sectionSlide: {
                background: "#000000",
                titleColor: "#ffffff",
                titleSize: 48,
                titlePosition: { x: 0.5, y: 2.2, w: 9, h: 1.2 },
                contentColor: "#cccccc",
                contentSize: 18
            },
            closingSlide: {
                background: "#ffffff",
                titleColor: "#000000",
                titleSize: 40,
                titlePosition: { x: 0.5, y: 2, w: 9, h: 1.5 },
                contentColor: "#333333",
                contentSize: 20
            }
        }
    }
};

// ============================================
// Smart Layout System
// ============================================

export interface SlideLayoutConfig {
    type: "title" | "content" | "two-column" | "image-left" | "image-right" | "comparison" | "quote" | "data";
    contentAreas: ContentArea[];
}

export interface ContentArea {
    name: string;
    position: { x: number; y: number; w: number; h: number };
    contentType: "title" | "text" | "bullets" | "image" | "chart" | "table" | "quote";
    maxItems?: number;
}

export const SMART_LAYOUTS: Record<string, SlideLayoutConfig> = {
    "title": {
        type: "title",
        contentAreas: [
            { name: "title", position: { x: 5, y: 35, w: 90, h: 20 }, contentType: "title" },
            { name: "subtitle", position: { x: 5, y: 55, w: 90, h: 10 }, contentType: "text" }
        ]
    },
    "content": {
        type: "content",
        contentAreas: [
            { name: "title", position: { x: 5, y: 5, w: 90, h: 12 }, contentType: "title" },
            { name: "body", position: { x: 5, y: 20, w: 90, h: 75 }, contentType: "bullets", maxItems: 6 }
        ]
    },
    "two-column": {
        type: "two-column",
        contentAreas: [
            { name: "title", position: { x: 5, y: 5, w: 90, h: 12 }, contentType: "title" },
            { name: "left", position: { x: 5, y: 20, w: 42, h: 75 }, contentType: "bullets", maxItems: 4 },
            { name: "right", position: { x: 52, y: 20, w: 42, h: 75 }, contentType: "bullets", maxItems: 4 }
        ]
    },
    "image-left": {
        type: "image-left",
        contentAreas: [
            { name: "title", position: { x: 5, y: 5, w: 90, h: 12 }, contentType: "title" },
            { name: "image", position: { x: 5, y: 20, w: 40, h: 70 }, contentType: "image" },
            { name: "text", position: { x: 50, y: 20, w: 45, h: 70 }, contentType: "bullets", maxItems: 5 }
        ]
    },
    "image-right": {
        type: "image-right",
        contentAreas: [
            { name: "title", position: { x: 5, y: 5, w: 90, h: 12 }, contentType: "title" },
            { name: "text", position: { x: 5, y: 20, w: 45, h: 70 }, contentType: "bullets", maxItems: 5 },
            { name: "image", position: { x: 55, y: 20, w: 40, h: 70 }, contentType: "image" }
        ]
    },
    "comparison": {
        type: "comparison",
        contentAreas: [
            { name: "title", position: { x: 5, y: 5, w: 90, h: 12 }, contentType: "title" },
            { name: "left-title", position: { x: 5, y: 18, w: 42, h: 8 }, contentType: "text" },
            { name: "left-content", position: { x: 5, y: 28, w: 42, h: 65 }, contentType: "bullets", maxItems: 4 },
            { name: "right-title", position: { x: 52, y: 18, w: 42, h: 8 }, contentType: "text" },
            { name: "right-content", position: { x: 52, y: 28, w: 42, h: 65 }, contentType: "bullets", maxItems: 4 }
        ]
    },
    "quote": {
        type: "quote",
        contentAreas: [
            { name: "quote", position: { x: 10, y: 25, w: 80, h: 40 }, contentType: "quote" },
            { name: "author", position: { x: 10, y: 68, w: 80, h: 10 }, contentType: "text" }
        ]
    },
    "data": {
        type: "data",
        contentAreas: [
            { name: "title", position: { x: 5, y: 5, w: 90, h: 12 }, contentType: "title" },
            { name: "chart", position: { x: 5, y: 20, w: 55, h: 70 }, contentType: "chart" },
            { name: "insights", position: { x: 62, y: 20, w: 33, h: 70 }, contentType: "bullets", maxItems: 4 }
        ]
    }
};

// ============================================
// Image Generation Integration
// ============================================

export interface ImageGenerationRequest {
    prompt: string;
    style?: "natural" | "artistic" | "professional" | "minimal" | "infographic";
    size?: "small" | "medium" | "large";
    aspectRatio?: "square" | "wide" | "tall";
}

export interface GeneratedImage {
    id: string;
    url?: string;
    base64?: string;
    prompt: string;
    generated: boolean;
}

/**
 * Generate an image prompt based on slide context
 */
export function generateImagePrompt(
    slideTitle: string,
    slideContent: string[],
    style: string = "professional"
): string {
    const stylePrompts: Record<string, string> = {
        professional: "clean professional corporate illustration, modern flat design, subtle gradients, business context",
        artistic: "creative artistic illustration, vibrant colors, expressive style",
        minimal: "minimalist vector illustration, simple shapes, limited color palette",
        infographic: "infographic style illustration, data visualization elements, icons and symbols",
        natural: "realistic photographic style, high quality, natural lighting"
    };

    const contentSummary = slideContent.slice(0, 3).join(", ");

    return `${slideTitle}: ${contentSummary}. Style: ${stylePrompts[style] || stylePrompts.professional}. No text in image.`;
}

/**
 * Mock image generation (replace with actual API call)
 */
export async function generateSlideImage(
    request: ImageGenerationRequest
): Promise<GeneratedImage> {
    // This would integrate with:
    // - Gemini Vision/Imagen
    // - DALL-E
    // - Stable Diffusion
    // - Midjourney API

    const id = randomUUID();

    // For now, return a placeholder
    // In production, this calls the actual image generation API
    console.log(`[PPTTemplateEngine] Would generate image with prompt: ${request.prompt}`);

    return {
        id,
        prompt: request.prompt,
        generated: false,
        // In production, this would be populated with actual image data
        // base64 or url would be set here
    };
}

// ============================================
// Icon Library (SVG-based)
// ============================================

export const ICON_LIBRARY: Record<string, string> = {
    chart: "M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z",
    lightbulb: "M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z",
    target: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
    rocket: "M9.19 6.35c-2.04 2.29-3.44 5.58-3.57 5.89L2 10.69l4.05-4.05c.47-.47 1.15-.68 1.81-.55l1.33.26zm5.16 7.79c.35-.17.93-.46 1.56-.82.42-.24.82-.49 1.17-.73.27-.19.51-.37.71-.53.21-.17.37-.32.48-.44l.43-.45.43-.45.23-.24.04-.04 1.69-1.69c.51 1.75.86 3.67.86 5.75 0 2.5-.51 4.66-1.17 6.25l-4.76-4.76c.29-.39.45-.81.45-1.73 0-.7-.29-1.28-.71-1.69-.42-.42-1-.71-1.71-.71-.91 0-1.33.16-1.73.45z",
    users: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
    check: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
    star: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
    trending: "M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z",
    globe: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"
};

/**
 * Get SVG icon markup for embedding in presentations
 */
export function getIconSVG(iconName: string, color: string = "#000000", size: number = 24): string {
    const path = ICON_LIBRARY[iconName];
    if (!path) return "";

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}"><path d="${path}"/></svg>`;
}

// ============================================
// Slide Content Helpers
// ============================================

export interface BulletPoint {
    text: string;
    level: number;
    icon?: string;
}

export interface ChartConfig {
    type: "bar" | "line" | "pie" | "doughnut" | "area";
    title?: string;
    data: {
        labels: string[];
        values: number[];
        colors?: string[];
    };
    showLegend?: boolean;
    showValues?: boolean;
}

/**
 * Format bullet points with smart icons
 */
export function formatBulletPoints(
    items: string[],
    theme: ProfessionalTheme,
    useIcons: boolean = true
): BulletPoint[] {
    const iconMap: Record<string, string> = {
        "increase": "trending",
        "improve": "trending",
        "grow": "trending",
        "team": "users",
        "collaborate": "users",
        "goal": "target",
        "objective": "target",
        "idea": "lightbulb",
        "solution": "lightbulb",
        "success": "check",
        "complete": "check",
        "achieve": "star",
        "global": "globe",
        "world": "globe"
    };

    return items.map((text, index) => {
        let icon: string | undefined;

        if (useIcons) {
            const lowerText = text.toLowerCase();
            for (const [keyword, iconName] of Object.entries(iconMap)) {
                if (lowerText.includes(keyword)) {
                    icon = iconName;
                    break;
                }
            }
        }

        return {
            text,
            level: 0,
            icon
        };
    });
}

/**
 * Apply theme to slide configuration
 */
export function applyThemeToSlide(
    slideType: "title" | "content" | "section" | "closing",
    theme: ProfessionalTheme
): SlideStyle {
    const styleMap: Record<string, keyof typeof theme.slideStyles> = {
        title: "titleSlide",
        content: "contentSlide",
        section: "sectionSlide",
        closing: "closingSlide"
    };

    return theme.slideStyles[styleMap[slideType]];
}

export default {
    PROFESSIONAL_THEMES,
    SMART_LAYOUTS,
    ICON_LIBRARY,
    generateImagePrompt,
    generateSlideImage,
    getIconSVG,
    formatBulletPoints,
    applyThemeToSlide
};
