import type { DetectedFileType } from "../parsers/base";

const OPENXML_EXTENSIONS = ["docx", "xlsx", "pptx"];

const FILE_SIGNATURES: { signature: number[]; offset: number; mimeType: string; extension: string }[] = [
  { signature: [0x25, 0x50, 0x44, 0x46], offset: 0, mimeType: "application/pdf", extension: "pdf" },
  { signature: [0xd0, 0xcf, 0x11, 0xe0], offset: 0, mimeType: "application/msword", extension: "doc" },
];

const EXTENSION_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  html: "text/html",
  htm: "text/html",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  tiff: "image/tiff",
  tif: "image/tiff",
};

function isZipSignature(content: Buffer): boolean {
  return content.length >= 4 &&
    content[0] === 0x50 &&
    content[1] === 0x4b &&
    content[2] === 0x03 &&
    content[3] === 0x04;
}

function detectBySignature(content: Buffer): DetectedFileType | null {
  for (const sig of FILE_SIGNATURES) {
    if (content.length >= sig.offset + sig.signature.length) {
      const matches = sig.signature.every(
        (byte, i) => content[sig.offset + i] === byte
      );
      if (matches) {
        return { mimeType: sig.mimeType, extension: sig.extension, confidence: 0.9 };
      }
    }
  }
  return null;
}

function detectByExtension(filename: string): DetectedFileType | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext && EXTENSION_TO_MIME[ext]) {
    return { mimeType: EXTENSION_TO_MIME[ext], extension: ext, confidence: 0.7 };
  }
  return null;
}

export function detectFileType(
  content: Buffer,
  providedMimeType?: string,
  filename?: string
): DetectedFileType {
  if (providedMimeType && providedMimeType !== "application/octet-stream") {
    const ext = filename?.split(".").pop()?.toLowerCase() || "";
    return { mimeType: providedMimeType, extension: ext, confidence: 1.0 };
  }

  const ext = filename?.split(".").pop()?.toLowerCase();
  
  if (ext && OPENXML_EXTENSIONS.includes(ext) && isZipSignature(content)) {
    return { mimeType: EXTENSION_TO_MIME[ext], extension: ext, confidence: 0.95 };
  }

  if (filename) {
    const byExt = detectByExtension(filename);
    if (byExt) return byExt;
  }

  const bySignature = detectBySignature(content);
  if (bySignature) return bySignature;

  return { mimeType: "application/octet-stream", extension: "", confidence: 0.1 };
}
