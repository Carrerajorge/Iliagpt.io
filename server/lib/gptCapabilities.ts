export interface GptCapabilityFlags {
  webBrowsing: boolean;
  codeInterpreter: boolean;
  imageGeneration: boolean;
  fileUpload: boolean;
  dataAnalysis: boolean;
  canvas: boolean;
  wordCreation: boolean;
  excelCreation: boolean;
  pptCreation: boolean;
}

export const DEFAULT_GPT_CAPABILITIES: GptCapabilityFlags = {
  webBrowsing: false,
  codeInterpreter: false,
  imageGeneration: false,
  fileUpload: false,
  dataAnalysis: false,
  canvas: false,
  wordCreation: false,
  excelCreation: false,
  pptCreation: false,
};

type CapabilityKey = keyof GptCapabilityFlags;

const DOC_CAPABILITY_ALIASES: Record<"wordCreation" | "excelCreation" | "pptCreation", string[]> = {
  wordCreation: ["wordCreation", "word", "docx", "docxCreation"],
  excelCreation: ["excelCreation", "excel", "xlsx", "spreadsheet", "spreadsheetCreation"],
  pptCreation: ["pptCreation", "ppt", "powerpoint", "presentation", "presentationCreation"],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function readCandidate(
  source: Record<string, unknown>,
  key: CapabilityKey | string | string[],
): { found: boolean; value: unknown } {
  const keys = Array.isArray(key) ? key : [key];
  for (const candidate of keys) {
    if (hasOwn(source, candidate)) {
      return { found: true, value: source[candidate] };
    }
  }
  return { found: false, value: undefined };
}

function readCapabilityFlag(
  source: Record<string, unknown>,
  key: CapabilityKey | string | string[],
  fallback: boolean,
): { value: boolean; explicit: boolean } {
  const candidate = readCandidate(source, key);
  if (!candidate.found) {
    return { value: fallback, explicit: false };
  }
  return { value: parseBoolean(candidate.value, fallback), explicit: true };
}

export function normalizeGptCapabilities(
  value: unknown,
  fallback: Partial<GptCapabilityFlags> = DEFAULT_GPT_CAPABILITIES,
): GptCapabilityFlags {
  const source = asRecord(value) ?? {};
  const fallbackSafe: GptCapabilityFlags = {
    ...DEFAULT_GPT_CAPABILITIES,
    ...fallback,
  };

  const webBrowsing = readCapabilityFlag(source, "webBrowsing", fallbackSafe.webBrowsing);
  const codeInterpreter = readCapabilityFlag(source, "codeInterpreter", fallbackSafe.codeInterpreter);
  const imageGeneration = readCapabilityFlag(source, "imageGeneration", fallbackSafe.imageGeneration);
  const fileUpload = readCapabilityFlag(source, "fileUpload", fallbackSafe.fileUpload);
  const dataAnalysis = readCapabilityFlag(source, "dataAnalysis", fallbackSafe.dataAnalysis);
  const canvas = readCapabilityFlag(source, "canvas", fallbackSafe.canvas);

  const wordCreation = readCapabilityFlag(
    source,
    DOC_CAPABILITY_ALIASES.wordCreation,
    fallbackSafe.wordCreation,
  );
  const excelCreation = readCapabilityFlag(
    source,
    DOC_CAPABILITY_ALIASES.excelCreation,
    fallbackSafe.excelCreation,
  );
  const pptCreation = readCapabilityFlag(
    source,
    DOC_CAPABILITY_ALIASES.pptCreation,
    fallbackSafe.pptCreation,
  );

  const inferredWord = wordCreation.explicit ? wordCreation.value : (canvas.value ? true : fallbackSafe.wordCreation);
  const inferredExcel = excelCreation.explicit ? excelCreation.value : (canvas.value ? true : fallbackSafe.excelCreation);
  const inferredPpt = pptCreation.explicit ? pptCreation.value : (canvas.value ? true : fallbackSafe.pptCreation);

  return {
    webBrowsing: webBrowsing.value,
    codeInterpreter: codeInterpreter.value,
    imageGeneration: imageGeneration.value,
    fileUpload: fileUpload.value,
    dataAnalysis: dataAnalysis.value,
    canvas: canvas.value,
    wordCreation: inferredWord,
    excelCreation: inferredExcel,
    pptCreation: inferredPpt,
  };
}

export function normalizeGptCapabilitiesPatch(value: unknown): Partial<GptCapabilityFlags> {
  const source = asRecord(value);
  if (!source) return {};

  const patch: Partial<GptCapabilityFlags> = {};

  const assignIfExplicit = (targetKey: CapabilityKey, sourceKey: CapabilityKey | string | string[]) => {
    const resolved = readCapabilityFlag(source, sourceKey, false);
    if (resolved.explicit) {
      patch[targetKey] = resolved.value;
    }
    return resolved;
  };

  assignIfExplicit("webBrowsing", "webBrowsing");
  assignIfExplicit("codeInterpreter", "codeInterpreter");
  assignIfExplicit("imageGeneration", "imageGeneration");
  assignIfExplicit("fileUpload", "fileUpload");
  assignIfExplicit("dataAnalysis", "dataAnalysis");

  const canvas = assignIfExplicit("canvas", "canvas");
  const word = assignIfExplicit("wordCreation", DOC_CAPABILITY_ALIASES.wordCreation);
  const excel = assignIfExplicit("excelCreation", DOC_CAPABILITY_ALIASES.excelCreation);
  const ppt = assignIfExplicit("pptCreation", DOC_CAPABILITY_ALIASES.pptCreation);

  // Legacy compatibility: enabling canvas in a partial patch should keep doc tools enabled
  // unless they were explicitly provided in the payload.
  if (canvas.explicit && canvas.value) {
    if (!word.explicit) patch.wordCreation = true;
    if (!excel.explicit) patch.excelCreation = true;
    if (!ppt.explicit) patch.pptCreation = true;
  }

  return patch;
}
