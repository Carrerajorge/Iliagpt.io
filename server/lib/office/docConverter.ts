/**
 * Async Document Converter
 * Handles background conversion of documents (e.g., DOCX -> PDF, Excel -> JSON)
 */

import { Logger } from '../../logger';
import { fileProcessingQueue } from '../fileProcessingQueue';
import { officeWorkerPool } from './workerPool';

export type ConversionFormat = 'pdf' | 'json' | 'html' | 'text';

export class DocumentConverter {

    /**
     * Schedule a document conversion job
     */
    async convertDocument(fileId: string, sourcePath: string, targetFormat: ConversionFormat): Promise<string> {
        Logger.info(`[DocConverter] Scheduling conversion for ${fileId} -> ${targetFormat}`);

        // Add to the standard file processing queue with a special job type
        // Note: We are leveraging the existing fileProcessingQueue but adding specific logic phase

        // 1. Enqueue Job
        fileProcessingQueue.enqueue({
            fileId: `convert-${fileId}-${Date.now()}`,
            fileName: sourcePath,
            storagePath: sourcePath,
            mimeType: 'application/octet-stream' // generic
        });

        // 2. Offload real work to Worker Pool (simulated trigger)
        try {
            const result = await officeWorkerPool.executeTask('word_parse', { path: sourcePath, format: targetFormat });
            Logger.info(`[DocConverter] Conversion successful`);
            return (result as any).result;
        } catch (e: any) {
            Logger.error(`[DocConverter] Conversion failed: ${e.message}`);
            throw e;
        }
    }

    /**
     * Parse Excel specifically (Heavy operation)
     */
    async parseSpreadsheet(fileId: string): Promise<any> {
        Logger.info(`[DocConverter] Parsing spreadsheet ${fileId}`);
        return officeWorkerPool.executeTask('excel_parse', { fileId });
    }
}

export const docConverter = new DocumentConverter();
