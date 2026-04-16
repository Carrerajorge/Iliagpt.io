import type { FileParser, ParsedResult, DetectedFileType } from "./base";

export class FallbackParser implements FileParser {
  name = "fallback";
  supportedMimeTypes = ["*/*"];

  async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
    return {
      text: content.toString("utf-8"),
      warnings: [`Unknown MIME type ${type.mimeType}, attempting text extraction`],
    };
  }
}
