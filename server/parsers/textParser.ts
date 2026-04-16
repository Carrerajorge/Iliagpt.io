import type { FileParser, ParsedResult, DetectedFileType } from "./base";
import { sanitizePlainText } from "../lib/textSanitizers";

export class TextParser implements FileParser {
  name = "text";
  supportedMimeTypes = [
    "text/plain",
    "text/markdown",
    "text/md",
    "text/html",
    "application/json",
  ];

  async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
    const text = content.toString("utf-8");

    if (type.mimeType === "application/json") {
      try {
        const json = JSON.parse(text);
        return { text: JSON.stringify(json, null, 2) };
      } catch {
        return { text };
      }
    }

    if (type.mimeType === "text/html") {
      return { text: sanitizePlainText(text, { maxLen: 2_000_000, collapseWs: true }) };
    }

    return { text };
  }
}
