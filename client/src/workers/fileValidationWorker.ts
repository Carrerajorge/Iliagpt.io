interface ValidationMessage {
  type: 'validate';
  file: {
    name: string;
    size: number;
    type: string;
  };
  config: {
    allowedMimeTypes: string[];
    allowedExtensions: Record<string, string>;
    maxFileSize: number;
  };
  headerBytes?: number[];
}

interface ValidationResult {
  type: 'validation_result';
  valid: boolean;
  errors: string[];
  file: {
    name: string;
    size: number;
    type: string;
    extension: string;
    detectedMimeType?: string;
  };
}

const MAGIC_BYTES: Record<string, { signature: number[]; offset?: number }> = {
  'image/jpeg': { signature: [0xFF, 0xD8, 0xFF] },
  'image/png': { signature: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  'image/gif': { signature: [0x47, 0x49, 0x46, 0x38] },
  'image/webp': { signature: [0x52, 0x49, 0x46, 0x46], offset: 0 },
  'application/pdf': { signature: [0x25, 0x50, 0x44, 0x46] },
  'application/zip': { signature: [0x50, 0x4B, 0x03, 0x04] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { signature: [0x50, 0x4B, 0x03, 0x04] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { signature: [0x50, 0x4B, 0x03, 0x04] },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { signature: [0x50, 0x4B, 0x03, 0x04] },
  'application/msword': { signature: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] },
  'application/vnd.ms-excel': { signature: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] },
  'application/vnd.ms-powerpoint': { signature: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] },
  'text/plain': { signature: [] },
  'text/csv': { signature: [] },
};

const OFFICE_XML_SIGNATURES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

function detectMimeTypeFromBytes(headerBytes: number[], declaredType: string, extension: string): string | null {
  if (!headerBytes || headerBytes.length === 0) return null;
  
  for (const [mimeType, { signature, offset }] of Object.entries(MAGIC_BYTES)) {
    if (signature.length === 0) continue;
    
    const startOffset = offset ?? 0;
    if (headerBytes.length < startOffset + signature.length) continue;
    
    const matches = signature.every((byte, i) => headerBytes[startOffset + i] === byte);
    if (matches) {
      if (OFFICE_XML_SIGNATURES.includes(mimeType) && mimeType !== declaredType) {
        if (extension === '.docx' || declaredType.includes('word')) {
          return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        }
        if (extension === '.xlsx' || declaredType.includes('sheet') || declaredType.includes('excel')) {
          return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        }
        if (extension === '.pptx' || declaredType.includes('presentation') || declaredType.includes('powerpoint')) {
          return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        }
        return mimeType;
      }
      return mimeType;
    }
  }
  
  return null;
}

function isValidMimeType(detectedType: string | null, declaredType: string, allowedTypes: string[]): boolean {
  if (!detectedType) {
    return allowedTypes.includes(declaredType);
  }
  
  if (allowedTypes.includes(detectedType)) return true;
  
  const isOfficeXml = OFFICE_XML_SIGNATURES.includes(detectedType);
  const declaredIsOffice = OFFICE_XML_SIGNATURES.includes(declaredType) || 
    declaredType.includes('word') || 
    declaredType.includes('excel') || 
    declaredType.includes('presentation');
    
  if (isOfficeXml && declaredIsOffice) {
    return allowedTypes.some(t => OFFICE_XML_SIGNATURES.includes(t) || t.includes('word') || t.includes('excel') || t.includes('presentation'));
  }
  
  return false;
}

function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return '';
  return fileName.slice(lastDot).toLowerCase();
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

self.onmessage = (e: MessageEvent<ValidationMessage>) => {
  const { file, config, headerBytes } = e.data;
  const errors: string[] = [];
  const extension = getExtension(file.name);
  
  let detectedMimeType: string | undefined;
  
  if (headerBytes && headerBytes.length > 0) {
    const detected = detectMimeTypeFromBytes(headerBytes, file.type, extension);
    if (detected) {
      detectedMimeType = detected;
    }
    
    if (!isValidMimeType(detected, file.type, config.allowedMimeTypes)) {
      const allowedTypes = config.allowedMimeTypes
        .map((t: string) => t.split('/')[1])
        .filter((t: string, i: number, arr: string[]) => arr.indexOf(t) === i)
        .slice(0, 5)
        .join(', ');
      errors.push(`Tipo de archivo no permitido. Tipos aceptados: ${allowedTypes}...`);
    }
  } else {
    if (!config.allowedMimeTypes.includes(file.type)) {
      const allowedTypes = config.allowedMimeTypes
        .map((t: string) => t.split('/')[1])
        .filter((t: string, i: number, arr: string[]) => arr.indexOf(t) === i)
        .slice(0, 5)
        .join(', ');
      errors.push(`Tipo de archivo no permitido. Tipos aceptados: ${allowedTypes}...`);
    }
  }
  
  const allowedExtensions = Object.values(config.allowedExtensions);
  if (extension && !allowedExtensions.includes(extension)) {
    errors.push(`Extensión de archivo no válida: ${extension}`);
  }
  
  if (file.size > config.maxFileSize) {
    const maxSizeMB = config.maxFileSize / (1024 * 1024);
    errors.push(`El archivo excede el tamaño máximo de ${maxSizeMB}MB. Tamaño actual: ${formatFileSize(file.size)}`);
  }
  
  if (file.size === 0) {
    errors.push('El archivo está vacío');
  }
  
  const result: ValidationResult = {
    type: 'validation_result',
    valid: errors.length === 0,
    errors,
    file: {
      name: file.name,
      size: file.size,
      type: file.type,
      extension,
      detectedMimeType,
    },
  };
  
  self.postMessage(result);
};

export {};
