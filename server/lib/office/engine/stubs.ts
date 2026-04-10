/**
 * Stubs for the XLSX / PPTX / PDF engines.
 *
 * The vertical slice ships only DOCX. The other formats are wired into the
 * dispatcher with the same `run()` signature so the route layer can detect
 * them and return a clean 501. They throw `NOT_IMPLEMENTED`.
 */

import type { OfficeRunRequest, OfficeRunResult } from "../types";
import { OfficeEngineError } from "../types";

async function notImplemented(req: OfficeRunRequest, kind: string): Promise<OfficeRunResult> {
  throw new OfficeEngineError("NOT_IMPLEMENTED", `${kind} engine is not implemented in this slice`, {
    details: { docKind: req.docKind },
  });
}

export const xlsxEngine = {
  run: (req: OfficeRunRequest) => notImplemented(req, "xlsx"),
};

export const pptxEngine = {
  run: (req: OfficeRunRequest) => notImplemented(req, "pptx"),
};

export const pdfEngine = {
  run: (req: OfficeRunRequest) => notImplemented(req, "pdf"),
};
