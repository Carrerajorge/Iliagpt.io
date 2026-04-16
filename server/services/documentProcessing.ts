import type { ParsedResult } from "../parsers/base";
import { detectFileType } from "./detectorChain";
import { parserRegistry } from "./parserRegistry";

export interface ProcessingResult extends ParsedResult {
  detectedMimeType: string;
  parserUsed: string;
}

export async function processDocument(
  content: Buffer,
  providedMimeType?: string,
  filename?: string
): Promise<ProcessingResult> {
  const detectedType = detectFileType(content, providedMimeType, filename);
  const parser = parserRegistry.getParser(detectedType);
  const result = await parser.parse(content, detectedType);

  return {
    ...result,
    detectedMimeType: detectedType.mimeType,
    parserUsed: parser.name,
  };
}
