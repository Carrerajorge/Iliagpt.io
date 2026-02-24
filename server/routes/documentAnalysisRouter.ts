import { Router, Request, Response } from 'express';
import multer from 'multer';
import { advancedDocumentAnalyzer, AdvancedAnalysisResult } from '../services/advancedDocumentAnalyzer';
import { parseDocument, extractContent } from '../services/documentIngestion';
import { isScannedDocument } from '../services/ocrService';
import { optionalAuth } from '../middleware/optionalAuth';

const router = Router();

// ============================================
// SECURITY LIMITS
// ============================================

/** Maximum file upload size (25MB) */
const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;

/** Maximum text body input length (1MB) */
const MAX_TEXT_BODY_LENGTH = 1_000_000;

/** Maximum allowed analysis modules */
const MAX_ANALYSIS_MODULES = 20;

/** Allowed analysis module names */
const VALID_MODULES = new Set([
  'readability', 'sentiment', 'entities', 'citations',
  'tables', 'structure', 'quality', 'duplicates',
  'coherence', 'density', 'language', 'ocr', 'summary',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE }
});

// Middleware to require auth for document analysis (prevents abuse)
const requireAuthForAnalysis = (req: Request, res: Response, next: Function) => {
  // Allow in development, require auth in production
  if (process.env.NODE_ENV === 'production' && !(req as any).user) {
    return res.status(401).json({ error: 'Authentication required for document analysis' });
  }
  next();
};

/** Security: sanitize error message for client response */
function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Only return safe, non-leaking messages
    if (error.message.includes('timed out')) return 'Operation timed out';
    if (error.message.includes('file type')) return 'Unsupported file type';
    if (error.message.includes('file size') || error.message.includes('exceeds maximum')) return 'File too large';
    return 'Processing failed';
  }
  return 'Unknown error';
}

/** Security: sanitize filename for logging (prevent log injection) */
function safeFileName(name: string): string {
  if (!name || typeof name !== 'string') return 'unknown';
  return name
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[<>"'&\\]/g, '_')
    .substring(0, 255);
}

/** Security: cap text body to prevent memory abuse */
function capTextBody(text: unknown): string {
  if (!text || typeof text !== 'string') return '';
  return text.length > MAX_TEXT_BODY_LENGTH ? text.substring(0, MAX_TEXT_BODY_LENGTH) : text;
}

interface AnalysisOptions {
  includeOCR?: boolean;
  generateSummary?: boolean;
  analysisModules?: string[];
}

router.post('/analyze', optionalAuth, requireAuthForAnalysis, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Security: safe JSON.parse for modules with validation
    let parsedModules: string[] | undefined;
    if (req.body.modules) {
      try {
        const raw = JSON.parse(req.body.modules);
        if (Array.isArray(raw)) {
          parsedModules = raw
            .filter((m: unknown) => typeof m === 'string' && VALID_MODULES.has(m))
            .slice(0, MAX_ANALYSIS_MODULES);
        }
      } catch {
        return res.status(400).json({ error: 'Invalid modules parameter' });
      }
    }

    const options: AnalysisOptions = {
      includeOCR: req.body.includeOCR !== 'false',
      generateSummary: req.body.generateSummary === 'true',
      analysisModules: parsedModules,
    };

    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    const fileName = safeFileName(req.file.originalname);

    console.log(`[DocumentAnalysis] Analyzing: ${fileName} (${mimeType}, ${buffer.length} bytes)`);

    let extractedText = '';
    try {
      const parsed = await parseDocument(buffer, mimeType, fileName);
      if (parsed.sheets && parsed.sheets.length > 0) {
        extractedText = parsed.sheets.map(s =>
          s.previewData.map(row => row.join('\t')).join('\n')
        ).join('\n\n');
      }
    } catch (e) {
      try {
        extractedText = await extractContent(buffer, mimeType);
      } catch {
        console.log('[DocumentAnalysis] Could not extract text, will rely on OCR');
      }
    }

    const result = await advancedDocumentAnalyzer.analyze(
      buffer,
      mimeType,
      extractedText,
      options
    );

    res.json({
      success: true,
      fileName,
      mimeType,
      fileSize: buffer.length,
      analysis: result
    });
  } catch (error) {
    console.error('[DocumentAnalysis] Error:', error);
    res.status(500).json({ error: 'Failed to analyze document' });
  }
});

router.post('/extract-entities', optionalAuth, requireAuthForAnalysis, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    let text = '';
    try {
      text = await extractContent(req.file.buffer, req.file.mimetype);
    } catch {
      const ocrResult = await advancedDocumentAnalyzer.analyze(
        req.file.buffer,
        req.file.mimetype,
        '',
        { includeOCR: true }
      );
      text = ocrResult.extractedText;
    }

    const entities = advancedDocumentAnalyzer.extractNamedEntities(text);
    const citations = advancedDocumentAnalyzer.extractCitations(text);

    res.json({
      success: true,
      entities,
      citations,
      entityCount: entities.length,
      citationCount: citations.length
    });
  } catch (error) {
    console.error('[DocumentAnalysis] Entity extraction error:', error);
    res.status(500).json({ error: 'Failed to extract entities' });
  }
});

router.post('/readability', optionalAuth, requireAuthForAnalysis, upload.single('file'), async (req: Request, res: Response) => {
  try {
    let text = capTextBody(req.body.text);

    if (req.file) {
      try {
        text = await extractContent(req.file.buffer, req.file.mimetype);
      } catch {
        return res.status(400).json({ error: 'Could not extract text from file' });
      }
    }

    if (!text || text.length < 50) {
      return res.status(400).json({ error: 'Text too short for readability analysis (minimum 50 characters)' });
    }

    const readability = advancedDocumentAnalyzer.calculateReadability(text);
    const language = advancedDocumentAnalyzer.detectLanguage(text);
    const density = advancedDocumentAnalyzer.calculateDensity(text, language.code);

    res.json({
      success: true,
      language,
      readability,
      density,
      recommendations: generateReadabilityRecommendations(readability, density)
    });
  } catch (error) {
    console.error('[DocumentAnalysis] Readability error:', error);
    res.status(500).json({ error: 'Failed to calculate readability' });
  }
});

router.post('/quality-check', optionalAuth, requireAuthForAnalysis, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    let text = '';
    try {
      text = await extractContent(req.file.buffer, req.file.mimetype);
    } catch {
      return res.status(400).json({ error: 'Could not extract text from file' });
    }

    const structure = advancedDocumentAnalyzer.analyzeStructure(text);
    const quality = advancedDocumentAnalyzer.analyzeQuality(text, structure);
    const duplicates = advancedDocumentAnalyzer.detectDuplicates(text);
    const coherence = advancedDocumentAnalyzer.analyzeCoherence(text, structure);

    res.json({
      success: true,
      quality,
      duplicates,
      coherence,
      structure: structure.map(s => ({
        level: s.level,
        title: s.title,
        contentLength: s.content.length
      })),
      overallScore: Math.round((quality.score + coherence.score) / 2)
    });
  } catch (error) {
    console.error('[DocumentAnalysis] Quality check error:', error);
    res.status(500).json({ error: 'Failed to check document quality' });
  }
});

router.post('/sentiment', optionalAuth, requireAuthForAnalysis, upload.single('file'), async (req: Request, res: Response) => {
  try {
    let text = capTextBody(req.body.text);

    if (req.file) {
      try {
        text = await extractContent(req.file.buffer, req.file.mimetype);
      } catch {
        return res.status(400).json({ error: 'Could not extract text from file' });
      }
    }

    if (!text || text.length < 20) {
      return res.status(400).json({ error: 'Text too short for sentiment analysis' });
    }

    const language = advancedDocumentAnalyzer.detectLanguage(text);
    const sentiment = advancedDocumentAnalyzer.analyzeSentiment(text, language.code);

    res.json({
      success: true,
      language,
      sentiment
    });
  } catch (error) {
    console.error('[DocumentAnalysis] Sentiment error:', error);
    res.status(500).json({ error: 'Failed to analyze sentiment' });
  }
});

router.post('/detect-language', optionalAuth, requireAuthForAnalysis, async (req: Request, res: Response) => {
  try {
    const text = capTextBody(req.body?.text);

    if (!text || text.length < 20) {
      return res.status(400).json({ error: 'Text too short for language detection (minimum 20 characters)' });
    }

    const language = advancedDocumentAnalyzer.detectLanguage(text);

    res.json({
      success: true,
      language
    });
  } catch (error) {
    console.error('[DocumentAnalysis] Language detection error:', error);
    res.status(500).json({ error: 'Failed to detect language' });
  }
});

router.post('/extract-tables', optionalAuth, requireAuthForAnalysis, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    let text = '';
    try {
      text = await extractContent(req.file.buffer, req.file.mimetype);
    } catch {
      return res.status(400).json({ error: 'Could not extract content from file' });
    }

    const tables = advancedDocumentAnalyzer.extractTables(text);

    res.json({
      success: true,
      tables,
      tableCount: tables.length
    });
  } catch (error) {
    console.error('[DocumentAnalysis] Table extraction error:', error);
    res.status(500).json({ error: 'Failed to extract tables' });
  }
});

router.post('/extract-citations', optionalAuth, requireAuthForAnalysis, upload.single('file'), async (req: Request, res: Response) => {
  try {
    let text = capTextBody(req.body.text);

    if (req.file) {
      try {
        text = await extractContent(req.file.buffer, req.file.mimetype);
      } catch {
        return res.status(400).json({ error: 'Could not extract text from file' });
      }
    }

    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }

    const citations = advancedDocumentAnalyzer.extractCitations(text);

    res.json({
      success: true,
      citations,
      citationCount: citations.length,
      formats: [...new Set(citations.map(c => c.format))]
    });
  } catch (error) {
    console.error('[DocumentAnalysis] Citation extraction error:', error);
    res.status(500).json({ error: 'Failed to extract citations' });
  }
});

router.post('/ocr-check', optionalAuth, requireAuthForAnalysis, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    let extractedText = '';
    try {
      extractedText = await extractContent(req.file.buffer, req.file.mimetype);
    } catch {
      // Ignore - we'll check if OCR is needed
    }

    const needsOCR = isScannedDocument(req.file.buffer, req.file.mimetype, extractedText);

    res.json({
      success: true,
      needsOCR,
      extractedTextLength: extractedText.length,
      recommendation: needsOCR
        ? 'This document appears to be scanned/image-based. OCR will be applied for text extraction.'
        : 'This document has extractable text. OCR is not required.'
    });
  } catch (error) {
    console.error('[DocumentAnalysis] OCR check error:', error);
    res.status(500).json({ error: 'Failed to check OCR requirement' });
  }
});

function generateReadabilityRecommendations(
  readability: ReturnType<typeof advancedDocumentAnalyzer.calculateReadability>,
  density: ReturnType<typeof advancedDocumentAnalyzer.calculateDensity>
): string[] {
  const recommendations: string[] = [];

  if (readability.fleschReadingEase < 30) {
    recommendations.push('Consider simplifying complex sentences to improve readability');
  }
  if (readability.averageGrade > 14) {
    recommendations.push('Text may be too advanced for general audiences - consider using simpler vocabulary');
  }
  if (density.averageSentenceLength > 25) {
    recommendations.push('Break up long sentences for easier comprehension');
  }
  if (density.fillerWordRatio > 0.5) {
    recommendations.push('Consider reducing filler words to increase content density');
  }
  if (density.lexicalDiversity < 0.3) {
    recommendations.push('Use more varied vocabulary to improve engagement');
  }

  if (recommendations.length === 0) {
    recommendations.push('Document readability is good - no major improvements needed');
  }

  return recommendations;
}

export default router;
