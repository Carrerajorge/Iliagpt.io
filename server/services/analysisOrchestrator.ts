import {
  type SpreadsheetAnalysisSession,
  type SpreadsheetAnalysisJob,
  type AnalysisScope as SchemaAnalysisScope,
  type SessionAnalysisMode as SchemaSessionAnalysisMode,
  type AnalysisJobStatus,
} from "@shared/schema";
import {
  createAnalysisSession,
  getAnalysisSession,
  updateAnalysisSession,
  getSheets,
  getSheetByName,
  createAnalysisJob,
  getAnalysisJobsBySession,
  getAnalysisJob,
  updateAnalysisJob,
  createAnalysisOutput,
  getAnalysisOutputs,
  getUpload,
} from "./spreadsheetAnalyzer";
import {
  generateAnalysisCode,
  validatePythonCode,
  type AnalysisMode,
} from "./spreadsheetLlmAgent";
import { executePythonCode } from "./pythonSandbox";
import { llmGateway } from "../lib/llmGateway";
import { analysisLogger, createAnalysisContext, withCorrelationId } from "../lib/analysisLogger";

export type AnalysisScope = "active" | "selected" | "all";
export type SessionAnalysisMode = "full" | "summary" | "extract_tasks" | "text_only" | "custom";
export type JobStatus = "queued" | "running" | "done" | "failed";

export interface StartAnalysisParams {
  uploadId: string;
  userId: string;
  scope: AnalysisScope;
  sheetNames: string[];
  analysisMode: SessionAnalysisMode;
  userPrompt?: string;
}

export interface AnalysisProgress {
  sessionId: string;
  status: "pending" | "running" | "completed" | "failed";
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  jobs: Array<{
    sheetName: string;
    status: JobStatus;
    error?: string;
  }>;
}

export interface AnalysisResults {
  sessionId: string;
  perSheet: Record<string, {
    generatedCode: string;
    outputs: any;
    summary: string;
  }>;
  crossSheetSummary: string;
}

function mapSessionModeToAnalysisMode(mode: SessionAnalysisMode): AnalysisMode {
  switch (mode) {
    case "full":
    case "summary":
    case "extract_tasks":
      return "full";
    case "text_only":
      return "text_only";
    case "custom":
      return "full";
    default:
      return "full";
  }
}

export async function startAnalysis(params: StartAnalysisParams): Promise<{ sessionId: string }> {
  const { uploadId, userId, scope, sheetNames, analysisMode, userPrompt } = params;

  const allSheets = await getSheets(uploadId);
  if (allSheets.length === 0) {
    throw new Error("No sheets found for this upload");
  }

  let targetSheetNames: string[];
  switch (scope) {
    case "active":
      targetSheetNames = [allSheets[0].name];
      break;
    case "selected":
      targetSheetNames = sheetNames.filter(name =>
        allSheets.some(sheet => sheet.name === name)
      );
      if (targetSheetNames.length === 0) {
        throw new Error("No valid sheet names provided for 'selected' scope");
      }
      break;
    case "all":
      targetSheetNames = allSheets.map(sheet => sheet.name);
      break;
    default:
      targetSheetNames = [allSheets[0].name];
  }

  const session = await createAnalysisSession({
    uploadId,
    userId,
    sheetName: targetSheetNames[0],
    mode: mapSessionModeToAnalysisMode(analysisMode),
    userPrompt: userPrompt ?? null,
    status: "pending",
    scope: scope as SchemaAnalysisScope,
    targetSheets: targetSheetNames,
    analysisMode: analysisMode as SchemaSessionAnalysisMode,
    totalJobs: targetSheetNames.length,
    completedJobs: 0,
    failedJobs: 0,
  });

  const logContext = createAnalysisContext(uploadId, session.id);
  analysisLogger.trackAnalysisStart(uploadId, session.id, targetSheetNames.length);

  const jobPromises = targetSheetNames.map(sheetName =>
    createAnalysisJob({
      sessionId: session.id,
      sheetName,
      status: "queued",
    })
  );
  const jobs = await Promise.all(jobPromises);

  await updateAnalysisSession(session.id, {
    status: "generating_code",
    startedAt: new Date(),
  });

  for (const job of jobs) {
    executeSheetJob(job.id, session.id, uploadId, analysisMode, userPrompt, logContext).catch(err => {
      analysisLogger.error(
        withCorrelationId(logContext, job.id),
        { event: 'job_execution_error', status: 'failed', error: err.message }
      );
    });
  }

  return { sessionId: session.id };
}

async function executeSheetJob(
  jobId: string,
  sessionId: string,
  uploadId: string,
  analysisMode: SessionAnalysisMode,
  userPrompt?: string,
  parentContext?: ReturnType<typeof createAnalysisContext>
): Promise<void> {
  const job = await getAnalysisJob(jobId);
  const jobContext = withCorrelationId(
    parentContext || createAnalysisContext(uploadId, sessionId),
    jobId,
    job?.sheetName
  );
  const jobTimer = analysisLogger.trackSheetJobStart(jobContext);

  try {
    await updateAnalysisJob(jobId, {
      status: "running",
      startedAt: new Date(),
    });

    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const sheet = await getSheetByName(uploadId, job.sheetName);
    if (!sheet) {
      throw new Error(`Sheet ${job.sheetName} not found`);
    }

    const upload = await getUpload(uploadId);
    if (!upload) {
      throw new Error(`Upload ${uploadId} not found`);
    }

    const headers = (sheet.inferredHeaders as string[]) || [];
    const columnTypes = (sheet.columnTypes as any[]) || [];
    const sampleData = (sheet.previewData as any[][]) || [];

    const codeResult = await generateAnalysisCode({
      sheetName: job.sheetName,
      headers,
      columnTypes,
      sampleData: sampleData.slice(0, 10),
      mode: mapSessionModeToAnalysisMode(analysisMode),
      userPrompt,
    });

    const validation = validatePythonCode(codeResult.code);
    if (!validation.valid) {
      throw new Error(`Code validation failed: ${validation.errors.join(", ")}`);
    }

    await updateAnalysisJob(jobId, {
      generatedCode: codeResult.code,
    });

    const executionResult = await executePythonCode({
      code: codeResult.code,
      filePath: upload.storageKey,
      sheetName: job.sheetName,
      timeoutMs: 60000,
    });

    analysisLogger.trackSandboxExecution(
      jobContext,
      executionResult.executionTimeMs,
      executionResult.success,
      executionResult.error
    );

    if (!executionResult.success) {
      throw new Error(executionResult.error || "Execution failed");
    }

    const output = executionResult.output;

    if (output.tables) {
      for (let i = 0; i < output.tables.length; i++) {
        const table = output.tables[i];
        await createAnalysisOutput({
          sessionId,
          outputType: "table",
          title: table.name || `Table ${i + 1}`,
          payload: table.data,
          order: i,
        });
      }
    }

    if (output.metrics) {
      await createAnalysisOutput({
        sessionId,
        outputType: "metric",
        title: "Metrics",
        payload: output.metrics,
        order: 1000,
      });
    }

    if (output.charts) {
      for (let i = 0; i < output.charts.length; i++) {
        await createAnalysisOutput({
          sessionId,
          outputType: "chart",
          title: output.charts[i].title || `Chart ${i + 1}`,
          payload: output.charts[i],
          order: 2000 + i,
        });
      }
    }

    if (output.summary) {
      await createAnalysisOutput({
        sessionId,
        outputType: "summary",
        title: `${job.sheetName} Summary`,
        payload: { text: output.summary, sheetName: job.sheetName },
        order: 3000,
      });
    }

    if (output.logs && output.logs.length > 0) {
      await createAnalysisOutput({
        sessionId,
        outputType: "log",
        title: "Execution Logs",
        payload: output.logs,
        order: 4000,
      });
    }

    await updateAnalysisJob(jobId, {
      status: "done",
      completedAt: new Date(),
    });

    await updateSessionJobCounts(sessionId, true);
    jobTimer.endTimer(true);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await updateAnalysisJob(jobId, {
      status: "failed",
      error: errorMessage,
      completedAt: new Date(),
    });

    await createAnalysisOutput({
      sessionId,
      outputType: "error",
      title: "Execution Error",
      payload: { error: errorMessage, jobId },
      order: 5000,
    });

    await updateSessionJobCounts(sessionId, false);
    jobTimer.endTimer(false, errorMessage);
  }
}

async function updateSessionJobCounts(sessionId: string, success: boolean): Promise<void> {
  const session = await getAnalysisSession(sessionId);
  if (!session) return;

  const completedJobs = (session.completedJobs || 0) + (success ? 1 : 0);
  const failedJobs = (session.failedJobs || 0) + (success ? 0 : 1);
  const totalJobs = session.totalJobs || 0;
  const allDone = completedJobs + failedJobs >= totalJobs;

  const updates: Partial<SpreadsheetAnalysisSession> = {
    completedJobs,
    failedJobs,
  };

  if (allDone) {
    if (failedJobs === totalJobs) {
      updates.status = "failed";
    } else {
      updates.status = "succeeded";
    }
    updates.completedAt = new Date();

    await updateAnalysisSession(sessionId, updates);

    if (completedJobs > 0) {
      try {
        const crossSheetSummary = await generateCrossSheetSummary(sessionId);
        await updateAnalysisSession(sessionId, { crossSheetSummary });
      } catch (err) {
        console.error(`[AnalysisOrchestrator] Failed to generate cross-sheet summary:`, err);
      }
    }
  } else {
    updates.status = "executing";
    await updateAnalysisSession(sessionId, updates);
  }
}

async function generateCrossSheetSummary(sessionId: string): Promise<string> {
  const outputs = await getAnalysisOutputs(sessionId);
  const summaryOutputs = outputs.filter(o => o.outputType === "summary");

  if (summaryOutputs.length === 0) {
    return "No individual sheet summaries available.";
  }

  if (summaryOutputs.length === 1) {
    const payload = summaryOutputs[0].payload as any;
    return payload.text || "Single sheet analysis completed.";
  }

  const sheetSummaries = summaryOutputs.map(o => {
    const payload = o.payload as any;
    return `## ${payload.sheetName || o.title}\n${payload.text || "No summary available."}`;
  }).join("\n\n");

  const prompt = `You are a data analyst. Given the following summaries from multiple spreadsheet sheets, create a unified cross-sheet summary that highlights:
1. Common patterns across sheets
2. Key differences between sheets
3. Overall insights from the combined data

Individual Sheet Summaries:
${sheetSummaries}

Provide a concise unified summary (2-4 paragraphs):`;

  try {
    const response = await llmGateway.chat(
      [
        { role: "system", content: "You are a data analyst expert at synthesizing insights from multiple data sources." },
        { role: "user", content: prompt },
      ],
      { temperature: 0.3, maxTokens: 1000 }
    );
    return response.content;
  } catch (error) {
    console.error("[AnalysisOrchestrator] LLM call failed for cross-sheet summary:", error);
    return `Cross-sheet summary generation failed. Individual summaries:\n\n${sheetSummaries}`;
  }
}

export async function getAnalysisProgress(sessionId: string): Promise<AnalysisProgress> {
  const session = await getAnalysisSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const jobs = await getAnalysisJobsBySession(sessionId);

  let overallStatus: AnalysisProgress["status"];
  switch (session.status) {
    case "pending":
    case "generating_code":
      overallStatus = "pending";
      break;
    case "executing":
      overallStatus = "running";
      break;
    case "succeeded":
      overallStatus = "completed";
      break;
    case "failed":
      overallStatus = "failed";
      break;
    default:
      overallStatus = "pending";
  }

  return {
    sessionId,
    status: overallStatus,
    totalJobs: session.totalJobs || jobs.length,
    completedJobs: session.completedJobs || 0,
    failedJobs: session.failedJobs || 0,
    jobs: jobs.map(job => ({
      sheetName: job.sheetName,
      status: (job.status as JobStatus) || "queued",
      error: job.error ?? undefined,
    })),
  };
}

export async function getAnalysisResults(sessionId: string): Promise<AnalysisResults | null> {
  const session = await getAnalysisSession(sessionId);
  if (!session) {
    return null;
  }

  if (session.status !== "succeeded" && session.status !== "failed") {
    return null;
  }

  const jobs = await getAnalysisJobsBySession(sessionId);
  const outputs = await getAnalysisOutputs(sessionId);

  const perSheet: AnalysisResults["perSheet"] = {};

  for (const job of jobs) {
    const jobOutputs = outputs.filter(o => {
      if (o.outputType === "summary") {
        const payload = o.payload as any;
        return payload.sheetName === job.sheetName;
      }
      return false;
    });

    const summaryOutput = jobOutputs.find(o => o.outputType === "summary");
    const summary = summaryOutput
      ? (summaryOutput.payload as any).text || ""
      : "";

    const sheetOutputs = {
      tables: outputs.filter(o => o.outputType === "table").map(o => o.payload),
      metrics: outputs.find(o => o.outputType === "metric")?.payload || {},
      charts: outputs.filter(o => o.outputType === "chart").map(o => o.payload),
      logs: outputs.filter(o => o.outputType === "log").flatMap(o => o.payload as string[]),
    };

    perSheet[job.sheetName] = {
      generatedCode: job.generatedCode || "",
      outputs: sheetOutputs,
      summary,
    };
  }

  return {
    sessionId,
    perSheet,
    crossSheetSummary: session.crossSheetSummary || "",
  };
}

export const analysisOrchestrator = {
  startAnalysis,
  getAnalysisProgress,
  getAnalysisResults,
};

export default analysisOrchestrator;
