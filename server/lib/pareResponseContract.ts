/**
 * PARE Response Contract Validator
 * 
 * Validates that responses in DATA_MODE conform to the expected contract:
 * - No binary content (Buffer, ArrayBuffer, Blob)
 * - No base64 encoded data > 1KB
 * - No data:image URLs
 * - All documents have at least one citation
 */

export interface ResponseContractValidation {
  hasValidContentType: boolean;
  hasNoBlobs: boolean;
  hasNoBase64Data: boolean;
  hasNoImageUrls: boolean;
  hasNoBinaryFields: boolean;
  
  documentsWithCitations: string[];
  documentsWithoutCitations: string[];
  coverageRatio: number;
  meetsCoverageRequirement: boolean;
  
  valid: boolean;
  violations: ResponseContractViolation[];
}

export interface ResponseContractViolation {
  code: ResponseContractViolationCode;
  message: string;
  path?: string;
  details?: Record<string, any>;
}

export type ResponseContractViolationCode =
  | 'MISSING_CONTENT_TYPE'
  | 'INVALID_CONTENT_TYPE'
  | 'BINARY_CONTENT_DETECTED'
  | 'BASE64_DATA_DETECTED'
  | 'IMAGE_URL_DETECTED'
  | 'COVERAGE_INCOMPLETE'
  | 'BLOB_DETECTED';

const CITATION_REGEX = /\[doc:([^\]\s]+)(?:[^\]]*)\]/g;

const BASE64_DATA_URL_REGEX = /^data:[^;]+;base64,/;
const DATA_IMAGE_URL_REGEX = /^data:image\//i;

const BASE64_THRESHOLD_BYTES = 1024;

function extractDocNameFromCitation(citation: string): string {
  const match = citation.match(/\[doc:([^\]\s]+)/);
  return match ? match[1] : citation;
}

export function extractCitationsFromText(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  
  const citations: string[] = [];
  let match;
  
  const regex = new RegExp(CITATION_REGEX.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    const docName = match[1];
    if (docName && !citations.includes(docName)) {
      citations.push(docName);
    }
  }
  
  return citations;
}

export function normalizeDocName(name: string): string {
  return name.toLowerCase().trim();
}

function isBase64DataUrl(value: string): boolean {
  return BASE64_DATA_URL_REGEX.test(value);
}

function isDataImageUrl(value: string): boolean {
  return DATA_IMAGE_URL_REGEX.test(value);
}

function getBase64Size(base64String: string): number {
  const base64Part = base64String.replace(/^data:[^;]+;base64,/, '');
  return Math.ceil((base64Part.length * 3) / 4);
}

function isBinaryContent(value: any): boolean {
  if (value === null || value === undefined) return false;
  
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return true;
  }
  
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    return true;
  }
  
  if (typeof Uint8Array !== 'undefined' && value instanceof Uint8Array) {
    return true;
  }
  
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return true;
  }
  
  return false;
}

interface ScanResult {
  hasBlobs: boolean;
  hasBase64Data: boolean;
  hasImageUrls: boolean;
  hasBinaryFields: boolean;
  violations: ResponseContractViolation[];
}

function scanObjectForBinaryContent(obj: any, path: string = ''): ScanResult {
  const result: ScanResult = {
    hasBlobs: false,
    hasBase64Data: false,
    hasImageUrls: false,
    hasBinaryFields: false,
    violations: []
  };
  
  if (obj === null || obj === undefined) {
    return result;
  }
  
  if (isBinaryContent(obj)) {
    result.hasBinaryFields = true;
    result.hasBlobs = true;
    result.violations.push({
      code: 'BINARY_CONTENT_DETECTED',
      message: `Binary content detected at path "${path}"`,
      path
    });
    return result;
  }
  
  if (typeof obj === 'string') {
    if (isDataImageUrl(obj)) {
      result.hasImageUrls = true;
      result.violations.push({
        code: 'IMAGE_URL_DETECTED',
        message: `Data image URL detected at path "${path}"`,
        path
      });
    }
    
    if (isBase64DataUrl(obj)) {
      const size = getBase64Size(obj);
      if (size > BASE64_THRESHOLD_BYTES) {
        result.hasBase64Data = true;
        result.violations.push({
          code: 'BASE64_DATA_DETECTED',
          message: `Base64 data (${size} bytes) exceeds 1KB threshold at path "${path}"`,
          path,
          details: { sizeBytes: size, threshold: BASE64_THRESHOLD_BYTES }
        });
      }
    }
    
    return result;
  }
  
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const childResult = scanObjectForBinaryContent(obj[i], `${path}[${i}]`);
      mergeResults(result, childResult);
    }
    return result;
  }
  
  if (typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      const currentPath = path ? `${path}.${key}` : key;
      const childResult = scanObjectForBinaryContent(obj[key], currentPath);
      mergeResults(result, childResult);
    }
  }
  
  return result;
}

function mergeResults(target: ScanResult, source: ScanResult): void {
  target.hasBlobs = target.hasBlobs || source.hasBlobs;
  target.hasBase64Data = target.hasBase64Data || source.hasBase64Data;
  target.hasImageUrls = target.hasImageUrls || source.hasImageUrls;
  target.hasBinaryFields = target.hasBinaryFields || source.hasBinaryFields;
  target.violations.push(...source.violations);
}

export interface ValidateResponseContractOptions {
  contentType?: string;
  requireFullCoverage?: boolean;
}

export function validateResponseContract(
  response: any,
  attachmentNames: string[],
  options: ValidateResponseContractOptions = {}
): ResponseContractValidation {
  const violations: ResponseContractViolation[] = [];
  
  const hasValidContentType = !options.contentType || 
    options.contentType.toLowerCase().includes('application/json');
  
  if (options.contentType && !hasValidContentType) {
    violations.push({
      code: 'INVALID_CONTENT_TYPE',
      message: `Content-Type must be application/json, got "${options.contentType}"`,
      details: { received: options.contentType, expected: 'application/json' }
    });
  }
  
  const scanResult = scanObjectForBinaryContent(response);
  violations.push(...scanResult.violations);
  
  const answerText = response?.answer_text || response?.answerText || '';
  const citedDocuments = extractCitationsFromText(answerText);
  
  const normalizedAttachments = attachmentNames.map(normalizeDocName);
  const normalizedCitations = citedDocuments.map(normalizeDocName);
  
  const documentsWithCitations: string[] = [];
  const documentsWithoutCitations: string[] = [];
  
  for (const attachment of attachmentNames) {
    const normalizedAttachment = normalizeDocName(attachment);
    const hasCitation = normalizedCitations.some(cited => 
      cited.includes(normalizedAttachment) || normalizedAttachment.includes(cited)
    );
    
    if (hasCitation) {
      documentsWithCitations.push(attachment);
    } else {
      documentsWithoutCitations.push(attachment);
    }
  }
  
  const totalDocs = attachmentNames.length;
  const coverageRatio = totalDocs > 0 
    ? documentsWithCitations.length / totalDocs 
    : 1;
  
  const meetsCoverageRequirement = documentsWithoutCitations.length === 0 || !options.requireFullCoverage;
  
  if (options.requireFullCoverage && documentsWithoutCitations.length > 0) {
    violations.push({
      code: 'COVERAGE_INCOMPLETE',
      message: `${documentsWithoutCitations.length} document(s) missing citations: ${documentsWithoutCitations.join(', ')}`,
      details: {
        documentsWithoutCitations,
        documentsWithCitations,
        coverageRatio
      }
    });
  }
  
  const valid = violations.length === 0;
  
  return {
    hasValidContentType,
    hasNoBlobs: !scanResult.hasBlobs,
    hasNoBase64Data: !scanResult.hasBase64Data,
    hasNoImageUrls: !scanResult.hasImageUrls,
    hasNoBinaryFields: !scanResult.hasBinaryFields,
    
    documentsWithCitations,
    documentsWithoutCitations,
    coverageRatio,
    meetsCoverageRequirement,
    
    valid,
    violations
  };
}

export class ResponseContractViolationError extends Error {
  public readonly violations: ResponseContractViolation[];
  public readonly requestId: string;
  public readonly validation: ResponseContractValidation;
  
  constructor(requestId: string, validation: ResponseContractValidation) {
    const violationSummary = validation.violations
      .map(v => `${v.code}: ${v.message}`)
      .join('; ');
    super(`RESPONSE_CONTRACT_VIOLATION: ${violationSummary}`);
    this.name = 'ResponseContractViolationError';
    this.violations = validation.violations;
    this.requestId = requestId;
    this.validation = validation;
  }
}

export function assertResponseContract(
  response: any,
  attachmentNames: string[],
  requestId: string,
  options: ValidateResponseContractOptions = {}
): ResponseContractValidation {
  const validation = validateResponseContract(response, attachmentNames, options);
  
  if (!validation.valid) {
    console.error(`[RESPONSE_CONTRACT] ========== VIOLATION DETECTED ==========`);
    console.error(`[RESPONSE_CONTRACT] requestId: ${requestId}`);
    console.error(`[RESPONSE_CONTRACT] violations: ${validation.violations.length}`);
    validation.violations.forEach((v, i) => {
      console.error(`[RESPONSE_CONTRACT] [${i + 1}] ${v.code}: ${v.message}`);
      if (v.path) console.error(`[RESPONSE_CONTRACT]     path: ${v.path}`);
    });
    
    throw new ResponseContractViolationError(requestId, validation);
  }
  
  return validation;
}
