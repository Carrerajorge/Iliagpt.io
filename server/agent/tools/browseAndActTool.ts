import { z } from "zod";
import type { ToolDefinition, ToolContext, ToolResult } from "../toolRegistry";
import { randomUUID } from "crypto";
import {
    extractReservationDetails,
    getMissingReservationFields,
    isRestaurantReservationRequest,
    normalizeSpaces,
    formatReservationDetails,
    buildReservationClarificationQuestion
} from "../utils/reservationExtractor";

const BrowseAndActSchema = z.object({
    url: z.string().url().describe("Starting URL to navigate to"),
    goal: z.string().describe("Detailed description of what to accomplish"),
    maxSteps: z.number().optional().describe("Maximum browser actions to take (default 20)"),
    allowedDomains: z.array(z.string()).optional().describe("List of allowed domains to restrict hallucinated navigation")
});

export const browseAndActTool: ToolDefinition = {
    name: "browse_and_act",
    description: "Open a real browser and autonomously accomplish a goal: navigate websites, fill forms, click buttons, make reservations, purchases, etc. Uses AI vision to analyze pages and decide actions automatically.",
    inputSchema: BrowseAndActSchema,
    execute: async (args: any, context: ToolContext): Promise<ToolResult> => {
        let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
        let result: any = {};
        const startTime = Date.now();
        let durationMs = 0;

        try {
            // Dynamic import to avoid loading puppeteer if not used
            const { universalBrowserController } = await import("../universalBrowserController");
            const sessionId = await universalBrowserController.createSession("chrome-desktop");
            const goalText = String(args.goal || "");
            const isReservationGoal = /\b(reserv(a|ar|ation)|book(ing)?|mesa|restaurant|restaurante)\b/i.test(goalText);
            const normalizedGoal = goalText.toLowerCase();
            const isCalaReservation = isReservationGoal && /\bcala\b/i.test(normalizedGoal);
            const goalDetails = isReservationGoal ? extractReservationDetails(goalText) : undefined;

            const reservationDetailsFromGoal = isReservationGoal ? goalDetails : undefined;

            const requestedUrl = String(args.url || "");
            const effectiveUrl = isCalaReservation
                ? "https://www.covermanager.com/reserve/module_restaurant/cala-restaurante/spanish"
                : (requestedUrl || "https://www.mesa247.pe");

            console.log(`[BrowserTool] Session created: ${sessionId}, navigating to ${effectiveUrl}`);

            const requestedMaxSteps = Number.isFinite(Number(args.maxSteps)) ? Number(args.maxSteps) : undefined;
            const maxSteps = Math.max(1, Math.min(requestedMaxSteps ?? 15, 20));
            const maxRuntimeMs = 300000;
            const decisionTimeoutMs = 25000;

            try {
                await universalBrowserController.navigate(sessionId, effectiveUrl);

                const onBrowserStep = (step: any) => {
                    // In a fully abstracted tool, we'd use context.onStream or context logs,
                    // but for backward compatibility, we'll log it for now.
                    console.log(`[BrowserTool Step ${step.stepNumber}/${step.totalSteps}] ${step.action}: ${step.reasoning}`);
                };

                const taskResult = isCalaReservation
                    ? await (async () => {
                        const missingFields = reservationDetailsFromGoal
                            ? getMissingReservationFields(reservationDetailsFromGoal)
                            : (["restaurant", "date", "time", "partySize", "contactName", "contactPhone", "contactEmail"] as string[]);
                        if (missingFields.length > 0) {
                            return {
                                success: false,
                                steps: ["Cala reservation requires additional user data before execution."],
                                data: {
                                    status: "needs_user_input",
                                    missingFields,
                                    question: `Para reservar en Cala necesito: ${missingFields.join(", ")}.`,
                                },
                                screenshots: [],
                            };
                        }
                        return universalBrowserController.runCalaReservation(
                            sessionId,
                            {
                                restaurant: reservationDetailsFromGoal?.restaurant,
                                date: reservationDetailsFromGoal?.date,
                                time: reservationDetailsFromGoal?.time,
                                partySize: reservationDetailsFromGoal?.partySize,
                                contactName: reservationDetailsFromGoal?.contactName,
                                email: reservationDetailsFromGoal?.email,
                                phone: reservationDetailsFromGoal?.phone,
                            },
                            onBrowserStep,
                            { maxRuntimeMs: 300000 }
                        );
                    })()
                    : await universalBrowserController.agenticNavigate(
                        sessionId,
                        args.goal,
                        maxSteps,
                        onBrowserStep,
                        {
                            maxRuntimeMs,
                            decisionTimeoutMs,
                            maxConsecutiveDecisionFailures: isReservationGoal ? 3 : 2,
                            allowedDomains: args.allowedDomains,
                        }
                    );

                console.log(`[BrowserTool] completed: success=${taskResult.success}, steps=${taskResult.steps.length}`);

                const rawStatus = String(taskResult?.data?.status || "").toLowerCase();
                const explicitNeedsInput = rawStatus === "needs_user_input" || Array.isArray(taskResult?.data?.missingFields);
                let normalizedSuccess = taskResult.success === true;

                if (isReservationGoal) {
                    if (explicitNeedsInput) {
                        normalizedSuccess = false;
                    } else if (rawStatus === "confirmed" || rawStatus === "completed" || rawStatus === "success") {
                        normalizedSuccess = true;
                    }
                }

                result = {
                    success: normalizedSuccess,
                    steps: taskResult.steps,
                    data: taskResult.data,
                    stepsCount: taskResult.steps.length,
                    screenshotsCount: taskResult.screenshots.length,
                };

                durationMs = Date.now() - startTime;
                return {
                    success: normalizedSuccess,
                    output: result,
                    artifacts: [], // Could attach screenshots here natively
                    metrics: { durationMs },
                };

            } finally {
                await universalBrowserController.closeSession(sessionId).catch(() => { });
                console.log(`[BrowserTool] Session closed: ${sessionId}`);
            }
        } catch (err: any) {
            console.error(`[BrowserTool] error:`, err?.message || err);
            return {
                success: false,
                output: null,
                error: { code: "BROWSER_ERROR", message: err.message, retryable: true },
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    }
};
