import * as PptxGenJSImport from "pptxgenjs";
import type PptxGenJS from "pptxgenjs";

type PptxGenConstructor = new () => PptxGenJS;

let cachedPptxGenConstructor: PptxGenConstructor | null = null;

function resolvePptxGenConstructor(): PptxGenConstructor {
  if (cachedPptxGenConstructor) {
    return cachedPptxGenConstructor;
  }

  const candidates = [
    (PptxGenJSImport as any)?.default?.default,
    (PptxGenJSImport as any)?.["module.exports"]?.default,
    (PptxGenJSImport as any)?.default,
    (PptxGenJSImport as any)?.["module.exports"],
    PptxGenJSImport,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "function") {
      cachedPptxGenConstructor = candidate as PptxGenConstructor;
      return cachedPptxGenConstructor;
    }
  }

  throw new Error("Unable to resolve PptxGenJS constructor");
}

export function createPptxDocument(): PptxGenJS {
  return new (resolvePptxGenConstructor())();
}
