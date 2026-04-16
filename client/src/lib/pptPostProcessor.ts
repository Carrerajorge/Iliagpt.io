/**
 * PPT Post-Processor: Mastery Level Validation & Normalization
 * 
 * This module implements Rules 11-12 from the "Mastery PPT" specification.
 * It runs AFTER AI generation to ensure every slide meets professional standards.
 */

import { useDeckStore, selectDeck } from '@/components/ppt/store/deckStore';
import type { Deck, Slide, ElementAny, TextElement, ChartElement, TextStyle } from '@/components/ppt/store/types';
import { formatZonedDate } from '@/lib/platformDateTime';

// ============================================================================
// CONSTANTS: Design System (Rule 3, 4, 8)
// ============================================================================

export const MASTERY_DESIGN_SYSTEM = {
    // Typography (Rule 4)
    typography: {
        title: { fontSize: 36, bold: true, maxLines: 2 },
        subtitle: { fontSize: 20, bold: false, maxLines: 1 },
        body: { fontSize: 18, bold: false, maxLines: 6 },
        caption: { fontSize: 12, bold: false, maxLines: 1 },
    },
    // Colors (Rule 8)
    palette: {
        primary: '#1a365d',      // Dark Blue (Trust)
        secondary: '#2d3748',    // Dark Gray
        accent: '#e53e3e',       // Red (Emphasis)
        background: '#ffffff',   // Clean White
        text: '#2d3748',         // Almost Black (not pure #000)
        muted: '#718096',        // Gray for captions
    },
    // Grid (Rule 3)
    grid: {
        marginPercent: 0.06,     // 6% margins
        columns: 12,
        gutterPx: 16,
        baseSpacing: 8,          // 8px modular scale
    },
    // Limits (Rule 5, 7)
    limits: {
        maxBulletsPerSlide: 5,
        maxWordsPerSlide: 50,
        maxCharsPerBullet: 120,
        maxLinesBeforeSplit: 6,
    },
};

// ============================================================================
// HELPER: Extract text from Delta
// ============================================================================

function getTextFromDelta(element: TextElement): string {
    if (!element.delta?.ops) return '';
    return element.delta.ops.map(op => op.insert || '').join('');
}

function isTextElement(el: ElementAny): el is TextElement {
    return el.type === 'text';
}

// ============================================================================
// VALIDATION: Slide Checklist (Rule 11)
// ============================================================================

export interface SlideValidationResult {
    slideId: string;
    slideIndex: number;
    isValid: boolean;
    issues: string[];
    suggestions: string[];
}

/**
 * Validates a single slide against Mastery checklist (Rule 11)
 */
export function validateSlide(slide: Slide, index: number): SlideValidationResult {
    const issues: string[] = [];
    const suggestions: string[] = [];

    const textElements = slide.elements.filter(isTextElement);

    // Find title element (first element or large font)
    const titleElement = textElements.find(
        (el) => el.y < 100 && el.defaultTextStyle?.fontSize >= 30
    );

    // ✅ Check 1: Title is a Conclusion?
    if (titleElement) {
        const titleText = getTextFromDelta(titleElement);
        const isConclusionTitle = /[.!?]$/.test(titleText.trim()) ||
            titleText.includes('%') ||
            /\d+/.test(titleText) ||
            titleText.length > 30;
        if (!isConclusionTitle && titleText.length < 20) {
            issues.push('Title may be too generic (not a conclusion)');
            suggestions.push('Rewrite title to state the KEY TAKEAWAY, e.g., "X reduces Y by 20%"');
        }
    } else if (textElements.length > 0) {
        issues.push('Missing title element or title is not styled as a heading');
        suggestions.push('Add a title that states the main claim');
    }

    // ✅ Check 2: Single Main Idea?
    const bulletCount = textElements.filter(
        (el) => getTextFromDelta(el).startsWith('•')
    ).length;

    if (bulletCount > MASTERY_DESIGN_SYSTEM.limits.maxBulletsPerSlide) {
        issues.push(`Too many bullets (${bulletCount} > ${MASTERY_DESIGN_SYSTEM.limits.maxBulletsPerSlide})`);
        suggestions.push('Split into multiple slides or group into sub-topics');
    }

    // ✅ Check 3: Evidence Present?
    const hasChart = slide.elements.some(el => el.type === 'chart');
    const hasNumber = textElements.some(
        (el) => /\d+/.test(getTextFromDelta(el))
    );
    if (!hasChart && !hasNumber && bulletCount > 0) {
        suggestions.push('Consider adding quantitative evidence (number, percentage, or chart)');
    }

    // ✅ Check 4: Word Count
    const totalWords = textElements.reduce(
        (sum, el) => sum + (getTextFromDelta(el).split(/\s+/).length || 0),
        0
    );

    if (totalWords > MASTERY_DESIGN_SYSTEM.limits.maxWordsPerSlide) {
        issues.push(`Too many words (${totalWords} > ${MASTERY_DESIGN_SYSTEM.limits.maxWordsPerSlide})`);
        suggestions.push('Reduce text density. Use visuals or split slide.');
    }

    // ✅ Check 5: Long Bullets?
    textElements.forEach((el) => {
        const text = getTextFromDelta(el);
        if (text.length > MASTERY_DESIGN_SYSTEM.limits.maxCharsPerBullet) {
            issues.push(`Bullet too long: "${text.substring(0, 40)}..."`);
            suggestions.push('Split into "Idea" + "Evidence" sub-bullets');
        }
    });

    return {
        slideId: slide.id,
        slideIndex: index + 1,
        isValid: issues.length === 0,
        issues,
        suggestions,
    };
}

/**
 * Validates entire deck
 */
export function validateDeck(deck: Deck): SlideValidationResult[] {
    return deck.slides.map((slide, index) => validateSlide(slide, index));
}

// ============================================================================
// NORMALIZATION: Style Application (Rule 12A)
// ============================================================================

/**
 * Applies consistent styling to all elements in the deck
 */
export function normalizeDeckStyles(): void {
    const store = useDeckStore.getState();
    const deck = selectDeck(store);

    deck.slides.forEach((slide) => {
        slide.elements.filter(isTextElement).forEach((element) => {
            // Detect element role by position/size
            const isTitle = element.y < 100 && element.defaultTextStyle?.fontSize >= 30;
            const isBullet = getTextFromDelta(element).startsWith('•');

            if (isTitle) {
                store.applyTextStyleToDefault(element.id, {
                    fontSize: MASTERY_DESIGN_SYSTEM.typography.title.fontSize,
                    bold: true,
                    color: MASTERY_DESIGN_SYSTEM.palette.primary,
                });
            } else if (isBullet) {
                store.applyTextStyleToDefault(element.id, {
                    fontSize: MASTERY_DESIGN_SYSTEM.typography.body.fontSize,
                    color: MASTERY_DESIGN_SYSTEM.palette.text,
                });
            }
        });
    });
}

// ============================================================================
// LAYOUT DETECTION: Content-Aware Layout (Rule 12C)
// ============================================================================

export type LayoutType =
    | 'title-only'
    | 'title-bullets'
    | 'title-chart'
    | 'two-column'
    | 'kpi-cards'
    | 'diagram';

/**
 * Detects optimal layout based on slide content
 */
export function detectOptimalLayout(slide: Slide): LayoutType {
    const hasChart = slide.elements.some(el => el.type === 'chart');
    const textElements = slide.elements.filter(isTextElement);
    const bulletCount = textElements.filter(
        (el) => getTextFromDelta(el).startsWith('•')
    ).length;
    const hasNumbers = textElements.some(
        (el) => /^\d+%?$/.test(getTextFromDelta(el).trim())
    );

    if (hasChart) return 'title-chart';
    if (hasNumbers && bulletCount <= 2) return 'kpi-cards';
    if (bulletCount > 3) return 'two-column';
    if (bulletCount === 0) return 'title-only';
    return 'title-bullets';
}

// ============================================================================
// FOOTER INJECTION (Rule 12E)
// ============================================================================

export interface FooterConfig {
    author?: string;
    date?: string;
    showSlideNumber: boolean;
    showSource?: boolean;
}

/**
 * Adds footer elements to all slides
 */
export function injectFooters(config: FooterConfig): void {
    const store = useDeckStore.getState();
    const deck = selectDeck(store);
    const slideCount = deck.slides.length;

    deck.slides.forEach((slide, index) => {
        // Check if footer already exists (element at bottom of slide)
        const hasFooter = slide.elements.some(
            (el): el is TextElement => el.type === 'text' && el.y > 500
        );

        if (!hasFooter) {
            // Create footer text
            const footerParts: string[] = [];
            if (config.author) footerParts.push(config.author);
            if (config.date) footerParts.push(config.date);
            if (config.showSlideNumber) footerParts.push(`${index + 1} / ${slideCount}`);

            const footerText = footerParts.join('  •  ');

            // Add footer element using the store's method
            store.createStreamingTextElement(slide.id, 60, 530, footerText);
        }
    });
}

// ============================================================================
// POST-PROCESSOR: Main Entry Point
// ============================================================================

export interface PostProcessorOptions {
    normalize: boolean;
    validate: boolean;
    injectFooter: boolean;
    footerConfig?: FooterConfig;
}

export interface PostProcessorResult {
    validation: SlideValidationResult[];
    layoutSuggestions: { slideId: string; current: LayoutType; suggested: LayoutType }[];
    normalized: boolean;
    footersAdded: boolean;
}

/**
 * Main post-processor function
 * Call this after AI generation completes
 */
export function runPostProcessor(options: PostProcessorOptions = {
    normalize: true,
    validate: true,
    injectFooter: false,
}): PostProcessorResult {
    const store = useDeckStore.getState();
    const deck = selectDeck(store);

    const result: PostProcessorResult = {
        validation: [],
        layoutSuggestions: [],
        normalized: false,
        footersAdded: false,
    };

    // Step 1: Validate
    if (options.validate) {
        result.validation = validateDeck(deck);
    }

    // Step 2: Detect Layouts
    deck.slides.forEach((slide) => {
        const detected = detectOptimalLayout(slide);
        result.layoutSuggestions.push({
            slideId: slide.id,
            current: 'title-bullets', // Would need actual detection
            suggested: detected,
        });
    });

    // Step 3: Normalize Styles
    if (options.normalize) {
        normalizeDeckStyles();
        result.normalized = true;
    }

    // Step 4: Inject Footers
    if (options.injectFooter && options.footerConfig) {
        injectFooters(options.footerConfig);
        result.footersAdded = true;
    }

    return result;
}

// ============================================================================
// EXPORT: Convenience Functions
// ============================================================================

export function runQuickValidation(): SlideValidationResult[] {
    const deck = selectDeck(useDeckStore.getState());
    return validateDeck(deck);
}

export function runFullNormalization(): void {
    runPostProcessor({
        normalize: true,
        validate: false,
        injectFooter: true,
        footerConfig: {
            showSlideNumber: true,
            date: formatZonedDate(new Date(), { timeZone: "UTC", dateFormat: "YYYY-MM-DD" }),
        },
    });
}
