import JSZip from "jszip";
import type { FileParser, ParsedResult, DetectedFileType } from "./base";

// Security limits
const PPTX_MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const PPTX_MAX_SLIDES = 500;
const PPTX_MAX_TEXT_PER_SLIDE = 500_000; // 500KB per slide text
const PPTX_MAX_METADATA_VALUE_LENGTH = 1000;

/** Sanitize metadata values */
function sanitizeMetadataValue(value: string): string {
  return String(value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .substring(0, PPTX_MAX_METADATA_VALUE_LENGTH);
}

interface SlideContent {
  slideNumber: number;
  title: string;
  content: string[];
  notes: string;
  hasTable: boolean;
}

export class PptxParser implements FileParser {
  name = "pptx";
  supportedMimeTypes = [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
  ];

  async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
    const startTime = Date.now();
    console.log(`[PptxParser] Starting PowerPoint parse, size: ${content.length} bytes`);

    // Security: enforce file size limit
    if (content.length > PPTX_MAX_FILE_SIZE) {
      throw new Error(`PowerPoint file exceeds maximum size of ${PPTX_MAX_FILE_SIZE / (1024 * 1024)}MB`);
    }

    try {
      const zip = await JSZip.loadAsync(content);
      
      const [slides, metadata] = await Promise.all([
        this.extractSlides(zip),
        this.extractMetadata(zip),
      ]);

      const formattedText = this.formatOutput(metadata, slides);
      
      const elapsed = Date.now() - startTime;
      console.log(`[PptxParser] Completed in ${elapsed}ms, ${slides.length} slides extracted`);

      return {
        text: formattedText,
        metadata: {
          ...metadata,
          slideCount: slides.length,
        },
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`[PptxParser] Failed after ${elapsed}ms:`, error);
      
      if (error instanceof Error) {
        throw new Error(`Failed to parse PowerPoint: ${error.message}`);
      }
      throw new Error("Failed to parse PowerPoint: Unknown error");
    }
  }

  private async extractMetadata(zip: JSZip): Promise<Record<string, any>> {
    const metadata: Record<string, any> = {};

    try {
      const coreXml = await zip.file("docProps/core.xml")?.async("string");
      
      if (coreXml) {
        const titleMatch = coreXml.match(/<dc:title>([^<]*)<\/dc:title>/);
        if (titleMatch) metadata.title = sanitizeMetadataValue(titleMatch[1]);

        const creatorMatch = coreXml.match(/<dc:creator>([^<]*)<\/dc:creator>/);
        if (creatorMatch) metadata.author = sanitizeMetadataValue(creatorMatch[1]);

        const createdMatch = coreXml.match(/<dcterms:created[^>]*>([^<]*)<\/dcterms:created>/);
        if (createdMatch) metadata.creationDate = this.formatDate(createdMatch[1]);
      }

      const appXml = await zip.file("docProps/app.xml")?.async("string");
      if (appXml) {
        const slidesMatch = appXml.match(/<Slides>(\d+)<\/Slides>/);
        if (slidesMatch) metadata.totalSlides = parseInt(slidesMatch[1], 10);
        
        const companyMatch = appXml.match(/<Company>([^<]*)<\/Company>/);
        if (companyMatch) metadata.company = sanitizeMetadataValue(companyMatch[1]);
      }
    } catch (error) {
      console.warn("[PptxParser] Could not extract metadata:", error);
    }

    return metadata;
  }

  private formatDate(isoDate: string): string {
    try {
      const date = new Date(isoDate);
      return date.toISOString().split('T')[0];
    } catch {
      return isoDate;
    }
  }

  private async extractSlides(zip: JSZip): Promise<SlideContent[]> {
    const slides: SlideContent[] = [];
    const slideFiles: { name: string; num: number }[] = [];

    zip.forEach((path, file) => {
      const match = path.match(/ppt\/slides\/slide(\d+)\.xml$/);
      if (match) {
        slideFiles.push({ name: path, num: parseInt(match[1], 10) });
      }
    });

    slideFiles.sort((a, b) => a.num - b.num);

    // Security: limit number of slides processed
    if (slideFiles.length > PPTX_MAX_SLIDES) {
      console.warn(`[PptxParser] Presentation has ${slideFiles.length} slides, limiting to ${PPTX_MAX_SLIDES}`);
      slideFiles.length = PPTX_MAX_SLIDES;
    }

    for (const slideFile of slideFiles) {
      try {
        const slideXml = await zip.file(slideFile.name)?.async("string");
        if (slideXml) {
          const slideContent = this.parseSlideXml(slideXml, slideFile.num);
          
          const notesPath = `ppt/notesSlides/notesSlide${slideFile.num}.xml`;
          const notesXml = await zip.file(notesPath)?.async("string");
          if (notesXml) {
            slideContent.notes = this.extractNotesFromXml(notesXml);
          }
          
          slides.push(slideContent);
        }
      } catch (error) {
        console.warn(`[PptxParser] Failed to parse slide ${slideFile.num}:`, error);
      }
    }

    return slides;
  }

  private parseSlideXml(xml: string, slideNumber: number): SlideContent {
    const content: SlideContent = {
      slideNumber,
      title: '',
      content: [],
      notes: '',
      hasTable: false,
    };

    const titleMatch = xml.match(/<p:ph[^>]*type="title"[^>]*>[\s\S]*?<a:t>([^<]+)<\/a:t>/i) ||
                       xml.match(/<p:ph[^>]*type="ctrTitle"[^>]*>[\s\S]*?<a:t>([^<]+)<\/a:t>/i);
    
    if (!titleMatch) {
      const firstTextMatch = xml.match(/<p:sp>[\s\S]*?<a:t>([^<]+)<\/a:t>/);
      if (firstTextMatch && firstTextMatch[1].length < 100) {
        content.title = this.cleanText(firstTextMatch[1]);
      }
    } else {
      content.title = this.cleanText(titleMatch[1]);
    }

    const textParagraphs = this.extractTextParagraphs(xml);
    content.content = textParagraphs;

    if (xml.includes('<a:tbl>') || xml.includes('<a:graphicData')) {
      content.hasTable = true;
      const tableContent = this.extractTables(xml);
      if (tableContent) {
        content.content.push(tableContent);
      }
    }

    return content;
  }

  private extractTextParagraphs(xml: string): string[] {
    const paragraphs: string[] = [];
    const processedTexts = new Set<string>();
    let totalTextLength = 0;

    const paragraphMatches = Array.from(xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g));
    
    for (const match of paragraphMatches) {
      const paraXml = match[1];
      
      const pPrMatch = paraXml.match(/<a:pPr[^>]*>/);
      let bulletPrefix = '';
      let indent = 0;
      
      if (pPrMatch) {
        const lvlMatch = pPrMatch[0].match(/lvl="(\d+)"/);
        if (lvlMatch) {
          indent = parseInt(lvlMatch[1], 10);
        }
        
        if (paraXml.includes('<a:buChar') || paraXml.includes('<a:buAutoNum')) {
          bulletPrefix = '  '.repeat(indent) + '- ';
        } else if (paraXml.includes('<a:buNone')) {
          bulletPrefix = '  '.repeat(indent);
        } else if (indent > 0) {
          bulletPrefix = '  '.repeat(indent) + '- ';
        }
      }
      
      const textParts: string[] = [];
      const textMatches = Array.from(paraXml.matchAll(/<a:t>([^<]*)<\/a:t>/g));
      
      for (const textMatch of textMatches) {
        textParts.push(textMatch[1]);
      }
      
      const fullText = textParts.join('').trim();
      
      if (fullText && !processedTexts.has(fullText)) {
        // Security: limit total extracted text per slide
        totalTextLength += fullText.length;
        if (totalTextLength > PPTX_MAX_TEXT_PER_SLIDE) break;

        processedTexts.add(fullText);
        paragraphs.push(bulletPrefix + this.cleanText(fullText));
      }
    }

    return paragraphs.filter(p => p.trim().length > 0);
  }

  private extractTables(xml: string): string {
    const tables: string[] = [];
    const tableMatches = Array.from(xml.matchAll(/<a:tbl>([\s\S]*?)<\/a:tbl>/g));

    for (const tableMatch of tableMatches) {
      const tableXml = tableMatch[1];
      const rows: string[][] = [];
      
      const rowMatches = Array.from(tableXml.matchAll(/<a:tr[^>]*>([\s\S]*?)<\/a:tr>/g));
      
      for (const rowMatch of rowMatches) {
        const rowXml = rowMatch[1];
        const cells: string[] = [];
        
        const cellMatches = Array.from(rowXml.matchAll(/<a:tc[^>]*>([\s\S]*?)<\/a:tc>/g));
        
        for (const cellMatch of cellMatches) {
          const cellTexts: string[] = [];
          const textMatches = Array.from(cellMatch[1].matchAll(/<a:t>([^<]*)<\/a:t>/g));
          
          for (const textMatch of textMatches) {
            cellTexts.push(textMatch[1]);
          }
          
          cells.push(this.cleanText(cellTexts.join(' ')));
        }
        
        if (cells.length > 0) {
          rows.push(cells);
        }
      }

      if (rows.length > 0) {
        tables.push(this.formatTableAsMarkdown(rows));
      }
    }

    return tables.join('\n\n');
  }

  private formatTableAsMarkdown(rows: string[][]): string {
    if (rows.length === 0) return '';

    const maxCols = Math.max(...rows.map(r => r.length));
    const normalizedRows = rows.map(row => {
      while (row.length < maxCols) row.push('');
      return row;
    });

    const lines: string[] = [];
    lines.push('| ' + normalizedRows[0].join(' | ') + ' |');
    lines.push('| ' + normalizedRows[0].map(() => '---').join(' | ') + ' |');
    
    for (let i = 1; i < normalizedRows.length; i++) {
      lines.push('| ' + normalizedRows[i].join(' | ') + ' |');
    }

    return lines.join('\n');
  }

  private extractNotesFromXml(xml: string): string {
    const notes: string[] = [];
    const textMatches = Array.from(xml.matchAll(/<a:t>([^<]*)<\/a:t>/g));
    
    for (const match of textMatches) {
      const text = this.cleanText(match[1]);
      if (text && !text.match(/^\d+$/) && text.length > 2) {
        notes.push(text);
      }
    }

    const uniqueNotes = Array.from(new Set(notes));
    return uniqueNotes.join(' ').trim();
  }

  private cleanText(text: string): string {
    return text
      .replace(/\u0000/g, '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2013/g, '-')
      .replace(/\u2014/g, '--')
      .replace(/\u2026/g, '...')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private formatOutput(metadata: Record<string, any>, slides: SlideContent[]): string {
    const parts: string[] = [];
    
    parts.push('=== Presentation Info ===');
    if (metadata.title) parts.push(`Title: ${metadata.title}`);
    if (metadata.author) parts.push(`Author: ${metadata.author}`);
    if (metadata.company) parts.push(`Company: ${metadata.company}`);
    if (metadata.creationDate) parts.push(`Created: ${metadata.creationDate}`);
    parts.push(`Slides: ${slides.length}`);
    parts.push('');

    for (const slide of slides) {
      const titlePart = slide.title ? `: ${slide.title}` : '';
      parts.push(`=== Slide ${slide.slideNumber}${titlePart} ===`);
      
      if (slide.content.length > 0) {
        parts.push(slide.content.join('\n'));
      }
      
      if (slide.notes) {
        parts.push('');
        parts.push(`[Speaker Notes: ${slide.notes}]`);
      }
      
      parts.push('');
    }

    return parts.join('\n').trim();
  }
}
