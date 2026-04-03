import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import os from 'os';

export interface OCROptions {
  languages?: string[];
  minConfidence?: number;
  enablePreprocessing?: boolean;
  enableMultiPass?: boolean;
  maxDimension?: number;
  timeout?: number;
}

export interface OCRResult {
  text: string;
  confidence: number;
  words?: Array<{
    text: string;
    confidence: number;
    bbox?: { x0: number; y0: number; x1: number; y1: number };
  }>;
  paragraphs?: string[];
  processingTimeMs?: number;
  passUsed?: string;
  imageMetadata?: {
    width: number;
    height: number;
    format: string;
    preprocessed: boolean;
  };
}

const DEFAULT_LANGUAGES = ['eng', 'spa', 'fra', 'deu', 'por', 'ita'];
const MIN_TEXT_LENGTH_THRESHOLD = 50;
const MIN_TEXT_RATIO_THRESHOLD = 0.01;
const OCR_TIMEOUT_MS = 30_000;
const MAX_DIMENSION = 4096;
const MIN_DIMENSION_FOR_UPSCALE = 300;
const OPTIMAL_DPI_WIDTH = 2400;

const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/webp',
  'image/avif',
  'image/heif',
  'image/heic',
];

let workerPool: Tesseract.Worker[] = [];
let poolInitialized = false;
const POOL_SIZE = Math.min(4, Math.max(1, Math.floor((os.cpus()?.length || 2) / 2)));
let poolInitPromise: Promise<void> | null = null;

async function getWorkerFromPool(langString: string): Promise<Tesseract.Worker> {
  if (!poolInitialized && !poolInitPromise) {
    poolInitPromise = initWorkerPool(langString);
  }
  if (poolInitPromise) {
    await poolInitPromise;
  }

  if (workerPool.length > 0) {
    return workerPool[Math.floor(Math.random() * workerPool.length)];
  }

  const worker = await Tesseract.createWorker(langString);
  return worker;
}

async function initWorkerPool(langString: string): Promise<void> {
  try {
    const workers = await Promise.all(
      Array.from({ length: POOL_SIZE }, () => Tesseract.createWorker(langString))
    );
    workerPool = workers;
    poolInitialized = true;
    console.log(`[OCR] Worker pool initialized: ${POOL_SIZE} workers (${langString})`);
  } catch (err) {
    console.warn(`[OCR] Worker pool init failed, will use on-demand workers:`, err);
    poolInitialized = true;
  }
}

export function isImageMimeType(mimeType: string): boolean {
  return SUPPORTED_IMAGE_TYPES.includes(mimeType.toLowerCase());
}

export function isScannedDocument(
  buffer: Buffer,
  mimeType: string,
  extractedText?: string
): boolean {
  if (isImageMimeType(mimeType)) {
    return true;
  }

  if (mimeType === 'application/pdf') {
    if (!extractedText || extractedText.trim().length === 0) {
      return true;
    }

    const cleanText = extractedText.replace(/\s+/g, ' ').trim();

    if (cleanText.length < MIN_TEXT_LENGTH_THRESHOLD) {
      return true;
    }

    const alphanumericRatio = (cleanText.match(/[a-zA-Z0-9]/g)?.length || 0) / cleanText.length;
    if (alphanumericRatio < MIN_TEXT_RATIO_THRESHOLD) {
      return true;
    }

    const wordCount = cleanText.split(/\s+/).filter(w => w.length > 1).length;
    if (wordCount < 10) {
      return true;
    }
  }

  return false;
}

async function preprocessImage(buffer: Buffer, variant: string = 'standard'): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width || 800;
  const height = metadata.height || 600;

  let pipeline = sharp(buffer);

  if (variant === 'standard') {
    if (width < MIN_DIMENSION_FOR_UPSCALE || height < MIN_DIMENSION_FOR_UPSCALE) {
      const scale = Math.max(MIN_DIMENSION_FOR_UPSCALE / width, MIN_DIMENSION_FOR_UPSCALE / height, 2);
      pipeline = pipeline.resize(Math.round(width * scale), Math.round(height * scale), {
        kernel: sharp.kernel.lanczos3,
        fit: 'inside',
      });
    } else if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, {
        kernel: sharp.kernel.lanczos3,
        fit: 'inside',
        withoutEnlargement: true,
      });
    } else if (width < OPTIMAL_DPI_WIDTH && width > 500) {
      const scale = Math.min(OPTIMAL_DPI_WIDTH / width, 3);
      pipeline = pipeline.resize(Math.round(width * scale), null, {
        kernel: sharp.kernel.lanczos3,
        fit: 'inside',
      });
    }

    pipeline = pipeline
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.5, m1: 1.0, m2: 0.5 })
      .png({ compressionLevel: 1 });

  } else if (variant === 'high_contrast') {
    if (width < OPTIMAL_DPI_WIDTH && width > 300) {
      const scale = Math.min(OPTIMAL_DPI_WIDTH / width, 3);
      pipeline = pipeline.resize(Math.round(width * scale), null, {
        kernel: sharp.kernel.lanczos3,
        fit: 'inside',
      });
    }

    pipeline = pipeline
      .grayscale()
      .normalize()
      .linear(1.8, -(128 * 1.8 - 128))
      .sharpen({ sigma: 2.0, m1: 1.5, m2: 0.7 })
      .threshold(140)
      .png({ compressionLevel: 1 });

  } else if (variant === 'denoise') {
    if (width < OPTIMAL_DPI_WIDTH && width > 300) {
      const scale = Math.min(OPTIMAL_DPI_WIDTH / width, 3);
      pipeline = pipeline.resize(Math.round(width * scale), null, {
        kernel: sharp.kernel.lanczos3,
        fit: 'inside',
      });
    }

    pipeline = pipeline
      .grayscale()
      .median(3)
      .normalize()
      .sharpen({ sigma: 1.0, m1: 0.8, m2: 0.3 })
      .png({ compressionLevel: 1 });

  } else if (variant === 'inverted') {
    if (width < OPTIMAL_DPI_WIDTH && width > 300) {
      const scale = Math.min(OPTIMAL_DPI_WIDTH / width, 3);
      pipeline = pipeline.resize(Math.round(width * scale), null, {
        kernel: sharp.kernel.lanczos3,
        fit: 'inside',
      });
    }

    pipeline = pipeline
      .grayscale()
      .negate()
      .normalize()
      .sharpen({ sigma: 1.5, m1: 1.0, m2: 0.5 })
      .png({ compressionLevel: 1 });
  }

  return pipeline.toBuffer();
}

async function runOCRPass(
  buffer: Buffer,
  langString: string,
  passName: string
): Promise<OCRResult & { passUsed: string }> {
  const worker = await getWorkerFromPool(langString);

  const result = await worker.recognize(buffer);

  const data = result.data;

  const words = ((data as any).words || []).map((word: any) => ({
    text: word.text,
    confidence: word.confidence,
    bbox: word.bbox ? {
      x0: word.bbox.x0,
      y0: word.bbox.y0,
      x1: word.bbox.x1,
      y1: word.bbox.y1,
    } : undefined,
  }));

  const paragraphs = ((data as any).paragraphs || []).map((p: any) => p.text);

  return {
    text: data.text || '',
    confidence: data.confidence || 0,
    words,
    paragraphs,
    passUsed: passName,
  };
}

function scoreResult(result: OCRResult): number {
  const textLen = result.text.trim().length;
  if (textLen === 0) return 0;

  const confidenceScore = (result.confidence || 0) / 100;

  const cleanText = result.text.replace(/[^a-zA-Z0-9áéíóúñüÁÉÍÓÚÑÜàèìòùâêîôûäëïöü\s.,;:!?()-]/g, '');
  const readableRatio = cleanText.length / Math.max(result.text.length, 1);

  const wordCount = result.text.split(/\s+/).filter(w => w.length > 1).length;
  const avgWordLen = wordCount > 0
    ? result.text.split(/\s+/).filter(w => w.length > 1).reduce((sum, w) => sum + w.length, 0) / wordCount
    : 0;
  const wordQuality = avgWordLen >= 2 && avgWordLen <= 20 ? 1 : 0.5;

  return (confidenceScore * 0.4) + (readableRatio * 0.3) + (Math.min(wordCount / 50, 1) * 0.2) + (wordQuality * 0.1);
}

export async function performOCR(
  buffer: Buffer,
  options: OCROptions = {}
): Promise<OCRResult> {
  const startTime = Date.now();
  const languages = options.languages || DEFAULT_LANGUAGES;
  const langString = languages.join('+');
  const enablePreprocessing = options.enablePreprocessing !== false;
  const enableMultiPass = options.enableMultiPass !== false;
  const timeout = options.timeout || OCR_TIMEOUT_MS;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('OCR timeout exceeded')), timeout)
  );

  try {
    let metadata: sharp.Metadata | undefined;
    try {
      metadata = await sharp(buffer).metadata();
    } catch {
      metadata = undefined;
    }

    if (!enablePreprocessing) {
      const result = await Promise.race([
        runOCRPass(buffer, langString, 'raw'),
        timeoutPromise,
      ]);
      result.processingTimeMs = Date.now() - startTime;
      if (metadata) {
        result.imageMetadata = {
          width: metadata.width || 0,
          height: metadata.height || 0,
          format: metadata.format || 'unknown',
          preprocessed: false,
        };
      }
      return result;
    }

    const standardBuffer = await preprocessImage(buffer, 'standard');
    const standardResult = await Promise.race([
      runOCRPass(standardBuffer, langString, 'standard'),
      timeoutPromise,
    ]);

    if (!enableMultiPass || standardResult.confidence >= 85) {
      standardResult.processingTimeMs = Date.now() - startTime;
      if (metadata) {
        standardResult.imageMetadata = {
          width: metadata.width || 0,
          height: metadata.height || 0,
          format: metadata.format || 'unknown',
          preprocessed: true,
        };
      }
      console.log(`[OCR] Single pass sufficient: confidence=${standardResult.confidence.toFixed(1)}%, text=${standardResult.text.length} chars, time=${standardResult.processingTimeMs}ms`);
      return standardResult;
    }

    const remainingTime = timeout - (Date.now() - startTime);
    if (remainingTime < 5000) {
      standardResult.processingTimeMs = Date.now() - startTime;
      return standardResult;
    }

    const additionalPasses: Promise<OCRResult & { passUsed: string }>[] = [];

    if (standardResult.confidence < 60) {
      const highContrastBuffer = await preprocessImage(buffer, 'high_contrast');
      additionalPasses.push(runOCRPass(highContrastBuffer, langString, 'high_contrast'));
    }

    if (standardResult.confidence < 70) {
      const denoiseBuffer = await preprocessImage(buffer, 'denoise');
      additionalPasses.push(runOCRPass(denoiseBuffer, langString, 'denoise'));
    }

    if (standardResult.confidence < 50) {
      const invertedBuffer = await preprocessImage(buffer, 'inverted');
      additionalPasses.push(runOCRPass(invertedBuffer, langString, 'inverted'));
    }

    const allResults = [standardResult];
    if (additionalPasses.length > 0) {
      const settled = await Promise.allSettled(
        additionalPasses.map(p => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('pass timeout')), remainingTime))]))
      );
      for (const s of settled) {
        if (s.status === 'fulfilled') {
          allResults.push(s.value);
        }
      }
    }

    let bestResult = allResults[0];
    let bestScore = scoreResult(bestResult);
    for (let i = 1; i < allResults.length; i++) {
      const score = scoreResult(allResults[i]);
      if (score > bestScore) {
        bestScore = score;
        bestResult = allResults[i];
      }
    }

    bestResult.processingTimeMs = Date.now() - startTime;
    if (metadata) {
      bestResult.imageMetadata = {
        width: metadata.width || 0,
        height: metadata.height || 0,
        format: metadata.format || 'unknown',
        preprocessed: true,
      };
    }

    console.log(`[OCR] Multi-pass complete: best="${bestResult.passUsed}" confidence=${bestResult.confidence.toFixed(1)}%, passes=${allResults.length}, text=${bestResult.text.length} chars, time=${bestResult.processingTimeMs}ms`);

    return bestResult;
  } catch (error: any) {
    if (error?.message === 'OCR timeout exceeded') {
      console.warn(`[OCR] Timeout after ${timeout}ms, attempting raw pass...`);
      try {
        const fallback = await runOCRPass(buffer, langString, 'raw_fallback');
        fallback.processingTimeMs = Date.now() - startTime;
        return fallback;
      } catch {
        throw error;
      }
    }
    console.error('[OCR] Processing error:', error);
    throw new Error(`Failed to perform OCR: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function extractTextFromImage(
  buffer: Buffer,
  mimeType: string,
  options: OCROptions = {}
): Promise<OCRResult> {
  if (!isImageMimeType(mimeType)) {
    throw new Error(`Unsupported image type: ${mimeType}. Supported types: ${SUPPORTED_IMAGE_TYPES.join(', ')}`);
  }

  return performOCR(buffer, options);
}

export async function extractTextWithOCRFallback(
  buffer: Buffer,
  mimeType: string,
  extractedText: string,
  options: OCROptions = {}
): Promise<{ text: string; usedOCR: boolean; confidence?: number }> {
  if (!isScannedDocument(buffer, mimeType, extractedText)) {
    return {
      text: extractedText,
      usedOCR: false,
    };
  }

  try {
    const ocrResult = await performOCR(buffer, options);

    if (ocrResult.text.trim().length > extractedText.trim().length) {
      return {
        text: ocrResult.text,
        usedOCR: true,
        confidence: ocrResult.confidence,
      };
    }

    return {
      text: extractedText || ocrResult.text,
      usedOCR: extractedText.trim().length === 0,
      confidence: ocrResult.confidence,
    };
  } catch (error) {
    console.error('[OCR] Fallback failed:', error);
    return {
      text: extractedText,
      usedOCR: false,
    };
  }
}

export async function batchOCR(
  images: Array<{ buffer: Buffer; id?: string }>,
  options: OCROptions = {}
): Promise<Array<OCRResult & { id?: string }>> {
  const concurrency = Math.min(POOL_SIZE, images.length);
  const results: Array<OCRResult & { id?: string }> = [];

  for (let i = 0; i < images.length; i += concurrency) {
    const batch = images.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (img) => {
        const result = await performOCR(img.buffer, options);
        return { ...result, id: img.id };
      })
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        results.push({
          text: '',
          confidence: 0,
          words: [],
          paragraphs: [],
          id: undefined,
        });
      }
    }
  }

  return results;
}

export async function shutdownWorkerPool(): Promise<void> {
  for (const worker of workerPool) {
    try {
      await worker.terminate();
    } catch {}
  }
  workerPool = [];
  poolInitialized = false;
  poolInitPromise = null;
  console.log('[OCR] Worker pool shut down');
}

export const ocrService = {
  isScannedDocument,
  performOCR,
  extractTextFromImage,
  extractTextWithOCRFallback,
  batchOCR,
  shutdownWorkerPool,
  isImageMimeType,
  SUPPORTED_IMAGE_TYPES,
  DEFAULT_LANGUAGES,
};

export default ocrService;
