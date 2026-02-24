/**
 * MIME Detector - Magic bytes detection for document types
 * PARE Phase 2 Security Hardening
 * 
 * Detects file types using magic bytes, with extension-based fallback
 * and content heuristics for text vs binary detection.
 * Includes allowlist/denylist validation for security.
 */

export interface MimeDetectionResult {
  detectedMime: string;
  confidence: number;
  method: 'magic_bytes' | 'extension' | 'heuristic' | 'unknown';
  mismatch: boolean;
  mismatchDetails?: string;
  isBinary: boolean;
}

export interface MimeValidationResult {
  allowed: boolean;
  reason?: string;
  matchedRule?: 'allowlist' | 'denylist' | 'dangerous_magic';
}

export interface MagicSignature {
  bytes: number[];
  offset?: number;
  mask?: number[];
  mime: string;
  extension: string;
}

export interface DangerousMagicSignature {
  bytes: number[];
  offset?: number;
  description: string;
  threat: string;
}

const MIME_ALLOWLIST: string[] = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/msword',
  'text/plain',
  'text/csv',
  'application/json',
  'text/html',
  'application/xml',
  'text/xml',
  'application/rtf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/svg+xml',
  'text/markdown',
  'application/zip',
];

const MIME_ALLOWLIST_PATTERNS: RegExp[] = [
  /^application\/vnd\.openxmlformats-officedocument\..*/,
  /^application\/vnd\.oasis\.opendocument\..*/,
  /^text\/.*/,
  /^image\/(png|jpeg|jpg|gif|webp|bmp|tiff|svg\+xml)$/,
];

const MIME_DENYLIST: string[] = [
  'application/x-executable',
  'application/x-msdos-program',
  'application/x-msdownload',
  'application/x-sh',
  'application/x-shellscript',
  'application/javascript',
  'text/javascript',
  'application/x-python-code',
  'application/x-perl',
  'application/x-ruby',
  'application/x-php',
  'application/x-httpd-php',
  'application/x-dosexec',
  'application/x-elf',
  'application/x-mach-binary',
  'application/vnd.microsoft.portable-executable',
  'application/x-bat',
  'application/x-msi',
  'application/x-dll',
  'application/java-archive',
  'application/x-java-class',
];

const DANGEROUS_MAGIC_SIGNATURES: DangerousMagicSignature[] = [
  { bytes: [0x4D, 0x5A], description: 'DOS/Windows executable (MZ header)', threat: 'executable' },
  { bytes: [0x7F, 0x45, 0x4C, 0x46], description: 'ELF executable', threat: 'executable' },
  { bytes: [0xFE, 0xED, 0xFA, 0xCE], description: 'Mach-O executable (32-bit)', threat: 'executable' },
  { bytes: [0xFE, 0xED, 0xFA, 0xCF], description: 'Mach-O executable (64-bit)', threat: 'executable' },
  { bytes: [0xCF, 0xFA, 0xED, 0xFE], description: 'Mach-O executable (reverse)', threat: 'executable' },
  { bytes: [0xCA, 0xFE, 0xBA, 0xBE], description: 'Java class file / Mach-O fat binary', threat: 'executable' },
  { bytes: [0x23, 0x21], description: 'Shell script (shebang)', threat: 'script' },
];

const MAGIC_SIGNATURES: MagicSignature[] = [
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf', extension: 'pdf' },
  { bytes: [0x50, 0x4B, 0x03, 0x04], mime: 'application/zip', extension: 'zip' },
  { bytes: [0x50, 0x4B, 0x05, 0x06], mime: 'application/zip', extension: 'zip' },
  { bytes: [0x50, 0x4B, 0x07, 0x08], mime: 'application/zip', extension: 'zip' },
  { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], mime: 'image/png', extension: 'png' },
  { bytes: [0xFF, 0xD8, 0xFF], mime: 'image/jpeg', extension: 'jpg' },
  { bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], mime: 'image/gif', extension: 'gif' },
  { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], mime: 'image/gif', extension: 'gif' },
  {
    bytes: [
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // size (ignored)
      0x57, 0x45, 0x42, 0x50, // WEBP
    ],
    mask: [
      0xFF, 0xFF, 0xFF, 0xFF,
      0x00, 0x00, 0x00, 0x00,
      0xFF, 0xFF, 0xFF, 0xFF,
    ],
    mime: 'image/webp',
    extension: 'webp',
  },
  { bytes: [0x42, 0x4D], mime: 'image/bmp', extension: 'bmp' }, // BMP
  { bytes: [0x49, 0x49, 0x2A, 0x00], mime: 'image/tiff', extension: 'tiff' }, // TIFF (LE)
  { bytes: [0x4D, 0x4D, 0x00, 0x2A], mime: 'image/tiff', extension: 'tiff' }, // TIFF (BE)
  { bytes: [0x00, 0x00, 0x00], mime: 'video/mp4', extension: 'mp4', offset: 4 },
  { bytes: [0x1A, 0x45, 0xDF, 0xA3], mime: 'video/webm', extension: 'webm' },
  { bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], mime: 'application/x-cfb', extension: 'doc' },
  { bytes: [0x7B, 0x5C, 0x72, 0x74, 0x66], mime: 'application/rtf', extension: 'rtf' },
  { bytes: [0x4D, 0x5A], mime: 'application/x-msdownload', extension: 'exe' },
  { bytes: [0x7F, 0x45, 0x4C, 0x46], mime: 'application/x-elf', extension: 'elf' },
];

const EXTENSION_TO_MIME: Record<string, string> = {
  'pdf': 'application/pdf',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'doc': 'application/msword',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'xls': 'application/vnd.ms-excel',
  'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'ppt': 'application/vnd.ms-powerpoint',
  'txt': 'text/plain',
  'md': 'text/markdown',
  'csv': 'text/csv',
  'html': 'text/html',
  'htm': 'text/html',
  'json': 'application/json',
  'xml': 'application/xml',
  'zip': 'application/zip',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'bmp': 'image/bmp',
  'tif': 'image/tiff',
  'tiff': 'image/tiff',
  'svg': 'image/svg+xml',
  'exe': 'application/x-msdownload',
  'sh': 'application/x-sh',
  'bat': 'application/x-bat',
  'cmd': 'application/x-bat',
  'ps1': 'application/x-powershell',
  'js': 'application/javascript',
  'py': 'text/x-python',
  'rb': 'application/x-ruby',
  'php': 'application/x-php',
};

const OOXML_CONTENT_TYPES: Record<string, string> = {
  'word/document.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xl/workbook.xml': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'ppt/presentation.xml': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function matchMagicBytes(buffer: Buffer): MagicSignature | null {
  for (const sig of MAGIC_SIGNATURES) {
    const offset = sig.offset || 0;
    if (buffer.length < offset + sig.bytes.length) continue;
    
    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      const bufByte = buffer[offset + i];
      const sigByte = sig.bytes[i];
      const mask = sig.mask?.[i] ?? 0xFF;
      
      if ((bufByte & mask) !== (sigByte & mask)) {
        match = false;
        break;
      }
    }
    
    if (match) return sig;
  }
  return null;
}

function matchDangerousMagicBytes(buffer: Buffer): DangerousMagicSignature | null {
  for (const sig of DANGEROUS_MAGIC_SIGNATURES) {
    const offset = sig.offset || 0;
    if (buffer.length < offset + sig.bytes.length) continue;
    
    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buffer[offset + i] !== sig.bytes[i]) {
        match = false;
        break;
      }
    }
    
    if (match) return sig;
  }
  return null;
}

function isShellScript(buffer: Buffer): boolean {
  if (buffer.length < 2) return false;
  
  if (buffer[0] === 0x23 && buffer[1] === 0x21) {
    const header = buffer.toString('utf8', 0, Math.min(buffer.length, 256));
    const shebangLine = header.split('\n')[0];
    
    const shellPatterns = [
      /^#!\s*\/bin\/(bash|sh|zsh|ksh|csh|tcsh|fish)/,
      /^#!\s*\/usr\/bin\/(bash|sh|env)/,
      /^#!\s*\/usr\/bin\/env\s+(bash|sh|python|perl|ruby|node)/,
    ];
    
    return shellPatterns.some(pattern => pattern.test(shebangLine));
  }
  
  return false;
}

function detectOOXMLType(buffer: Buffer): string | null {
  try {
    const content = buffer.toString('utf8', 0, Math.min(buffer.length, 2000));
    
    for (const [pattern, mime] of Object.entries(OOXML_CONTENT_TYPES)) {
      if (content.includes(pattern)) {
        return mime;
      }
    }
    
    if (content.includes('[Content_Types].xml')) {
      if (content.includes('word') || content.includes('document')) {
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      }
      if (content.includes('xl') || content.includes('worksheet')) {
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      }
      if (content.includes('ppt') || content.includes('slide')) {
        return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      }
    }
  } catch {
  }
  return null;
}

function isBinaryContent(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 8192);
  let nullBytes = 0;
  let controlChars = 0;
  
  for (let i = 0; i < checkLength; i++) {
    const byte = buffer[i];
    
    if (byte === 0x00) {
      nullBytes++;
    } else if (byte < 0x09 || (byte > 0x0D && byte < 0x20 && byte !== 0x1B)) {
      controlChars++;
    }
  }
  
  const nullRatio = nullBytes / checkLength;
  const controlRatio = controlChars / checkLength;
  
  return nullRatio > 0.01 || controlRatio > 0.1;
}

function detectTextMimeType(buffer: Buffer): string {
  const content = buffer.toString('utf8', 0, Math.min(buffer.length, 500)).trim();
  
  if (content.startsWith('{') || content.startsWith('[')) {
    try {
      JSON.parse(buffer.toString('utf8'));
      return 'application/json';
    } catch {
    }
  }
  
  if (content.startsWith('<?xml') || content.startsWith('<')) {
    if (content.includes('<!DOCTYPE html') || content.includes('<html')) {
      return 'text/html';
    }
    return 'application/xml';
  }
  
  if (content.includes(',') && content.includes('\n')) {
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length > 1) {
      const commaCount = lines.map(l => (l.match(/,/g) || []).length);
      const consistent = commaCount.every(c => Math.abs(c - commaCount[0]) <= 1);
      if (consistent && commaCount[0] > 0) {
        return 'text/csv';
      }
    }
  }
  
  if (content.match(/^#\s|^\*\*|^-\s|^\d+\.\s|^>\s/m)) {
    return 'text/markdown';
  }
  
  return 'text/plain';
}

/** Dangerous double extensions that may indicate disguised executables */
const DANGEROUS_DOUBLE_EXTENSIONS = [
  /\.(pdf|docx?|xlsx?|pptx?|txt|csv|jpg|jpeg|png|gif)\.exe$/i,
  /\.(pdf|docx?|xlsx?|pptx?|txt|csv|jpg|jpeg|png|gif)\.scr$/i,
  /\.(pdf|docx?|xlsx?|pptx?|txt|csv|jpg|jpeg|png|gif)\.bat$/i,
  /\.(pdf|docx?|xlsx?|pptx?|txt|csv|jpg|jpeg|png|gif)\.cmd$/i,
  /\.(pdf|docx?|xlsx?|pptx?|txt|csv|jpg|jpeg|png|gif)\.com$/i,
  /\.(pdf|docx?|xlsx?|pptx?|txt|csv|jpg|jpeg|png|gif)\.msi$/i,
  /\.(pdf|docx?|xlsx?|pptx?|txt|csv|jpg|jpeg|png|gif)\.vbs$/i,
  /\.(pdf|docx?|xlsx?|pptx?|txt|csv|jpg|jpeg|png|gif)\.js$/i,
  /\.(pdf|docx?|xlsx?|pptx?|txt|csv|jpg|jpeg|png|gif)\.ps1$/i,
  /\.(pdf|docx?|xlsx?|pptx?|txt|csv|jpg|jpeg|png|gif)\.dll$/i,
];

function getExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * Check for dangerous double extensions (e.g., report.pdf.exe)
 */
function hasDoubleExtension(filename: string): { dangerous: boolean; pattern?: string } {
  if (!filename || typeof filename !== 'string') return { dangerous: false };
  const normalized = filename.toLowerCase().trim();
  for (const pattern of DANGEROUS_DOUBLE_EXTENSIONS) {
    if (pattern.test(normalized)) {
      return { dangerous: true, pattern: normalized };
    }
  }
  return { dangerous: false };
}

/**
 * Detect SVG files with embedded scripts or event handlers
 */
function hasSvgScriptContent(buffer: Buffer): boolean {
  // Only check text/XML content that looks like SVG
  const content = buffer.toString('utf8', 0, Math.min(buffer.length, 50000)).toLowerCase();
  if (!content.includes('<svg') && !content.includes('xmlns="http://www.w3.org/2000/svg"')) {
    return false;
  }
  // Check for dangerous SVG elements/attributes
  const svgDangerPatterns = [
    /<script[\s>]/i,
    /on\w+\s*=/i,  // event handlers like onclick, onload
    /javascript:/i,
    /<foreignobject[\s>]/i,
    /<iframe[\s>]/i,
    /<embed[\s>]/i,
    /xlink:href\s*=\s*["']javascript:/i,
    /href\s*=\s*["']data:text\/html/i,
  ];
  return svgDangerPatterns.some(p => p.test(content));
}

/**
 * Validate a detected MIME type against allowlist/denylist
 */
export function validateMimeType(detectedMime: string, buffer?: Buffer, filename?: string): MimeValidationResult {
  if (MIME_DENYLIST.includes(detectedMime)) {
    console.warn(`[MimeDetector] SECURITY: Denylisted MIME type detected: ${detectedMime}`);
    return {
      allowed: false,
      reason: `MIME type '${detectedMime}' is blocked for security reasons`,
      matchedRule: 'denylist',
    };
  }

  // Security: check for dangerous double extensions
  if (filename) {
    const doubleExt = hasDoubleExtension(filename);
    if (doubleExt.dangerous) {
      console.warn(`[MimeDetector] SECURITY: Dangerous double extension detected: ${doubleExt.pattern}`);
      return {
        allowed: false,
        reason: 'Suspicious double file extension detected',
        matchedRule: 'denylist',
      };
    }
  }

  if (buffer) {
    const dangerousMagic = matchDangerousMagicBytes(buffer);
    if (dangerousMagic) {
      console.warn(`[MimeDetector] SECURITY: Dangerous file format detected: ${dangerousMagic.description}`);
      return {
        allowed: false,
        reason: `Dangerous file format detected: ${dangerousMagic.description}`,
        matchedRule: 'dangerous_magic',
      };
    }

    if (isShellScript(buffer)) {
      console.warn(`[MimeDetector] SECURITY: Shell script detected`);
      return {
        allowed: false,
        reason: 'Shell scripts are not allowed',
        matchedRule: 'dangerous_magic',
      };
    }

    // Security: check SVG files for embedded scripts
    if (detectedMime === 'image/svg+xml' && hasSvgScriptContent(buffer)) {
      console.warn(`[MimeDetector] SECURITY: SVG with embedded script content detected`);
      return {
        allowed: false,
        reason: 'SVG files with embedded scripts are not allowed',
        matchedRule: 'dangerous_magic',
      };
    }
  }
  
  if (MIME_ALLOWLIST.includes(detectedMime)) {
    return { allowed: true, matchedRule: 'allowlist' };
  }
  
  for (const pattern of MIME_ALLOWLIST_PATTERNS) {
    if (pattern.test(detectedMime)) {
      return { allowed: true, matchedRule: 'allowlist' };
    }
  }
  
  console.warn(`[MimeDetector] MIME type not in allowlist: ${detectedMime}`);
  return {
    allowed: false,
    reason: `MIME type '${detectedMime}' is not in the allowed list`,
    matchedRule: 'allowlist',
  };
}

/**
 * Detect MIME type from buffer content and filename
 */
export function detectMime(
  buffer: Buffer,
  filename: string,
  providedMime?: string
): MimeDetectionResult {
  const extension = getExtension(filename);
  const extensionMime = EXTENSION_TO_MIME[extension];
  
  const magicMatch = matchMagicBytes(buffer);
  
  if (magicMatch) {
    let detectedMime = magicMatch.mime;
    
    if (detectedMime === 'application/zip') {
      const ooxmlType = detectOOXMLType(buffer);
      if (ooxmlType) {
        detectedMime = ooxmlType;
      } else if (extensionMime) {
        detectedMime = extensionMime;
      }
    }
    
    if (detectedMime === 'application/x-cfb') {
      detectedMime = extensionMime || 'application/msword';
    }
    
    const mismatch = !!(providedMime && providedMime !== detectedMime && 
                       !providedMime.includes('octet-stream'));
    
    return {
      detectedMime,
      confidence: 0.95,
      method: 'magic_bytes',
      mismatch,
      mismatchDetails: mismatch 
        ? `Provided: ${providedMime}, Detected: ${detectedMime}` 
        : undefined,
      isBinary: true,
    };
  }
  
  const binary = isBinaryContent(buffer);
  
  if (!binary) {
    const textMime = detectTextMimeType(buffer);
    const mismatch = !!(extensionMime && textMime !== extensionMime && 
                       !extensionMime.startsWith('text/'));
    
    return {
      detectedMime: textMime,
      confidence: 0.8,
      method: 'heuristic',
      mismatch,
      mismatchDetails: mismatch
        ? `Extension suggests: ${extensionMime}, Content suggests: ${textMime}`
        : undefined,
      isBinary: false,
    };
  }
  
  if (extensionMime) {
    const mismatch = !!(providedMime && providedMime !== extensionMime);
    
    return {
      detectedMime: extensionMime,
      confidence: 0.6,
      method: 'extension',
      mismatch,
      mismatchDetails: mismatch
        ? `Provided: ${providedMime}, Extension: ${extensionMime}`
        : undefined,
      isBinary: binary,
    };
  }
  
  return {
    detectedMime: providedMime || 'application/octet-stream',
    confidence: 0.3,
    method: 'unknown',
    mismatch: false,
    isBinary: binary,
  };
}

/**
 * Detect dangerous file formats using magic bytes
 */
export function detectDangerousFormat(buffer: Buffer): {
  isDangerous: boolean;
  signature?: DangerousMagicSignature;
  isShellScript: boolean;
} {
  const dangerousMagic = matchDangerousMagicBytes(buffer);
  const shellScript = isShellScript(buffer);
  
  return {
    isDangerous: dangerousMagic !== null || shellScript,
    signature: dangerousMagic || undefined,
    isShellScript: shellScript,
  };
}

/**
 * Quick check if buffer looks like a specific MIME type
 */
export function quickCheckMime(buffer: Buffer, expectedMime: string): boolean {
  const result = detectMime(buffer, '', expectedMime);
  return result.detectedMime === expectedMime || 
         (result.method === 'magic_bytes' && result.confidence >= 0.9);
}

/**
 * Validate that file content matches its claimed type
 */
export function validateMimeMatch(
  buffer: Buffer,
  filename: string,
  claimedMime: string
): { valid: boolean; message?: string } {
  const detected = detectMime(buffer, filename, claimedMime);
  
  if (detected.mismatch) {
    console.warn(`[MimeDetector] MIME mismatch: ${detected.mismatchDetails}`);
    return {
      valid: false,
      message: detected.mismatchDetails,
    };
  }
  
  return { valid: true };
}

export const mimeDetector = {
  detectMime,
  quickCheckMime,
  validateMimeMatch,
  validateMimeType,
  detectDangerousFormat,
  hasDoubleExtension,
  hasSvgScriptContent,
  EXTENSION_TO_MIME,
  MIME_ALLOWLIST,
  MIME_DENYLIST,
};
