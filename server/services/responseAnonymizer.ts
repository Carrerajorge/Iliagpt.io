/**
 * Response Anonymizer - ILIAGPT PRO 3.0
 * 
 * Removes references to document/file names from AI responses.
 * Ensures user privacy and cleaner responses.
 */

// ============== Types ==============

export interface AnonymizerConfig {
    /** Known file names to anonymize */
    knownFileNames?: string[];
    /** Replace with custom phrases */
    replacementPhrases?: Record<string, string>;
    /** Enable aggressive pattern matching */
    aggressiveMode?: boolean;
}

export interface AnonymizationResult {
    text: string;
    replacementsCount: number;
    removedReferences: string[];
}

// ============== Patterns ==============

// Common file extensions
const FILE_EXTENSIONS = [
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'txt', 'rtf', 'csv', 'tsv', 'json', 'xml',
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp', 'svg',
    'mp3', 'mp4', 'wav', 'avi', 'mov',
    'zip', 'rar', '7z', 'tar', 'gz'
];

// Patterns that reference documents
const DOCUMENT_REFERENCE_PATTERNS = [
    // Direct file references: "archivo.pdf", "documento.docx"
    /\b[\w\-_.]+\.(?:pdf|docx?|xlsx?|pptx?|txt|rtf|csv|tsv|png|jpe?g|gif|bmp|tiff|webp)\b/gi,

    // "según el documento X", "en el archivo X"
    /(?:según|en|del?|desde)\s+(?:el\s+)?(?:documento|archivo|fichero|imagen|foto(?:grafía)?|excel|pdf|word)\s+["']?[\w\-_.]+["']?/gi,

    // "the document X", "in file X"
    /(?:in|from|the|according to)\s+(?:the\s+)?(?:document|file|image|photo|spreadsheet|pdf)\s+["']?[\w\-_.]+["']?/gi,

    // "documento llamado X", "archivo denominado X"
    /(?:documento|archivo|fichero|imagen)\s+(?:llamado|denominado|nombrado|titulado)\s+["']?[\w\-_.]+["']?/gi,

    // Quoted file names after colons
    /:\s*["'][\w\-_.]+\.(?:pdf|docx?|xlsx?|pptx?|txt|csv|png|jpe?g)["']/gi,
];

// Replacement phrases for different contexts
const REPLACEMENT_MAP: Record<string, string[]> = {
    document: [
        "la información proporcionada",
        "el contenido analizado",
        "los datos disponibles",
        "el material revisado"
    ],
    file: [
        "el archivo proporcionado",
        "el contenido subido",
        "la fuente"
    ],
    image: [
        "la imagen analizada",
        "el contenido visual",
        "la ilustración"
    ],
    spreadsheet: [
        "la hoja de cálculo",
        "los datos tabulares",
        "la tabla"
    ]
};

// ============== Utility Functions ==============

/**
 * Get random replacement phrase
 */
function getReplacementPhrase(type: keyof typeof REPLACEMENT_MAP): string {
    const phrases = REPLACEMENT_MAP[type] || REPLACEMENT_MAP.document;
    return phrases[Math.floor(Math.random() * phrases.length)];
}

/**
 * Detect file type from extension
 */
function getFileType(filename: string): keyof typeof REPLACEMENT_MAP {
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'svg'].includes(ext)) {
        return 'image';
    }
    if (['xls', 'xlsx', 'csv', 'tsv'].includes(ext)) {
        return 'spreadsheet';
    }
    return 'document';
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============== Main Anonymizer ==============

/**
 * Anonymize response by removing file references
 */
export function anonymizeResponse(
    text: string,
    config: AnonymizerConfig = {}
): AnonymizationResult {
    let result = text;
    const removedReferences: string[] = [];
    let replacementsCount = 0;

    // 1. Remove known file names first
    if (config.knownFileNames && config.knownFileNames.length > 0) {
        for (const fileName of config.knownFileNames) {
            const regex = new RegExp(
                `(?:según|en|del?|from|in|the)\\s+(?:el\\s+)?(?:documento|archivo|file|document)?\\s*["']?${escapeRegex(fileName)}["']?`,
                'gi'
            );

            const matches = result.match(regex);
            if (matches) {
                removedReferences.push(...matches);
                replacementsCount += matches.length;
                const type = getFileType(fileName);
                result = result.replace(regex, getReplacementPhrase(type));
            }

            // Also replace standalone file names
            const fileType = getFileType(fileName);
            const standaloneRegex = new RegExp(`["']?${escapeRegex(fileName)}["']?`, 'gi');
            const standaloneMatches = result.match(standaloneRegex);
            if (standaloneMatches) {
                removedReferences.push(...standaloneMatches);
                replacementsCount += standaloneMatches.length;
                result = result.replace(standaloneRegex, getReplacementPhrase(fileType));
            }
        }
    }

    // 2. Apply general patterns
    for (const pattern of DOCUMENT_REFERENCE_PATTERNS) {
        const matches = result.match(pattern);
        if (matches) {
            for (const match of matches) {
                // Don't replace if it's a URL or code
                if (match.includes('http') || match.includes('://')) continue;

                removedReferences.push(match);
                replacementsCount++;

                // Determine replacement type
                let replacement = getReplacementPhrase('document');
                if (/image|foto|png|jpg|jpeg/i.test(match)) {
                    replacement = getReplacementPhrase('image');
                } else if (/excel|xlsx?|csv/i.test(match)) {
                    replacement = getReplacementPhrase('spreadsheet');
                }

                result = result.replace(match, replacement);
            }
        }
    }

    // 3. Aggressive mode: remove any remaining file-like patterns
    if (config.aggressiveMode) {
        const filePattern = new RegExp(
            `\\b[\\w\\-_.]+\\.(${FILE_EXTENSIONS.join('|')})\\b`,
            'gi'
        );
        const matches = result.match(filePattern);
        if (matches) {
            for (const match of matches) {
                if (!removedReferences.includes(match)) {
                    removedReferences.push(match);
                    replacementsCount++;
                    result = result.replace(match, getReplacementPhrase(getFileType(match)));
                }
            }
        }
    }

    // 4. Clean up multiple spaces and awkward phrasing
    result = result
        .replace(/\s{2,}/g, ' ')
        .replace(/,\s*,/g, ',')
        .replace(/\.\s*\./g, '.')
        .trim();

    return {
        text: result,
        replacementsCount,
        removedReferences: Array.from(new Set(removedReferences)),
    };
}

/**
 * Check if text contains file references
 */
export function containsFileReferences(text: string): boolean {
    for (const pattern of DOCUMENT_REFERENCE_PATTERNS) {
        if (pattern.test(text)) {
            return true;
        }
    }
    return false;
}

/**
 * Extract all file references from text
 */
export function extractFileReferences(text: string): string[] {
    const references: string[] = [];

    for (const pattern of DOCUMENT_REFERENCE_PATTERNS) {
        const matches = text.match(pattern);
        if (matches) {
            references.push(...matches);
        }
    }

    return Array.from(new Set(references));
}

export default {
    anonymizeResponse,
    containsFileReferences,
    extractFileReferences,
};
