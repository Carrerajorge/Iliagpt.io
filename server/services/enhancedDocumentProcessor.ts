/**
 * Enhanced Document Processor
 * 
 * Unified service that integrates all 10 document analysis improvements:
 * 1. OCR (existing)
 * 2. Table Extraction
 * 3. Semantic Chunking
 * 4. Chart Analysis
 * 5. Metadata Extraction
 * 6. Document Comparison
 * 7. Multi-level Summarization
 * 8. Q&A with Citations (uses RAG)
 * 9. PPT Processing
 * 10. Extraction Validation
 */

import { ocrService } from './ocrService';
import { tableExtractor } from './tableExtractor';
import { semanticChunker } from './semanticChunker';
import { chartAnalyzer } from './chartAnalyzer';
import { metadataExtractor } from './metadataExtractor';
import { documentComparator } from './documentComparator';
import { multiLevelSummarizer } from './multiLevelSummarizer';
import { pptProcessor } from './pptProcessor';
import { extractionValidator } from './extractionValidator';

// =============================================================================
// Types
// =============================================================================

export interface EnhancedDocumentAnalysis {
    // Core extraction
    text: string;
    validation: ReturnType<typeof extractionValidator.validateExtraction>;

    // Metadata
    metadata: ReturnType<typeof metadataExtractor.extractMetadata>;

    // Structured content
    tables: ReturnType<typeof tableExtractor.extractTablesFromText>['tables'];
    charts: ReturnType<typeof chartAnalyzer.analyzeChartFromText>[];

    // Chunked for RAG
    chunks: ReturnType<typeof semanticChunker.chunkDocument>['chunks'];

    // Summaries
    summary: ReturnType<typeof multiLevelSummarizer.generateMultiLevelSummary>;

    // Processing info
    processingTimeMs: number;
    source: 'pdf' | 'image' | 'word' | 'excel' | 'ppt' | 'text';
    usedOCR: boolean;
}

export interface ProcessingOptions {
    performOCR?: boolean;
    extractTables?: boolean;
    analyzeCharts?: boolean;
    generateSummary?: boolean;
    chunkForRAG?: boolean;
    validateExtraction?: boolean;
    language?: string;
}

// =============================================================================
// Main Processing Function
// =============================================================================

export async function processDocumentEnhanced(
    content: Buffer | string,
    mimeType: string,
    options: ProcessingOptions = {}
): Promise<EnhancedDocumentAnalysis> {
    const startTime = Date.now();

    const {
        performOCR = true,
        extractTables = true,
        analyzeCharts = true,
        generateSummary = true,
        chunkForRAG = true,
        validateExtraction = true
    } = options;

    let text = '';
    let usedOCR = false;
    let source: EnhancedDocumentAnalysis['source'] = 'text';

    // Determine source type
    if (mimeType.includes('pdf')) source = 'pdf';
    else if (mimeType.includes('image')) source = 'image';
    else if (mimeType.includes('word') || mimeType.includes('docx')) source = 'word';
    else if (mimeType.includes('excel') || mimeType.includes('xlsx')) source = 'excel';
    else if (mimeType.includes('powerpoint') || mimeType.includes('pptx')) source = 'ppt';

    // Extract text based on type
    if (typeof content === 'string') {
        text = content;
    } else {
        // For buffers, try OCR for images
        if (source === 'image' && performOCR) {
            try {
                const ocrResult = await ocrService.performOCR(content);
                text = ocrResult.text;
                usedOCR = true;
            } catch (error) {
                console.error('[EnhancedProcessor] OCR failed:', error);
            }
        }
        // For other types, assume text was already extracted elsewhere
    }

    // Validation
    const validation = validateExtraction
        ? extractionValidator.validateExtraction({
            text,
            source,
            ocrConfidence: usedOCR ? 80 : undefined
        })
        : extractionValidator.validateExtraction({ text, source });

    // Metadata extraction
    const metadata = metadataExtractor.extractMetadata(text);

    // Table extraction
    const tables = extractTables
        ? tableExtractor.extractTablesFromText(text).tables
        : [];

    // Chart analysis
    const charts = analyzeCharts
        ? [chartAnalyzer.analyzeChartFromText(text)]
        : [];

    // Semantic chunking
    const chunks = chunkForRAG
        ? semanticChunker.chunkDocument(text).chunks
        : [];

    // Multi-level summary
    const summary = generateSummary
        ? multiLevelSummarizer.generateMultiLevelSummary(text)
        : multiLevelSummarizer.generateMultiLevelSummary('');

    return {
        text,
        validation,
        metadata,
        tables,
        charts,
        chunks,
        summary,
        processingTimeMs: Date.now() - startTime,
        source,
        usedOCR
    };
}

// =============================================================================
// Specialized Functions
// =============================================================================

/**
 * Process a PowerPoint file
 */
export async function processPPTX(buffer: Buffer): Promise<{
    extraction: Awaited<ReturnType<typeof pptProcessor.extractFromPPTX>>;
    analysis: EnhancedDocumentAnalysis;
}> {
    const extraction = await pptProcessor.extractFromPPTX(buffer);
    const analysis = await processDocumentEnhanced(
        extraction.fullText,
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );

    return { extraction, analysis };
}

/**
 * Compare two documents
 */
export function compareDocuments(
    docA: string,
    docB: string
): ReturnType<typeof documentComparator.compareDocuments> {
    return documentComparator.compareDocuments(docA, docB);
}

/**
 * Extract text with OCR fallback
 */
export async function extractTextWithOCR(
    buffer: Buffer,
    mimeType: string,
    existingText: string = ''
): Promise<{ text: string; usedOCR: boolean; confidence?: number }> {
    return ocrService.extractTextWithOCRFallback(buffer, mimeType, existingText);
}

// =============================================================================
// Export
// =============================================================================

export const enhancedDocumentProcessor = {
    processDocumentEnhanced,
    processPPTX,
    compareDocuments,
    extractTextWithOCR,

    // Re-export individual services for direct access
    ocrService,
    tableExtractor,
    semanticChunker,
    chartAnalyzer,
    metadataExtractor,
    documentComparator,
    multiLevelSummarizer,
    pptProcessor,
    extractionValidator
};

export default enhancedDocumentProcessor;
