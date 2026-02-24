/**
 * PPT/Slides Processor Service
 * 
 * Extracts content from PowerPoint presentations slide-by-slide.
 * Supports .pptx files.
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';

// =============================================================================
// Types
// =============================================================================

export interface SlideContent {
    slideNumber: number;
    title?: string;
    content: string[];
    notes?: string;
    shapes: ShapeInfo[];
    hasImages: boolean;
    hasTables: boolean;
    hasCharts: boolean;
}

export interface ShapeInfo {
    type: 'text' | 'image' | 'table' | 'chart' | 'shape';
    content?: string;
    position?: { x: number; y: number; width: number; height: number };
}

export interface PresentationExtraction {
    title?: string;
    author?: string;
    slideCount: number;
    slides: SlideContent[];
    metadata: {
        created?: Date;
        modified?: Date;
        application?: string;
    };
    fullText: string;
    processingTimeMs: number;
}

// =============================================================================
// PPTX Parsing (using JSZip)
// =============================================================================

async function parsePPTXBuffer(buffer: Buffer): Promise<PresentationExtraction> {
    const startTime = Date.now();
    const zip = await JSZip.loadAsync(buffer);

    const slides: SlideContent[] = [];
    let presentationTitle: string | undefined;
    let author: string | undefined;

    // Parse core properties for metadata
    const coreProps = zip.file('docProps/core.xml');
    if (coreProps) {
        const coreXml = await coreProps.async('string');
        const titleMatch = coreXml.match(/<dc:title>([^<]+)<\/dc:title>/);
        const authorMatch = coreXml.match(/<dc:creator>([^<]+)<\/dc:creator>/);
        if (titleMatch) presentationTitle = titleMatch[1];
        if (authorMatch) author = authorMatch[1];
    }

    // Find all slide files
    const slideFiles = Object.keys(zip.files)
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => {
            const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
            const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
            return numA - numB;
        });

    for (let i = 0; i < slideFiles.length; i++) {
        const slideFile = zip.file(slideFiles[i]);
        if (!slideFile) continue;

        const slideXml = await slideFile.async('string');
        const slideContent = parseSlideXml(slideXml, i + 1);

        // Try to get slide notes
        const notesFile = zip.file(`ppt/notesSlides/notesSlide${i + 1}.xml`);
        if (notesFile) {
            const notesXml = await notesFile.async('string');
            slideContent.notes = extractTextFromXml(notesXml);
        }

        slides.push(slideContent);
    }

    // Combine all text for full-text search
    const fullText = slides
        .map(s => {
            const parts = [s.title, ...s.content];
            if (s.notes) parts.push(`[Notes: ${s.notes}]`);
            return parts.filter(Boolean).join('\n');
        })
        .join('\n\n---\n\n');

    return {
        title: presentationTitle,
        author,
        slideCount: slides.length,
        slides,
        metadata: {
            application: 'Microsoft PowerPoint'
        },
        fullText,
        processingTimeMs: Date.now() - startTime
    };
}

function parseSlideXml(xml: string, slideNumber: number): SlideContent {
    const content: string[] = [];
    const shapes: ShapeInfo[] = [];
    let title: string | undefined;

    // Extract all text content
    const textMatches = xml.matchAll(/<a:t>([^<]*)<\/a:t>/g);
    const allTexts: string[] = [];

    for (const match of textMatches) {
        const text = match[1].trim();
        if (text) allTexts.push(text);
    }

    // First text block is often the title
    if (allTexts.length > 0) {
        // Check if it looks like a title (short, at the top)
        if (allTexts[0].length < 100 && !allTexts[0].includes('\n')) {
            title = allTexts[0];
            content.push(...allTexts.slice(1));
        } else {
            content.push(...allTexts);
        }
    }

    // Detect images
    const hasImages = /<p:pic/.test(xml) || /<a:blip/.test(xml);

    // Detect tables
    const hasTables = /<a:tbl/.test(xml);

    // Detect charts
    const hasCharts = /<c:chart/.test(xml) || /<p:oleObj/.test(xml);

    // Add shape info
    if (hasImages) shapes.push({ type: 'image' });
    if (hasTables) shapes.push({ type: 'table' });
    if (hasCharts) shapes.push({ type: 'chart' });

    return {
        slideNumber,
        title,
        content,
        shapes,
        hasImages,
        hasTables,
        hasCharts
    };
}

function extractTextFromXml(xml: string): string {
    const texts: string[] = [];
    const matches = xml.matchAll(/<a:t>([^<]*)<\/a:t>/g);

    for (const match of matches) {
        const text = match[1].trim();
        if (text) texts.push(text);
    }

    return texts.join(' ');
}

// =============================================================================
// Main Functions
// =============================================================================

export async function extractFromPPTX(buffer: Buffer): Promise<PresentationExtraction> {
    return parsePPTXBuffer(buffer);
}

export async function extractFromPPTXFile(filePath: string): Promise<PresentationExtraction> {
    const buffer = fs.readFileSync(filePath);
    return parsePPTXBuffer(buffer);
}

/**
 * Get a summary of the presentation
 */
export function summarizePresentation(extraction: PresentationExtraction): string {
    const lines: string[] = [];

    if (extraction.title) {
        lines.push(`# ${extraction.title}`);
        lines.push('');
    }

    lines.push(`**Diapositivas:** ${extraction.slideCount}`);
    if (extraction.author) {
        lines.push(`**Autor:** ${extraction.author}`);
    }
    lines.push('');

    for (const slide of extraction.slides) {
        lines.push(`## Slide ${slide.slideNumber}${slide.title ? ': ' + slide.title : ''}`);

        if (slide.content.length > 0) {
            for (const text of slide.content.slice(0, 5)) {
                lines.push(`- ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
            }
        }

        const extras: string[] = [];
        if (slide.hasImages) extras.push('📷 Imágenes');
        if (slide.hasTables) extras.push('📊 Tablas');
        if (slide.hasCharts) extras.push('📈 Gráficos');
        if (slide.notes) extras.push('📝 Notas');

        if (extras.length > 0) {
            lines.push(`*${extras.join(' | ')}*`);
        }

        lines.push('');
    }

    return lines.join('\n');
}

// =============================================================================
// Export
// =============================================================================

export const pptProcessor = {
    extractFromPPTX,
    extractFromPPTXFile,
    summarizePresentation
};

export default pptProcessor;
