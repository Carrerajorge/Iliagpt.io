import Tesseract from 'tesseract.js';
import { BoundingBox } from './groundingDino';

export interface OcrResult {
    text: string;
    confidence: number;
    bbox: BoundingBox;
}

export class ElementDetector {
    async detectText(imageBuffer: Buffer): Promise<OcrResult[]> {
        console.log('[Vision][OCR] Running Tesseract OCR on frame...');
        try {
            // Se usa eng+spa para el target principal
            const { data } = await Tesseract.recognize(imageBuffer, 'eng+spa', {
                logger: () => { } // Silence verbose logging
            });

            return data.words.map(word => ({
                text: word.text,
                confidence: word.confidence,
                bbox: {
                    x0: word.bbox.x0,
                    y0: word.bbox.y0,
                    x1: word.bbox.x1,
                    y1: word.bbox.y1,
                    confidence: word.confidence,
                    label: 'text'
                }
            }));
        } catch (e) {
            console.error('[Vision][OCR] Tesseract extraction failed:', e);
            return [];
        }
    }
}

export const elementDetector = new ElementDetector();
