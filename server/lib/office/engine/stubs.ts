/**
 * Stubs for the PPTX / PDF engines.
 *
 * DOCX ships in `OfficeEngine.ts`. XLSX ships in `XlsxEngine.ts` (wired
 * via dynamic import from `OfficeEngine.run()`). PPTX and PDF remain
 * stubs with the same `run()` signature so the route layer can detect
 * them cleanly and return a 501.
 */

import type { OfficeRunRequest, OfficeRunResult } from "../types";
import { OfficeEngineError } from "../types";

async function notImplemented(req: OfficeRunRequest, kind: string): Promise<OfficeRunResult> {
  throw new OfficeEngineError("NOT_IMPLEMENTED", `${kind} engine is not implemented in this slice`, {
    details: { docKind: req.docKind },
  });
}

export const pptxEngine = {
  run: (req: OfficeRunRequest) => notImplemented(req, "pptx"),
};

export const pdfEngine = {
  run: (req: OfficeRunRequest) => notImplemented(req, "pdf"),
};
