import { browserWorker, NavigationResult } from "./browser-worker";
import { extractWithReadability, summarizeForLLM, ExtractedContent } from "./extractor";
import { routeMessage, RouteResult, extractUrls } from "./router";
import { storage } from "../storage";
import { ObjectStorageService } from "../objectStorage";
import { openai, MODELS } from "../lib/openai";
import crypto from "crypto";

export interface AgentTask {
  runId: string;
  objective: string;
  urls: string[];
  conversationId?: string;
}

export interface StepUpdate {
  runId: string;
  stepId: string;
  stepType: string;
  url?: string;
  status: "started" | "completed" | "failed";
  detail?: any;
  screenshot?: string;
  error?: string;
}

export type StepCallback = (update: StepUpdate) => void;

class AgentOrchestrator {
  private objectStorage: ObjectStorageService;
  private activeRuns: Map<string, { cancelled: boolean }> = new Map();

  constructor() {
    this.objectStorage = new ObjectStorageService();
  }

  async executeTask(task: AgentTask, onStep?: StepCallback): Promise<{
    success: boolean;
    content: string;
    sources: { fileName: string; content: string }[];
    error?: string;
  }> {
    const runControl = { cancelled: false };
    this.activeRuns.set(task.runId, runControl);

    let sessionId: string | null = null;
    const extractedContents: ExtractedContent[] = [];
    const sources: { fileName: string; content: string }[] = [];
    let stepIndex = 0;

    try {
      await storage.updateAgentRunStatus(task.runId, "running");
      
      sessionId = await browserWorker.createSession();

      for (const url of task.urls) {
        if (runControl.cancelled) {
          await storage.updateAgentRunStatus(task.runId, "cancelled");
          return { success: false, content: "", sources: [], error: "Cancelled by user" };
        }

        const stepId = crypto.randomUUID();
        
        onStep?.({
          runId: task.runId,
          stepId,
          stepType: "navigate",
          url,
          status: "started"
        });

        await storage.createAgentStep({
          runId: task.runId,
          stepType: "navigate",
          url,
          success: "pending",
          stepIndex: stepIndex++
        });

        const navResult = await browserWorker.navigate(sessionId, url, true);

        if (!navResult.success) {
          onStep?.({
            runId: task.runId,
            stepId,
            stepType: "navigate",
            url,
            status: "failed",
            error: navResult.error
          });
          continue;
        }

        let screenshotPath: string | undefined;
        if (navResult.screenshot) {
          try {
            const { uploadURL, storagePath } = await this.objectStorage.getObjectEntityUploadURLWithPath();
            await fetch(uploadURL, {
              method: "PUT",
              headers: { "Content-Type": "image/png" },
              body: navResult.screenshot
            });
            screenshotPath = storagePath;

            await storage.createAgentAsset({
              runId: task.runId,
              stepId,
              assetType: "screenshot",
              storagePath,
              metadata: { url, title: navResult.title }
            });
          } catch (e) {
            console.error("Failed to save screenshot:", e);
          }
        }

        onStep?.({
          runId: task.runId,
          stepId,
          stepType: "navigate",
          url,
          status: "completed",
          screenshot: screenshotPath,
          detail: { title: navResult.title, timing: navResult.timing }
        });

        if (runControl.cancelled) continue;

        const extractStepId = crypto.randomUUID();
        onStep?.({
          runId: task.runId,
          stepId: extractStepId,
          stepType: "extract",
          url,
          status: "started"
        });

        await storage.createAgentStep({
          runId: task.runId,
          stepType: "extract",
          url,
          success: "pending",
          stepIndex: stepIndex++
        });

        const extracted = navResult.html ? extractWithReadability(navResult.html, url) : null;

        if (extracted) {
          extractedContents.push(extracted);
          sources.push({
            fileName: extracted.title || url,
            content: extracted.excerpt || extracted.textContent.slice(0, 200) + "..."
          });

          await storage.createAgentAsset({
            runId: task.runId,
            stepId: extractStepId,
            assetType: "extracted_content",
            content: extracted.textContent.slice(0, 50000),
            metadata: { 
              title: extracted.title,
              byline: extracted.byline,
              siteName: extracted.siteName,
              length: extracted.length
            }
          });

          onStep?.({
            runId: task.runId,
            stepId: extractStepId,
            stepType: "extract",
            url,
            status: "completed",
            detail: { 
              title: extracted.title,
              length: extracted.length,
              linksCount: extracted.links.length
            }
          });
        } else {
          onStep?.({
            runId: task.runId,
            stepId: extractStepId,
            stepType: "extract",
            url,
            status: "failed",
            error: "Could not extract readable content"
          });
        }
      }

      if (sessionId) {
        await browserWorker.destroySession(sessionId);
      }

      if (runControl.cancelled) {
        await storage.updateAgentRunStatus(task.runId, "cancelled");
        return { success: false, content: "", sources: [], error: "Cancelled" };
      }

      const synthesisStepId = crypto.randomUUID();
      onStep?.({
        runId: task.runId,
        stepId: synthesisStepId,
        stepType: "synthesize",
        status: "started"
      });

      const contextFromPages = extractedContents
        .map((ec, i) => `--- Source ${i + 1}: ${ec.title} ---\n${summarizeForLLM(ec, 4000)}`)
        .join("\n\n");

      const response = await openai.chat.completions.create({
        model: "grok-3-fast",
        messages: [
          {
            role: "system",
            content: `You are iliagpt, an AI assistant that has just browsed the web and extracted information. 
Based on the extracted content below, provide a comprehensive response to the user's objective.
Cite your sources when referencing specific information.
Respond in the same language as the user's objective.`
          },
          {
            role: "user",
            content: `Objective: ${task.objective}\n\nExtracted Web Content:\n${contextFromPages}`
          }
        ]
      });

      const content = response.choices[0]?.message?.content || "No se pudo generar una respuesta.";

      onStep?.({
        runId: task.runId,
        stepId: synthesisStepId,
        stepType: "synthesize",
        status: "completed",
        detail: { responseLength: content.length }
      });

      await storage.updateAgentRunStatus(task.runId, "completed");
      this.activeRuns.delete(task.runId);

      return { success: true, content, sources };
    } catch (error: any) {
      console.error("Agent orchestrator error:", error);
      
      if (sessionId) {
        await browserWorker.destroySession(sessionId).catch(() => {});
      }
      
      await storage.updateAgentRunStatus(task.runId, "failed", error.message);
      this.activeRuns.delete(task.runId);
      
      return { 
        success: false, 
        content: `Error durante la navegación: ${error.message}`, 
        sources: [],
        error: error.message 
      };
    }
  }

  cancelRun(runId: string): boolean {
    const run = this.activeRuns.get(runId);
    if (run) {
      run.cancelled = true;
      return true;
    }
    return false;
  }

  isRunActive(runId: string): boolean {
    return this.activeRuns.has(runId);
  }
}

export const agentOrchestrator = new AgentOrchestrator();
