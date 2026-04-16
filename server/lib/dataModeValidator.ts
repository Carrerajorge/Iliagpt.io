/**
 * DATA_MODE Output Kill-Switch
 * 
 * Validates that responses in DATA_MODE contain no image/artifact fields.
 * If violation detected → logs error with stack trace and throws DATA_MODE_OUTPUT_VIOLATION.
 * 
 * PARE Phase 2 Integration:
 * - Integrates with pareResponseContract for structural validation
 * - Adds specific violation codes for categorized errors
 */

import { 
  validateResponseContract, 
  extractCitationsFromText,
  type ResponseContractValidation,
  type ResponseContractViolation,
  type ResponseContractViolationCode 
} from './pareResponseContract';

export type DataModeViolationCode =
  | 'FORBIDDEN_KEY'
  | 'FORBIDDEN_CONTENT_TYPE'
  | 'FORBIDDEN_TEXT_PATTERN'
  | 'MISSING_CONTENT_TYPE'
  | 'INVALID_CONTENT_TYPE'
  | 'BINARY_CONTENT_DETECTED'
  | 'BASE64_DATA_DETECTED'
  | 'IMAGE_URL_DETECTED'
  | 'COVERAGE_INCOMPLETE'
  | 'BLOB_DETECTED';

export interface DataModeViolation {
  code: DataModeViolationCode;
  message: string;
  path?: string;
  details?: Record<string, any>;
}

export interface DataModeValidationResult {
  valid: boolean;
  violations: string[];
  violationDetails?: DataModeViolation[];
  responseContractValidation?: ResponseContractValidation;
  stack?: string;
}

const FORBIDDEN_KEYS = [
  'image',
  'images',
  'artifact',
  'artifacts',
  'image_url',
  'imageUrl',
  'image_data',
  'imageData',
  'generated_image',
  'generatedImage',
  'download_url',
  'downloadUrl',
  'file_download',
  'fileDownload',
  'media_url',
  'mediaUrl',
  'binary_data',
  'binaryData',
];

const FORBIDDEN_CONTENT_TYPES = [
  'image/',
  'application/octet-stream',
];

const FORBIDDEN_TEXT_PATTERNS = [
  /he generado una imagen/i,
  /i have generated an image/i,
  /aquí está la imagen/i,
  /here is the image/i,
  /imagen generada/i,
  /generated image/i,
  /creé una imagen/i,
  /i created an image/i,
  /![.*]\(.*\)/,  // Markdown image syntax
  /data:image\//i,  // Base64 image
];

/**
 * Recursively scan an object for forbidden keys
 */
function scanForForbiddenKeys(obj: any, path: string = ''): string[] {
  const violations: string[] = [];
  
  if (obj === null || obj === undefined) {
    return violations;
  }
  
  if (typeof obj !== 'object') {
    return violations;
  }
  
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      violations.push(...scanForForbiddenKeys(item, `${path}[${index}]`));
    });
    return violations;
  }
  
  for (const key of Object.keys(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    const lowerKey = key.toLowerCase();
    
    // Check for forbidden keys
    for (const forbidden of FORBIDDEN_KEYS) {
      if (lowerKey === forbidden.toLowerCase() || lowerKey.includes(forbidden.toLowerCase())) {
        violations.push(`Forbidden key "${key}" at path "${currentPath}"`);
      }
    }
    
    // Check for forbidden content-type values
    if (lowerKey === 'content-type' || lowerKey === 'contenttype' || lowerKey === 'mimetype') {
      const value = String(obj[key]).toLowerCase();
      for (const forbidden of FORBIDDEN_CONTENT_TYPES) {
        if (value.startsWith(forbidden)) {
          violations.push(`Forbidden content-type "${obj[key]}" at path "${currentPath}"`);
        }
      }
    }
    
    // Recursively scan nested objects
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      violations.push(...scanForForbiddenKeys(obj[key], currentPath));
    }
  }
  
  return violations;
}

/**
 * Scan text content for forbidden patterns indicating image generation
 */
function scanTextForViolations(text: string, fieldName: string): string[] {
  const violations: string[] = [];
  
  if (typeof text !== 'string') {
    return violations;
  }
  
  for (const pattern of FORBIDDEN_TEXT_PATTERNS) {
    if (pattern.test(text)) {
      violations.push(`Forbidden text pattern "${pattern}" found in "${fieldName}"`);
    }
  }
  
  return violations;
}

/**
 * Validate a DATA_MODE response payload
 * Returns validation result with any violations found
 */
export function validateDataModeResponse(payload: any, requestId: string): DataModeValidationResult {
  const violations: string[] = [];
  
  // Scan for forbidden keys in the entire payload
  violations.push(...scanForForbiddenKeys(payload));
  
  // Scan text fields for forbidden patterns
  if (payload.answer_text) {
    violations.push(...scanTextForViolations(payload.answer_text, 'answer_text'));
  }
  if (payload.answerText) {
    violations.push(...scanTextForViolations(payload.answerText, 'answerText'));
  }
  if (payload.message) {
    violations.push(...scanTextForViolations(payload.message, 'message'));
  }
  if (payload.content) {
    violations.push(...scanTextForViolations(payload.content, 'content'));
  }
  
  // Check per_doc_findings for violations
  if (payload.per_doc_findings) {
    for (const [docName, findings] of Object.entries(payload.per_doc_findings)) {
      if (Array.isArray(findings)) {
        for (const finding of findings) {
          if (typeof finding === 'string') {
            violations.push(...scanTextForViolations(finding, `per_doc_findings.${docName}`));
          }
        }
      }
    }
  }
  
  if (violations.length > 0) {
    const stack = new Error().stack;
    console.error(`[DATA_MODE_KILL_SWITCH] ========== VIOLATION DETECTED ==========`);
    console.error(`[DATA_MODE_KILL_SWITCH] requestId: ${requestId}`);
    console.error(`[DATA_MODE_KILL_SWITCH] violations: ${violations.length}`);
    violations.forEach((v, i) => console.error(`[DATA_MODE_KILL_SWITCH] [${i + 1}] ${v}`));
    console.error(`[DATA_MODE_KILL_SWITCH] stack: ${stack}`);
    
    return {
      valid: false,
      violations,
      stack
    };
  }
  
  return { valid: true, violations: [] };
}

/**
 * Error class for DATA_MODE output violations
 */
export class DataModeOutputViolationError extends Error {
  public readonly violations: string[];
  public readonly requestId: string;
  
  constructor(requestId: string, violations: string[]) {
    super(`DATA_MODE_OUTPUT_VIOLATION: ${violations.length} violation(s) detected`);
    this.name = 'DataModeOutputViolationError';
    this.violations = violations;
    this.requestId = requestId;
  }
}

/**
 * Validate and throw if violations found
 * Use this before sending any DATA_MODE response
 */
export function assertDataModeCompliance(payload: any, requestId: string): void {
  const result = validateDataModeResponse(payload, requestId);
  
  if (!result.valid) {
    throw new DataModeOutputViolationError(requestId, result.violations);
  }
}

/**
 * Enhanced validation options for PARE Phase 2
 */
export interface EnhancedValidationOptions {
  contentType?: string;
  attachmentNames?: string[];
  requireFullCoverage?: boolean;
  userQuery?: string;
}

/**
 * Detect if user query requires full document coverage
 */
export function detectFullCoverageRequirement(userQuery: string): boolean {
  if (!userQuery) return false;
  return /\b(todos|all|completo|complete|cada|every|analiza\s+todos)\b/i.test(userQuery);
}

/**
 * Enhanced DATA_MODE validation with PARE Response Contract integration
 * Combines traditional DATA_MODE checks with structural response contract validation
 */
export function validateDataModeResponseEnhanced(
  payload: any, 
  requestId: string,
  options: EnhancedValidationOptions = {}
): DataModeValidationResult {
  const violations: string[] = [];
  const violationDetails: DataModeViolation[] = [];
  
  const requireFullCoverage = options.requireFullCoverage ?? 
    (options.userQuery ? detectFullCoverageRequirement(options.userQuery) : false);
  
  const responseContractResult = validateResponseContract(
    payload,
    options.attachmentNames || [],
    {
      contentType: options.contentType,
      requireFullCoverage
    }
  );
  
  for (const contractViolation of responseContractResult.violations) {
    violations.push(`${contractViolation.code}: ${contractViolation.message}`);
    violationDetails.push({
      code: contractViolation.code as DataModeViolationCode,
      message: contractViolation.message,
      path: contractViolation.path,
      details: contractViolation.details
    });
  }
  
  const traditionalResult = scanForForbiddenKeys(payload);
  for (const violation of traditionalResult) {
    violations.push(violation);
    violationDetails.push({
      code: 'FORBIDDEN_KEY',
      message: violation
    });
  }
  
  if (payload.answer_text) {
    const textViolations = scanTextForViolations(payload.answer_text, 'answer_text');
    for (const violation of textViolations) {
      violations.push(violation);
      violationDetails.push({
        code: 'FORBIDDEN_TEXT_PATTERN',
        message: violation
      });
    }
  }
  if (payload.answerText) {
    const textViolations = scanTextForViolations(payload.answerText, 'answerText');
    for (const violation of textViolations) {
      violations.push(violation);
      violationDetails.push({
        code: 'FORBIDDEN_TEXT_PATTERN',
        message: violation
      });
    }
  }
  
  if (violations.length > 0) {
    const stack = new Error().stack;
    console.error(`[DATA_MODE_KILL_SWITCH_ENHANCED] ========== VIOLATION DETECTED ==========`);
    console.error(`[DATA_MODE_KILL_SWITCH_ENHANCED] requestId: ${requestId}`);
    console.error(`[DATA_MODE_KILL_SWITCH_ENHANCED] violations: ${violations.length}`);
    violationDetails.forEach((v, i) => console.error(`[DATA_MODE_KILL_SWITCH_ENHANCED] [${i + 1}] ${v.code}: ${v.message}`));
    console.error(`[DATA_MODE_KILL_SWITCH_ENHANCED] stack: ${stack}`);
    
    return {
      valid: false,
      violations,
      violationDetails,
      responseContractValidation: responseContractResult,
      stack
    };
  }
  
  return { 
    valid: true, 
    violations: [],
    violationDetails: [],
    responseContractValidation: responseContractResult
  };
}

/**
 * Enhanced assertion that includes response contract validation
 */
export function assertDataModeComplianceEnhanced(
  payload: any, 
  requestId: string,
  options: EnhancedValidationOptions = {}
): DataModeValidationResult {
  const result = validateDataModeResponseEnhanced(payload, requestId, options);
  
  if (!result.valid) {
    throw new DataModeOutputViolationError(requestId, result.violations);
  }
  
  return result;
}
