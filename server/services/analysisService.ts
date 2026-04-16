import { storage } from "../storage";
import { getUpload, getSheets } from "./spreadsheetAnalyzer";
import {
    startAnalysis,
    getAnalysisProgress,
    getAnalysisResults,
} from "./analysisOrchestrator";
import { analysisLogger } from "../lib/analysisLogger";

export interface AnalysisRequest {
    uploadId: string;
    userId: string;
    messageId?: string;
    scope: "all" | "selected" | "active";
    sheetsToAnalyze?: string[];
    prompt?: string;
}

export interface AnalysisResponse {
    analysisId: string;
    sessionId: string | null;
    status: "pending" | "analyzing" | "completed" | "failed";
    fileContent?: string;
    message?: string;
    progress?: any;
    results?: any;
    error?: string;
    startedAt?: string;
    completedAt?: string;
}

function getFileExtension(filename: string): string {
    return (filename.split('.').pop() || '').toLowerCase();
}

function isSpreadsheetFile(filename: string): boolean {
    const ext = getFileExtension(filename);
    return ['xlsx', 'xls', 'csv', 'tsv'].includes(ext);
}

export class AnalysisService {

    async startUploadAnalysis(params: AnalysisRequest): Promise<AnalysisResponse> {
        const { uploadId, userId, messageId, scope, sheetsToAnalyze, prompt } = params;

        // First try spreadsheet uploads table
        let upload = await getUpload(uploadId);
        let isGenericFile = false;
        let genericFileData: { id: string; name: string; type: string; storagePath: string | null; status: string } | null = null;

        // If not found in spreadsheetUploads, check files table
        if (!upload) {
            const genericFile = await storage.getFile(uploadId);
            if (genericFile) {
                isGenericFile = true;
                genericFileData = {
                    id: genericFile.id,
                    name: genericFile.name,
                    type: genericFile.type,
                    storagePath: genericFile.storagePath,
                    status: genericFile.status,
                };
                // Create a compatible upload object for the rest of the logic
                upload = {
                    id: genericFile.id,
                    originalFilename: genericFile.name,
                    userId: null,
                    storagePath: genericFile.storagePath || '',
                    storageKey: genericFile.storagePath || '',
                    status: genericFile.status as any,
                    createdAt: new Date(),
                    fileSize: genericFile.size,
                    mimeType: genericFile.type,
                    checksum: '',
                } as any;
            }
        }

        if (!upload) {
            throw new Error("Upload not found");
        }

        // For generic files (PDF, DOCX, etc.) - use a simpler analysis path
        if (isGenericFile && genericFileData) {
            const baseName = (genericFileData.name || 'Document').replace(/\.[^.]+$/, '');

            // Check if file is already processed
            if (genericFileData.status === 'ready') {
                // Get the already-processed content from file chunks
                const chunks = await storage.getFileChunks(uploadId);
                const content = chunks
                    .sort((a, b) => a.chunkIndex - b.chunkIndex)
                    .map(c => c.content)
                    .join("\n");

                // Create a simple analysis record for tracking
                // Note: uploadId set to null because chat_message_analysis.upload_id
                // has a FK to spreadsheet_uploads, not to files table.
                const chatAnalysis = await storage.createChatMessageAnalysis({
                    messageId: messageId || null,
                    uploadId: null,
                    status: "completed",
                    scope,
                    sheetsToAnalyze: [baseName],
                    startedAt: new Date(),
                    completedAt: new Date(),
                    summary: `Documento "${baseName}" procesado. Contenido disponible para análisis.`,
                });

                return {
                    analysisId: chatAnalysis.id,
                    sessionId: `doc_${uploadId}`,
                    status: "completed",
                    fileContent: content.length > 5000000 ? content.substring(0, 5000000) + "..." : content,
                    message: `El documento "${genericFileData.name}" ha sido procesado y está listo para consultas.`,
                };
            } else if (genericFileData.status === 'processing') {
                return {
                    analysisId: `pending_${uploadId}`,
                    sessionId: null,
                    status: "analyzing",
                    message: "El documento aún se está procesando. Por favor, espere unos segundos.",
                };
            } else {
                throw new Error(`El documento no pudo ser procesado (Status: ${genericFileData.status})`);
            }
        }

        // Original spreadsheet analysis logic
        // At this point, isGenericFile is false, so upload is from spreadsheetUploads table
        const spreadsheetUpload = upload as { originalFilename?: string | null; fileName?: string | null };
        let targetSheets: string[];
        const filename = spreadsheetUpload.originalFilename || spreadsheetUpload.fileName || '';
        const isSpreadsheet = isSpreadsheetFile(filename);

        if (isSpreadsheet) {
            const sheets = await getSheets(uploadId);
            if (sheets.length === 0) {
                targetSheets = ["Sheet1"];
            } else if (scope === "selected" && sheetsToAnalyze && sheetsToAnalyze.length > 0) {
                targetSheets = sheetsToAnalyze.filter(name =>
                    sheets.some(s => s.name === name)
                );
                if (targetSheets.length === 0) {
                    throw new Error("No valid sheets specified for analysis");
                }
            } else if (scope === "active") {
                targetSheets = [sheets[0].name];
            } else {
                targetSheets = sheets.map(s => s.name);
            }
        } else {
            const baseName = (filename || 'Document').replace(/\.[^.]+$/, '');
            targetSheets = [baseName];
        }

        const chatAnalysis = await storage.createChatMessageAnalysis({
            messageId: messageId || null,
            uploadId,
            status: "pending",
            scope,
            sheetsToAnalyze: targetSheets,
            startedAt: new Date(),
        });

        try {
            const { sessionId } = await startAnalysis({
                uploadId,
                userId,
                scope,
                sheetNames: targetSheets,
                analysisMode: "full",
                userPrompt: prompt,
            });

            await storage.updateChatMessageAnalysis(chatAnalysis.id, {
                sessionId,
                status: "analyzing",
            });

            return {
                analysisId: chatAnalysis.id,
                sessionId,
                status: "analyzing",
            };
        } catch (analysisError: any) {
            await storage.updateChatMessageAnalysis(chatAnalysis.id, {
                status: "failed",
                completedAt: new Date(),
            });
            throw analysisError;
        }
    }

    async getAnalysisStatus(uploadId: string): Promise<AnalysisResponse> {
        const chatAnalysis = await storage.getChatMessageAnalysisByUploadId(uploadId);
        if (!chatAnalysis) {
            throw new Error("Analysis not found for this upload");
        }

        interface SheetStatus {
            sheetName: string;
            status: "queued" | "running" | "done" | "failed";
            error?: string;
        }

        interface SheetResult {
            sheetName: string;
            generatedCode?: string;
            summary?: string;
            metrics?: Array<{ label: string; value: string }>;
            preview?: { headers: string[]; rows: any[][] };
            error?: string;
        }

        let progressData = {
            currentSheet: 0,
            totalSheets: 0,
            sheets: [] as SheetStatus[]
        };
        let resultsData: {
            crossSheetSummary?: string;
            sheets: SheetResult[];
        } = { sheets: [] };
        let overallStatus: "pending" | "analyzing" | "completed" | "failed" = chatAnalysis.status as any;
        let errorMessage: string | undefined;

        if (chatAnalysis.sessionId) {
            try {
                const analysisProgress = await getAnalysisProgress(chatAnalysis.sessionId);

                progressData = {
                    currentSheet: analysisProgress.completedJobs,
                    totalSheets: analysisProgress.totalJobs,
                    sheets: analysisProgress.jobs.map(job => ({
                        sheetName: job.sheetName,
                        status: job.status,
                        error: job.error,
                    })),
                };

                if (analysisProgress.status === "completed" || analysisProgress.status === "failed") {
                    const results = await getAnalysisResults(chatAnalysis.sessionId);
                    if (results) {
                        resultsData.crossSheetSummary = results.crossSheetSummary;

                        resultsData.sheets = analysisProgress.jobs.map(job => {
                            const sheetResults = results.perSheet[job.sheetName];
                            if (!sheetResults) {
                                return {
                                    sheetName: job.sheetName,
                                    error: job.error || "No results available",
                                };
                            }

                            const metricsObj = sheetResults.outputs?.metrics || {};
                            const metricsArray = Object.entries(metricsObj).map(([label, value]) => ({
                                label,
                                value: typeof value === 'object' ? JSON.stringify(value) : String(value),
                            }));

                            const PREVIEW_ROW_LIMIT = 100;
                            const PREVIEW_COL_LIMIT = 50;

                            let preview: { headers: string[]; rows: any[][]; meta?: { totalRows: number; totalCols: number; truncated: boolean } } | undefined;
                            const tables = sheetResults.outputs?.tables || [];
                            if (tables.length > 0 && Array.isArray(tables[0])) {
                                const tableData = tables[0] as unknown[];
                                if (tableData.length > 0) {
                                    const firstRow = tableData[0];
                                    if (typeof firstRow === 'object' && firstRow !== null) {
                                        const allHeaders = Object.keys(firstRow);
                                        const totalRows = tableData.length;
                                        const totalCols = allHeaders.length;
                                        const truncated = totalRows > PREVIEW_ROW_LIMIT || totalCols > PREVIEW_COL_LIMIT;

                                        preview = {
                                            headers: allHeaders.slice(0, PREVIEW_COL_LIMIT),
                                            rows: tableData.slice(0, PREVIEW_ROW_LIMIT).map(row => {
                                                const values = Object.values(row as Record<string, unknown>);
                                                return values.slice(0, PREVIEW_COL_LIMIT);
                                            }),
                                            meta: { totalRows, totalCols, truncated },
                                        };

                                        analysisLogger.trackPreviewGeneration(
                                            { uploadId, sessionId: chatAnalysis.sessionId || undefined },
                                            Math.min(totalRows, PREVIEW_ROW_LIMIT),
                                            Math.min(totalCols, PREVIEW_COL_LIMIT),
                                            truncated
                                        );
                                    }
                                }
                            }

                            return {
                                sheetName: job.sheetName,
                                generatedCode: sheetResults.generatedCode,
                                summary: sheetResults.summary,
                                metrics: metricsArray.length > 0 ? metricsArray : undefined,
                                preview,
                            };
                        });
                    }

                    overallStatus = analysisProgress.status;

                    if (chatAnalysis.status !== "completed" && chatAnalysis.status !== "failed") {
                        await storage.updateChatMessageAnalysis(chatAnalysis.id, {
                            status: analysisProgress.status,
                            completedAt: new Date(),
                            summary: resultsData.crossSheetSummary,
                        });
                    }
                } else {
                    overallStatus = analysisProgress.status === "running" ? "analyzing" : "pending";
                }
            } catch (progressError: any) {
                console.error("[AnalysisService] Error getting analysis progress:", progressError);
                errorMessage = progressError.message;
            }
        }

        return {
            analysisId: chatAnalysis.id,
            sessionId: chatAnalysis.sessionId,
            status: overallStatus,
            progress: progressData,
            results: resultsData.sheets.length > 0 ? resultsData : undefined,
            error: errorMessage,
            startedAt: chatAnalysis.startedAt?.toISOString(),
            completedAt: chatAnalysis.completedAt?.toISOString(),
        };
    }
}

export const analysisService = new AnalysisService();
