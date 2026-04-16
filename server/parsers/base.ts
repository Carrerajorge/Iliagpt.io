export interface DetectedFileType {
  mimeType: string;
  extension: string;
  confidence: number;
}

export interface ParsedResult {
  text: string;
  metadata?: Record<string, any>;
  warnings?: string[];
}

export interface FileParser {
  name: string;
  supportedMimeTypes: string[];
  parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult>;
}
