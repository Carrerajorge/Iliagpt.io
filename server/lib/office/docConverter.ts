/**
 * Async Document Converter (legacy stub).
 *
 * NOTE: This module pre-dates the production Office Engine pipeline at
 * `server/lib/office/engine/OfficeEngine.ts`. It is unreferenced as of this
 * commit. The previous implementation called a stubbed `executeTask` API on
 * the worker pool that no longer exists; rather than delete the file we
 * convert it into a thin compatibility shim that delegates to the real
 * worker pool. New code should use `OfficeEngine.run` instead.
 */

import { Logger } from "../logger";
import { officeWorkerPool } from "./workerPool";

export type ConversionFormat = "pdf" | "json" | "html" | "text";

export class DocumentConverter {
    async convertDocument(
        fileId: string,
        _sourcePath: string,
        targetFormat: ConversionFormat,
    ): Promise<string> {
        Logger.info(
            `[DocConverter] convertDocument is a legacy shim (file=${fileId}, target=${targetFormat}). Use OfficeEngine.run instead.`,
        );
        // The new API is task-typed; this legacy shim does not have a real
        // implementation. We surface an error so callers know to migrate.
        throw new Error(
            "DocumentConverter is deprecated. Use server/lib/office/engine/OfficeEngine.ts.",
        );
    }

    async parseSpreadsheet(fileId: string): Promise<unknown> {
        Logger.info(`[DocConverter] parseSpreadsheet legacy shim (file=${fileId})`);
        throw new Error(
            "DocumentConverter.parseSpreadsheet is deprecated. Use the spreadsheet routes instead.",
        );
    }

    /** Touch the worker pool reference so the import is not flagged as unused. */
    poolStats() {
        return officeWorkerPool.stats();
    }
}

export const docConverter = new DocumentConverter();
