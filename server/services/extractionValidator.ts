/**
 * Extraction Validator Service
 * 
 * Validates the quality of document extraction before analysis.
 * Detects issues like:
 * - Missing pages
 * - Poor OCR quality
 * - Corrupted content
 * - Truncated documents
 */

// =============================================================================
// Types
// =============================================================================

export interface ValidationResult {
    isValid: boolean;
    quality: 'excellent' | 'good' | 'fair' | 'poor';
    score: number; // 0-100
    issues: ValidationIssue[];
    suggestions: string[];
    canProceed: boolean;
}

export interface ValidationIssue {
    type: ValidationIssueType;
    severity: 'critical' | 'warning' | 'info';
    message: string;
    location?: { page?: number; position?: number };
    fix?: string;
}

export type ValidationIssueType =
    | 'empty_content'
    | 'too_short'
    | 'low_ocr_confidence'
    | 'garbled_text'
    | 'missing_pages'
    | 'truncated'
    | 'encoding_issues'
    | 'excessive_whitespace'
    | 'repeated_content'
    | 'no_text_found';

export interface ExtractionData {
    text: string;
    pageCount?: number;
    ocrConfidence?: number;
    source: 'pdf' | 'image' | 'word' | 'excel' | 'ppt' | 'text';
    metadata?: {
        expectedPages?: number;
        fileSize?: number;
        mimeType?: string;
    };
}

// =============================================================================
// Validation Thresholds
// =============================================================================

const THRESHOLDS = {
    minTextLength: 50,
    minWordsPerPage: 20,
    minOCRConfidence: 60,
    maxRepeatedRatio: 0.3,
    minAlphanumericRatio: 0.5,
    maxWhitespaceRatio: 0.5,
    garbledTextPatterns: [
        /[^\x00-\x7F\u00C0-\u024F\u1E00-\u1EFF]{5,}/g, // Non-Latin characters in Latin text
        /(.)\1{10,}/g, // Same character repeated 10+ times
        /[^a-zA-Z0-9\s.,;:!?'"()\-–—\u00C0-\u024F]{20,}/g // Long sequences of special chars
    ]
};

// =============================================================================
// Main Validation Function
// =============================================================================

export function validateExtraction(data: ExtractionData): ValidationResult {
    const issues: ValidationIssue[] = [];
    let score = 100;

    const { text, pageCount, ocrConfidence, source, metadata } = data;

    // 1. Check for empty content
    if (!text || text.trim().length === 0) {
        issues.push({
            type: 'empty_content',
            severity: 'critical',
            message: 'No se extrajo ningún contenido del documento',
            fix: source === 'image' || source === 'pdf'
                ? 'Intenta usar OCR para documentos escaneados'
                : 'Verifica que el archivo no esté corrupto'
        });
        score -= 50;
    }

    // 2. Check minimum length
    if (text.length < THRESHOLDS.minTextLength) {
        issues.push({
            type: 'too_short',
            severity: 'warning',
            message: `El contenido extraído es muy corto (${text.length} caracteres)`,
            fix: 'El documento podría estar mayormente vacío o ser una imagen sin OCR'
        });
        score -= 20;
    }

    // 3. Check OCR confidence
    if (ocrConfidence !== undefined && ocrConfidence < THRESHOLDS.minOCRConfidence) {
        issues.push({
            type: 'low_ocr_confidence',
            severity: 'warning',
            message: `Baja confianza en OCR (${ocrConfidence.toFixed(1)}%)`,
            fix: 'La calidad de la imagen podría ser baja. Intenta con una mejor resolución.'
        });
        score -= Math.round((THRESHOLDS.minOCRConfidence - ocrConfidence) / 2);
    }

    // 4. Check for garbled text
    for (const pattern of THRESHOLDS.garbledTextPatterns) {
        const matches = text.match(pattern);
        if (matches && matches.length > 3) {
            issues.push({
                type: 'garbled_text',
                severity: 'warning',
                message: 'Se detectó texto posiblemente corrupto o mal codificado',
                fix: 'Verifica la codificación del archivo o usa OCR'
            });
            score -= 15;
            break;
        }
    }

    // 5. Check alphanumeric ratio
    const alphanumeric = (text.match(/[a-zA-Z0-9\u00C0-\u024F]/g) || []).length;
    const alphanumericRatio = alphanumeric / text.length;
    if (alphanumericRatio < THRESHOLDS.minAlphanumericRatio && text.length > 100) {
        issues.push({
            type: 'garbled_text',
            severity: 'warning',
            message: `Bajo porcentaje de texto legible (${(alphanumericRatio * 100).toFixed(1)}%)`,
            fix: 'El documento podría contener principalmente símbolos o estar mal procesado'
        });
        score -= 15;
    }

    // 6. Check excessive whitespace
    const whitespace = (text.match(/\s/g) || []).length;
    const whitespaceRatio = whitespace / text.length;
    if (whitespaceRatio > THRESHOLDS.maxWhitespaceRatio && text.length > 100) {
        issues.push({
            type: 'excessive_whitespace',
            severity: 'info',
            message: `Alto porcentaje de espacios en blanco (${(whitespaceRatio * 100).toFixed(1)}%)`,
            fix: 'El documento podría tener un formato inusual'
        });
        score -= 5;
    }

    // 7. Check for repeated content
    const words = text.split(/\s+/);
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    const repetitionRatio = 1 - (uniqueWords.size / words.length);
    if (repetitionRatio > THRESHOLDS.maxRepeatedRatio && words.length > 50) {
        issues.push({
            type: 'repeated_content',
            severity: 'warning',
            message: `Alto nivel de contenido repetido (${(repetitionRatio * 100).toFixed(1)}%)`,
            fix: 'Podría haber un error en la extracción o el documento tiene contenido repetitivo'
        });
        score -= 10;
    }

    // 8. Check page count consistency
    if (pageCount && metadata?.expectedPages && pageCount !== metadata.expectedPages) {
        issues.push({
            type: 'missing_pages',
            severity: 'warning',
            message: `Se extrajeron ${pageCount} páginas pero se esperaban ${metadata.expectedPages}`,
            fix: 'Algunas páginas podrían no haberse procesado correctamente'
        });
        score -= 10;
    }

    // 9. Check for truncation
    if (text.length > 100 && !text.endsWith('.') && !text.endsWith('?') && !text.endsWith('!')) {
        const lastWords = text.slice(-50);
        if (/[a-zA-Z]$/.test(lastWords) && !/\.\.\.$/.test(lastWords)) {
            issues.push({
                type: 'truncated',
                severity: 'info',
                message: 'El documento podría estar truncado',
                fix: 'Verifica que el archivo esté completo'
            });
            score -= 5;
        }
    }

    // Calculate final score and quality
    score = Math.max(0, Math.min(100, score));

    let quality: ValidationResult['quality'];
    if (score >= 80) quality = 'excellent';
    else if (score >= 60) quality = 'good';
    else if (score >= 40) quality = 'fair';
    else quality = 'poor';

    // Determine if we can proceed
    const criticalIssues = issues.filter(i => i.severity === 'critical');
    const canProceed = criticalIssues.length === 0 && score >= 30;

    // Generate suggestions
    const suggestions = generateSuggestions(issues, source);

    return {
        isValid: criticalIssues.length === 0,
        quality,
        score,
        issues,
        suggestions,
        canProceed
    };
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateSuggestions(issues: ValidationIssue[], source: ExtractionData['source']): string[] {
    const suggestions: string[] = [];

    const issueTypes = new Set(issues.map(i => i.type));

    if (issueTypes.has('empty_content') || issueTypes.has('no_text_found')) {
        if (source === 'pdf' || source === 'image') {
            suggestions.push('Usar OCR para extraer texto de imágenes escaneadas');
        }
        suggestions.push('Verificar que el archivo no esté corrupto');
    }

    if (issueTypes.has('low_ocr_confidence')) {
        suggestions.push('Usar una imagen de mayor resolución');
        suggestions.push('Asegurar que el documento esté bien iluminado y sin sombras');
        suggestions.push('Verificar que el texto no esté borroso');
    }

    if (issueTypes.has('garbled_text')) {
        suggestions.push('Verificar la codificación del archivo (UTF-8 recomendado)');
        suggestions.push('Intentar re-convertir el documento a un formato diferente');
    }

    if (issueTypes.has('truncated')) {
        suggestions.push('Verificar que el archivo no esté incompleto');
        suggestions.push('Intentar abrir el documento en el software original');
    }

    return suggestions;
}

// =============================================================================
// Quick Validation
// =============================================================================

export function quickValidate(text: string): { valid: boolean; reason?: string } {
    if (!text || text.trim().length === 0) {
        return { valid: false, reason: 'Contenido vacío' };
    }

    if (text.length < 20) {
        return { valid: false, reason: 'Contenido demasiado corto' };
    }

    const alphanumeric = (text.match(/[a-zA-Z0-9]/g) || []).length;
    if (alphanumeric / text.length < 0.3) {
        return { valid: false, reason: 'Texto no legible' };
    }

    return { valid: true };
}

// =============================================================================
// Export
// =============================================================================

export const extractionValidator = {
    validateExtraction,
    quickValidate
};

export default extractionValidator;
