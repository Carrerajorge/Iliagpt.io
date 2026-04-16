import { createQueue, QUEUE_NAMES } from "../lib/queueFactory";
import { Logger } from "../lib/logger";

// Define Job Data Interfaces
export interface PdfGenerateJobData {
    html: string;
    options?: any; // strict typing can be added later matching pdfGeneration options
    outputFilename: string;
}

export interface ExcelParseJobData {
    filePath: string;
    mimeType: string;
    uploadId: string;
}

export const JOB_NAMES = {
    PDF_GENERATE: "pdf-generate",
    EXCEL_PARSE: "excel-parse",
};

// Queue instances
const processingQueue = createQueue(QUEUE_NAMES.PROCESSING);

/**
 * Dispatch a PDF generation job
 */
export async function dispatchPdfGeneration(data: PdfGenerateJobData): Promise<string | null> {
    if (!processingQueue) {
        Logger.warn("[JobService] Processing queue not available, skipping PDF job");
        return null;
    }

    try {
        const job = await processingQueue.add(JOB_NAMES.PDF_GENERATE, data, {
            priority: 5, // Medium priority
            removeOnComplete: true,
            attempts: 3
        });
        Logger.info(`[JobService] Dispatched PDF job ${job.id}`);
        return job.id || null;
    } catch (error) {
        Logger.error("[JobService] Failed to dispatch PDF job", error);
        return null;
    }
}

/**
 * Dispatch an Excel parsing job
 */
export async function dispatchExcelParse(data: ExcelParseJobData): Promise<string | null> {
    if (!processingQueue) {
        Logger.warn("[JobService] Processing queue not available, skipping Excel job");
        return null;
    }

    try {
        const job = await processingQueue.add(JOB_NAMES.EXCEL_PARSE, data, {
            priority: 10, // High priority (users waiting for analysis)
            attempts: 3
        });
        Logger.info(`[JobService] Dispatched Excel job ${job.id}`);
        return job.id || null;
    } catch (error) {
        Logger.error("[JobService] Failed to dispatch Excel job", error);
        return null;
    }
}
