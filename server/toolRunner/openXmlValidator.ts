import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import {
  ToolRunnerDocumentType,
  ToolRunnerIssue,
  ToolRunnerValidationResult,
} from "./types";

const REQUIRED_FILES: Record<ToolRunnerDocumentType, string[]> = {
  docx: ["[Content_Types].xml", "_rels/.rels", "word/document.xml"],
  xlsx: ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"],
  pptx: ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml"],
};

const ROOT_XML_FILE: Record<ToolRunnerDocumentType, string> = {
  docx: "word/document.xml",
  xlsx: "xl/workbook.xml",
  pptx: "ppt/presentation.xml",
};

const ROOT_TAG_MARKER: Record<ToolRunnerDocumentType, string> = {
  docx: "<w:document",
  xlsx: "<workbook",
  pptx: "<p:presentation",
};

const STYLE_FILE: Record<ToolRunnerDocumentType, string> = {
  docx: "word/styles.xml",
  xlsx: "xl/styles.xml",
  pptx: "ppt/theme/theme1.xml",
};

const FONT_FILE: Record<ToolRunnerDocumentType, string> = {
  docx: "word/fontTable.xml",
  xlsx: "xl/styles.xml",
  pptx: "ppt/theme/theme1.xml",
};

const MAIN_RELS_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const IMAGE_RELS_TYPE_SUFFIX = "/image";

function normalizeZipPath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\/+/, "");
}

function makeIssue(
  code: string,
  message: string,
  severity: "error" | "warning",
  details?: Record<string, unknown>
): ToolRunnerIssue {
  return { code, message, severity, details };
}

function parseRelationshipAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attributeRegex = /(\w+)="([^"]*)"/g;
  let match = attributeRegex.exec(tag);
  while (match) {
    attrs[match[1]] = match[2];
    match = attributeRegex.exec(tag);
  }
  return attrs;
}

function parseRelationships(xmlText: string): Array<{ type?: string; target?: string; id?: string }> {
  const result: Array<{ type?: string; target?: string; id?: string }> = [];
  const relRegex = /<Relationship\b[^>]*\/?>(?:<\/Relationship>)?/g;
  let match = relRegex.exec(xmlText);
  while (match) {
    const attrs = parseRelationshipAttributes(match[0]);
    result.push({
      type: attrs.Type,
      target: attrs.Target,
      id: attrs.Id,
    });
    match = relRegex.exec(xmlText);
  }
  return result;
}

function resolveRelsTarget(relsPath: string, target: string): string {
  const normalizedRelsPath = normalizeZipPath(relsPath);

  // _rels/.rels targets are package-root relative.
  if (normalizedRelsPath === "_rels/.rels") {
    return normalizeZipPath(target);
  }

  const relsDir = path.posix.dirname(normalizedRelsPath);
  // e.g. word/_rels/document.xml.rels => word/document.xml
  const partName = path.posix.basename(normalizedRelsPath).replace(/\.rels$/, "");
  const partPath = path.posix.join(path.posix.dirname(relsDir), partName);
  const baseDir = path.posix.dirname(partPath);

  return normalizeZipPath(path.posix.resolve("/", baseDir, target));
}

async function validateSchema(
  zip: JSZip,
  docType: ToolRunnerDocumentType,
  issues: ToolRunnerIssue[]
): Promise<boolean> {
  const rootFile = ROOT_XML_FILE[docType];
  const marker = ROOT_TAG_MARKER[docType];
  const xml = zip.file(rootFile);
  if (!xml) {
    issues.push(makeIssue("MSO_SCHEMA_MISSING_ROOT", `Missing ${rootFile}.`, "error", { file: rootFile }));
    return false;
  }

  const xmlText = await xml.async("text");
  if (!xmlText.includes(marker)) {
    issues.push(
      makeIssue(
        "MSO_SCHEMA_INVALID_ROOT",
        `Root XML ${rootFile} does not contain expected marker ${marker}.`,
        "error",
        { marker, file: rootFile }
      )
    );
    return false;
  }

  return true;
}

async function validateRelationships(zip: JSZip, issues: ToolRunnerIssue[]): Promise<boolean> {
  const rootRels = zip.file("_rels/.rels");
  if (!rootRels) {
    issues.push(makeIssue("MSO_RELS_MISSING", "Missing _rels/.rels relationship file.", "error"));
    return false;
  }

  const relText = await rootRels.async("text");
  const rels = parseRelationships(relText);
  const mainRel = rels.find((rel) => rel.type === MAIN_RELS_TYPE);

  if (!mainRel?.target) {
    issues.push(
      makeIssue(
        "MSO_RELS_MAIN_MISSING",
        "Main officeDocument relationship not found in _rels/.rels.",
        "error"
      )
    );
    return false;
  }

  const resolvedMainTarget = resolveRelsTarget("_rels/.rels", mainRel.target);
  if (!zip.file(resolvedMainTarget)) {
    issues.push(
      makeIssue(
        "MSO_RELS_MAIN_TARGET_MISSING",
        `Main relationship target ${resolvedMainTarget} not found in package.`,
        "error",
        { target: resolvedMainTarget }
      )
    );
    return false;
  }

  return true;
}

async function validateImages(zip: JSZip, issues: ToolRunnerIssue[]): Promise<boolean> {
  const relFiles = Object.keys(zip.files).filter((name) => name.endsWith(".rels"));
  const mediaFiles = new Set(
    Object.keys(zip.files)
      .filter((name) => /\/(media|embeddings)\//.test(name))
      .map(normalizeZipPath)
  );

  let ok = true;

  for (const relFile of relFiles) {
    const relContent = await zip.file(relFile)?.async("text");
    if (!relContent) continue;

    for (const rel of parseRelationships(relContent)) {
      if (!rel.type?.endsWith(IMAGE_RELS_TYPE_SUFFIX) || !rel.target) {
        continue;
      }

      const resolved = resolveRelsTarget(relFile, rel.target);
      if (!zip.file(resolved) && !mediaFiles.has(resolved)) {
        ok = false;
        issues.push(
          makeIssue(
            "MSO_IMAGE_TARGET_MISSING",
            `Image relationship target ${resolved} was not found.`,
            "error",
            { relFile, target: rel.target, resolved }
          )
        );
      }
    }
  }

  return ok;
}

function validateStyles(zip: JSZip, docType: ToolRunnerDocumentType, issues: ToolRunnerIssue[]): boolean {
  const styleFile = STYLE_FILE[docType];
  if (zip.file(styleFile)) {
    return true;
  }
  issues.push(
    makeIssue(
      "MSO_STYLES_MISSING",
      `Style definition file ${styleFile} is missing.`,
      "warning",
      { file: styleFile }
    )
  );
  return false;
}

function validateFonts(zip: JSZip, docType: ToolRunnerDocumentType, issues: ToolRunnerIssue[]): boolean {
  const fontFile = FONT_FILE[docType];
  if (zip.file(fontFile)) {
    return true;
  }
  issues.push(
    makeIssue(
      "MSO_FONTS_UNDECLARED",
      `Font metadata file ${fontFile} is missing.`,
      "warning",
      { file: fontFile }
    )
  );
  return false;
}

function validateRequiredFiles(zip: JSZip, docType: ToolRunnerDocumentType, issues: ToolRunnerIssue[]): boolean {
  let ok = true;
  for (const requiredFile of REQUIRED_FILES[docType]) {
    if (!zip.file(requiredFile)) {
      ok = false;
      issues.push(
        makeIssue(
          "MSO_REQUIRED_PART_MISSING",
          `Required OpenXML part ${requiredFile} is missing.`,
          "error",
          { file: requiredFile }
        )
      );
    }
  }
  return ok;
}

export async function validateOpenXmlArtifact(
  artifactPath: string,
  docType: ToolRunnerDocumentType
): Promise<ToolRunnerValidationResult> {
  const issues: ToolRunnerIssue[] = [];

  const buffer = await fs.readFile(artifactPath);
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    issues.push(
      makeIssue(
        "MSO_INVALID_ZIP_SIGNATURE",
        "Artifact is not a valid ZIP/OpenXML package (PK signature missing).",
        "error"
      )
    );

    return {
      valid: false,
      checks: {
        relationships: false,
        styles: false,
        fonts: false,
        images: false,
        schema: false,
      },
      metadata: {
        artifactPath,
        bytes: buffer.length,
      },
      issues,
    };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    issues.push(
      makeIssue(
        "MSO_ZIP_PARSE_FAILED",
        `Failed to parse OpenXML ZIP package: ${(error as Error).message}`,
        "error"
      )
    );
    return {
      valid: false,
      checks: {
        relationships: false,
        styles: false,
        fonts: false,
        images: false,
        schema: false,
      },
      metadata: {
        artifactPath,
        bytes: buffer.length,
      },
      issues,
    };
  }

  const hasRequiredParts = validateRequiredFiles(zip, docType, issues);
  const relationships = await validateRelationships(zip, issues);
  const schema = await validateSchema(zip, docType, issues);
  const styles = validateStyles(zip, docType, issues);
  const fonts = validateFonts(zip, docType, issues);
  const images = await validateImages(zip, issues);

  const valid = hasRequiredParts && relationships && schema && images && !issues.some((issue) => issue.severity === "error");

  return {
    valid,
    checks: {
      relationships,
      styles,
      fonts,
      images,
      schema,
    },
    metadata: {
      artifactPath,
      bytes: buffer.length,
      entries: Object.keys(zip.files).length,
      mediaEntries: Object.keys(zip.files).filter((name) => /\/(media|embeddings)\//.test(name)).length,
    },
    issues,
  };
}
