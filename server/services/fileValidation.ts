/**
 * File Upload Validation Service (#64)
 * Secure file upload handling with MIME verification
 */

import path from 'path';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

// Allowed file types with their MIME types and magic bytes
const ALLOWED_FILE_TYPES: Record<string, {
    mimeTypes: string[];
    extensions: string[];
    magicBytes?: number[][];
    maxSize: number; // in bytes
}> = {
    image: {
        mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
        extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'],
        magicBytes: [
            [0xFF, 0xD8, 0xFF], // JPEG
            [0x89, 0x50, 0x4E, 0x47], // PNG
            [0x47, 0x49, 0x46], // GIF
            [0x52, 0x49, 0x46, 0x46], // WEBP (starts with RIFF)
        ],
        maxSize: 10 * 1024 * 1024, // 10MB
    },
    document: {
        mimeTypes: [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain',
            'text/markdown',
            'text/csv',
        ],
        extensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.csv'],
        magicBytes: [
            [0x25, 0x50, 0x44, 0x46], // PDF
            [0x50, 0x4B, 0x03, 0x04], // ZIP-based (DOCX, XLSX, PPTX)
            [0xD0, 0xCF, 0x11, 0xE0], // Legacy Office (DOC, XLS, PPT)
        ],
        maxSize: 50 * 1024 * 1024, // 50MB
    },
    audio: {
        mimeTypes: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'],
        extensions: ['.mp3', '.wav', '.ogg', '.webm'],
        maxSize: 100 * 1024 * 1024, // 100MB
    },
    video: {
        mimeTypes: ['video/mp4', 'video/webm', 'video/ogg'],
        extensions: ['.mp4', '.webm', '.ogg'],
        maxSize: 500 * 1024 * 1024, // 500MB
    },
    code: {
        mimeTypes: ['text/javascript', 'application/json', 'text/css', 'text/html', 'text/xml'],
        extensions: ['.js', '.ts', '.json', '.css', '.html', '.xml', '.py', '.java', '.cpp', '.c'],
        maxSize: 5 * 1024 * 1024, // 5MB
    },
};

// Dangerous file extensions to always reject
const DANGEROUS_EXTENSIONS = [
    '.exe', '.bat', '.cmd', '.com', '.msi', '.dll', '.scr',
    '.sh', '.bash', '.zsh', '.ps1', '.vbs', '.vbe', '.js', '.jse',
    '.wsf', '.wsh', '.hta', '.cpl', '.msc', '.jar', '.war',
    '.php', '.php3', '.php4', '.php5', '.phtml', '.asp', '.aspx',
    '.cgi', '.pl', '.py', '.rb', '.htaccess', '.htpasswd',
];

interface FileValidationResult {
    valid: boolean;
    errors: string[];
    sanitizedFilename: string;
    fileType: string | null;
    mimeType: string;
    size: number;
}

/**
 * Sanitize filename to prevent path traversal and other attacks
 */
export function sanitizeFilename(filename: string): string {
    // Remove path components
    let sanitized = path.basename(filename);

    // Remove null bytes
    sanitized = sanitized.replace(/\0/g, '');

    // Remove directory traversal attempts
    sanitized = sanitized.replace(/\.\./g, '');

    // Remove special characters
    sanitized = sanitized.replace(/[<>:"|?*\\/]/g, '_');

    // Limit length
    if (sanitized.length > 255) {
        const ext = path.extname(sanitized);
        const name = path.basename(sanitized, ext).substring(0, 255 - ext.length - 1);
        sanitized = name + ext;
    }

    // If empty after sanitization, generate a random name
    if (!sanitized || sanitized === '.' || sanitized === '..') {
        sanitized = `file_${crypto.randomBytes(8).toString('hex')}`;
    }

    return sanitized;
}

/**
 * Check magic bytes of file to verify actual type
 */
function checkMagicBytes(buffer: Buffer, expectedBytes: number[][]): boolean {
    if (!expectedBytes || expectedBytes.length === 0) return true;

    return expectedBytes.some(magic => {
        if (buffer.length < magic.length) return false;
        return magic.every((byte, index) => buffer[index] === byte);
    });
}

/**
 * Validate a file upload
 */
export function validateFile(
    file: {
        originalname: string;
        mimetype: string;
        size: number;
        buffer?: Buffer;
    },
    allowedCategories: string[] = ['image', 'document']
): FileValidationResult {
    const errors: string[] = [];
    const sanitizedFilename = sanitizeFilename(file.originalname);
    const extension = path.extname(sanitizedFilename).toLowerCase();
    let detectedType: string | null = null;

    // Check for dangerous extensions
    if (DANGEROUS_EXTENSIONS.includes(extension)) {
        errors.push(`Tipo de archivo no permitido: ${extension}`);
        return {
            valid: false,
            errors,
            sanitizedFilename,
            fileType: null,
            mimeType: file.mimetype,
            size: file.size,
        };
    }

    // Find matching file type category
    for (const category of allowedCategories) {
        const typeConfig = ALLOWED_FILE_TYPES[category];
        if (!typeConfig) continue;

        const extensionMatch = typeConfig.extensions.includes(extension);
        const mimeMatch = typeConfig.mimeTypes.includes(file.mimetype);

        if (extensionMatch || mimeMatch) {
            // Verify MIME type matches extension
            if (extensionMatch && !mimeMatch) {
                errors.push('El tipo MIME no coincide con la extensión del archivo');
                continue;
            }

            // Check magic bytes if available
            if (typeConfig.magicBytes && file.buffer) {
                if (!checkMagicBytes(file.buffer, typeConfig.magicBytes)) {
                    errors.push('El contenido del archivo no coincide con su tipo declarado');
                    continue;
                }
            }

            // Check file size
            if (file.size > typeConfig.maxSize) {
                const maxMB = Math.round(typeConfig.maxSize / (1024 * 1024));
                errors.push(`El archivo excede el tamaño máximo de ${maxMB}MB`);
                continue;
            }

            detectedType = category;
            break;
        }
    }

    if (!detectedType) {
        errors.push('Tipo de archivo no permitido');
    }

    return {
        valid: errors.length === 0,
        errors,
        sanitizedFilename,
        fileType: detectedType,
        mimeType: file.mimetype,
        size: file.size,
    };
}

/**
 * Scan file content for potential threats
 */
export function scanFileContent(buffer: Buffer, filename: string): {
    safe: boolean;
    threats: string[];
} {
    const threats: string[] = [];
    const content = buffer.toString('utf8', 0, Math.min(buffer.length, 10000));
    const extension = path.extname(filename).toLowerCase();

    // Check for embedded scripts in SVG
    if (extension === '.svg') {
        if (/<script/i.test(content)) {
            threats.push('SVG contains embedded JavaScript');
        }
        if (/on\w+\s*=/i.test(content)) {
            threats.push('SVG contains event handlers');
        }
        if (/xlink:href\s*=\s*["']data:/i.test(content)) {
            threats.push('SVG contains data URIs');
        }
    }

    // Check for PHP in images
    if (['image/jpeg', 'image/png', 'image/gif'].some(m => content.includes(m))) {
        if (/<\?php/i.test(content) || /<%/i.test(content)) {
            threats.push('Image contains embedded server-side code');
        }
    }

    // Check for HTML/JS in text files masquerading as data
    if (['.csv', '.txt', '.json'].includes(extension)) {
        if (/<script/i.test(content) || /javascript:/i.test(content)) {
            threats.push('File contains potential JavaScript injection');
        }
    }

    return {
        safe: threats.length === 0,
        threats,
    };
}

/**
 * Express middleware for file upload validation
 */
export function fileUploadValidator(options: {
    allowedCategories?: string[];
    maxFiles?: number;
    requireScan?: boolean;
} = {}) {
    const {
        allowedCategories = ['image', 'document'],
        maxFiles = 10,
        requireScan = true,
    } = options;

    return (req: Request, res: Response, next: NextFunction) => {
        const files = req.files as Express.Multer.File[] | undefined;

        if (!files || files.length === 0) {
            return next();
        }

        if (files.length > maxFiles) {
            return res.status(400).json({
                error: `Máximo ${maxFiles} archivos permitidos`,
            });
        }

        const validationResults: FileValidationResult[] = [];
        const scanResults: { filename: string; threats: string[] }[] = [];

        for (const file of files) {
            // Validate file
            const validation = validateFile(file, allowedCategories);
            validationResults.push(validation);

            if (!validation.valid) {
                return res.status(400).json({
                    error: 'Archivo no válido',
                    details: validation.errors,
                    filename: file.originalname,
                });
            }

            // Scan for threats if required
            if (requireScan && file.buffer) {
                const scan = scanFileContent(file.buffer, file.originalname);
                if (!scan.safe) {
                    scanResults.push({ filename: file.originalname, threats: scan.threats });
                }
            }
        }

        if (scanResults.length > 0) {
            return res.status(400).json({
                error: 'Archivo rechazado por motivos de seguridad',
                threats: scanResults,
            });
        }

        // Attach validation results to request
        (req as any).fileValidation = validationResults;

        next();
    };
}
