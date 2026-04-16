import type { FileParser, DetectedFileType, ParsedResult } from "../parsers/base";
import { PdfParser } from "../parsers/pdfParser";
import { DocxParser } from "../parsers/docxParser";
import { XlsxParser } from "../parsers/xlsxParser";
import { PptxParser } from "../parsers/pptxParser";
import { CsvParser } from "../parsers/csvParser";
import { TextParser } from "../parsers/textParser";
import { FallbackParser } from "../parsers/fallbackParser";
import { ImageParser } from "../parsers/imageParser";

class ParserRegistry {
  private parsers: FileParser[] = [];
  private fallback: FileParser;

  constructor() {
    this.fallback = new FallbackParser();
    this.registerParser(new PdfParser());
    this.registerParser(new DocxParser());
    this.registerParser(new XlsxParser());
    this.registerParser(new PptxParser());
    this.registerParser(new CsvParser());
    this.registerParser(new TextParser());
    this.registerParser(new ImageParser());
  }

  registerParser(parser: FileParser): void {
    this.parsers.push(parser);
  }

  getParser(type: DetectedFileType): FileParser {
    for (const parser of this.parsers) {
      if (parser.supportedMimeTypes.includes(type.mimeType)) {
        return parser;
      }
    }
    return this.fallback;
  }

  async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
    const parser = this.getParser(type);
    return parser.parse(content, type);
  }
}

export const parserRegistry = new ParserRegistry();
