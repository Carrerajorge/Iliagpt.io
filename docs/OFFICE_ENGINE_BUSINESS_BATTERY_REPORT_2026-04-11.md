# Office Engine Business Battery Report

Date: 2026-04-11
Branch: `main`
Base URL: `http://localhost:5050`
Suite: [`e2e/chat-document-business-battery.spec.ts`](../e2e/chat-document-business-battery.spec.ts)
Policy: `implement -> test -> root-cause -> auto-fix -> re-test`

## Execution evidence

Primary test command:

```bash
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:5050 \
  npx playwright test e2e/chat-document-business-battery.spec.ts \
  --project=chromium --reporter=list --workers=1
```

Final result:

- `25/25` scenarios passed
- Final runtime: `1.3m`
- Verification mode: real browser, real chat prompts, real binary downloads

Validated end-to-end per scenario:

- Natural-language intent routing from chat
- Office/Artifact Engine run creation
- SSE lifecycle: `production_start`, `production_event`, `artifact`, `production_complete`, `done`
- Split-view and preview rendering
- `Ver`, `Preview`, `Descargar`
- Real binary download with `Content-Disposition`
- No `EventSource error`
- No `failed + listo` contradiction
- No infinite spinner
- No zombie state after completion

Binary validation performed by the suite:

- `DOCX`: `JSZip` + `mammoth`
- `XLSX`: `ExcelJS`
- `PPTX`: `JSZip`
- `PDF`: `%PDF-` header + `%%EOF`

## Formal test matrix

| # | Scenario | Format | Result |
|---|----------|--------|--------|
| 1 | DOCX estudio de mercado | DOCX | PASS |
| 2 | DOCX análisis de competencia | DOCX | PASS |
| 3 | DOCX benchmark de precios | DOCX | PASS |
| 4 | DOCX segmentación de clientes | DOCX | PASS |
| 5 | DOCX encuesta de satisfacción | DOCX | PASS |
| 6 | DOCX perfil de consumidor | DOCX | PASS |
| 7 | DOCX FODA | DOCX | PASS |
| 8 | DOCX PESTEL | DOCX | PASS |
| 9 | DOCX TAM/SAM/SOM | DOCX | PASS |
| 10 | DOCX plan comercial | DOCX | PASS |
| 11 | DOCX resumen ejecutivo | DOCX | PASS |
| 12 | DOCX matriz de riesgos | DOCX | PASS |
| 13 | XLSX proyección financiera | XLSX | PASS |
| 14 | XLSX dashboard de ventas | XLSX | PASS |
| 15 | XLSX cohortes | XLSX | PASS |
| 16 | XLSX funnel comercial | XLSX | PASS |
| 17 | XLSX costos y márgenes | XLSX | PASS |
| 18 | XLSX inventario y demanda | XLSX | PASS |
| 19 | XLSX cronograma operativo | XLSX | PASS |
| 20 | PPTX directorio | PPTX | PASS |
| 21 | PPTX resultados de investigación | PPTX | PASS |
| 22 | PPTX propuesta comercial | PPTX | PASS |
| 23 | PDF reporte ejecutivo | PDF | PASS |
| 24 | Híbrido Word + Excel | DOCX + XLSX | PASS |
| 25 | Híbrido Word + Excel + PPT | DOCX + XLSX + PPTX | PASS |

## Failures encountered during implementation

### 1. Chat production artifacts were not consolidated reliably

- Initial symptom: hybrid scenarios could lose artifacts or render an inconsistent final assistant message
- Root cause: the active chat branch did not aggregate production SSE artifacts deterministically across the stream lifecycle
- Fix applied: added explicit SSE artifact capture and final message reconstruction in [`client/src/components/chat-interface.tsx`](../client/src/components/chat-interface.tsx)
- Outcome: multi-artifact scenarios now finish with stable cards, preview URLs, download URLs and final state

### 2. Cross-format idempotency collisions reused the wrong artifact

- Initial symptom: cached or resumed runs could resolve to the wrong artifact flavor when different document kinds shared objective text
- Root cause: idempotency lookup and objective hashing were not partitioned strongly enough by `docKind`, and selection between `repacked` and `exported` was fragile
- Fix applied:
  - partitioned idempotency by `docKind` in [`server/lib/office/persistence.ts`](../server/lib/office/persistence.ts)
  - hardened per-engine objective hashing in:
    - [`server/lib/office/engine/OfficeEngine.ts`](../server/lib/office/engine/OfficeEngine.ts)
    - [`server/lib/office/engine/XlsxEngine.ts`](../server/lib/office/engine/XlsxEngine.ts)
    - [`server/lib/office/engine/PptxEngine.ts`](../server/lib/office/engine/PptxEngine.ts)
    - [`server/lib/office/engine/PdfEngine.ts`](../server/lib/office/engine/PdfEngine.ts)
  - forced delivery preference for `exported` artifacts in [`server/services/productionHandler.ts`](../server/services/productionHandler.ts)
- Outcome: export and download consistently use the final delivered artifact, not an intermediate repack

### 3. PDF artifacts were mislabeled as Word in the UI

- Initial symptom: the `PDF reporte ejecutivo` scenario reached `succeeded`, but the chat card rendered as `Documento Word`
- Root cause: chat artifact normalization incorrectly mapped `pdf -> document`
- Fix applied: corrected PDF normalization in [`client/src/components/chat-interface.tsx`](../client/src/components/chat-interface.tsx)
- Outcome: PDF cards now render as `Documento PDF`, preserve PDF preview behavior and satisfy the E2E selector contract

## Regression coverage added

- [`server/__tests__/productionHandler.officeEngine.test.ts`](../server/__tests__/productionHandler.officeEngine.test.ts)
  - verifies `exported` artifacts are preferred over `repacked`
- [`client/src/components/chat/__tests__/AssistantMessage.test.tsx`](../client/src/components/chat/__tests__/AssistantMessage.test.tsx)
  - verifies PDF artifact labeling and preview routing

## Residual risk

- The final business battery is green for `DOCX`, `XLSX`, `PPTX`, `PDF` and hybrid combinations.
- The suite directly checks persisted Office Engine run state on the `DOCX` path; for the other formats, persistence is evidenced indirectly through successful SSE completion, artifact URLs, preview rendering and binary download.
- Isolated Playwright reruns on this macOS host showed intermittent Chromium launch instability at the OS/runtime layer. The final full battery run was not affected.
- Repo-wide client `vitest` discovery remains inconsistent for direct file-path invocation. The critical product behavior in this report was verified through real-browser E2E.

## Files materially involved in the fixes

- [`client/src/components/chat-interface.tsx`](../client/src/components/chat-interface.tsx)
- [`server/lib/office/persistence.ts`](../server/lib/office/persistence.ts)
- [`server/lib/office/engine/OfficeEngine.ts`](../server/lib/office/engine/OfficeEngine.ts)
- [`server/lib/office/engine/XlsxEngine.ts`](../server/lib/office/engine/XlsxEngine.ts)
- [`server/lib/office/engine/PptxEngine.ts`](../server/lib/office/engine/PptxEngine.ts)
- [`server/lib/office/engine/PdfEngine.ts`](../server/lib/office/engine/PdfEngine.ts)
- [`server/services/productionHandler.ts`](../server/services/productionHandler.ts)
- [`server/__tests__/productionHandler.officeEngine.test.ts`](../server/__tests__/productionHandler.officeEngine.test.ts)
- [`client/src/components/chat/__tests__/AssistantMessage.test.tsx`](../client/src/components/chat/__tests__/AssistantMessage.test.tsx)
- [`e2e/chat-document-business-battery.spec.ts`](../e2e/chat-document-business-battery.spec.ts)

## Commits in main

- `c38c2a5a` — `Fix office artifact routing and PDF labeling`
- `736d59fc` — `origin/main` head observed during final verification
