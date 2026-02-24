import { describe, test, expect, beforeEach } from "vitest";
import { PromptUnderstanding } from "../index";

describe("PromptUnderstanding - Property Tests", () => {
    let module: PromptUnderstanding;

    beforeEach(() => {
        module = new PromptUnderstanding();
    });

    test("Invariant: Risky actions must require confirmation via policy", () => {
        const riskyVerbs = ["delete", "remove", "drop", "wipe", "truncate"];

        for (const verb of riskyVerbs) {
            module.reset();
            const prompt = `Please ${verb} the database.`;
            const result = module.processSync(prompt);

            // Either a security risk is detected OR a confirmation policy is triggered
            const hasSecurityRisk = result.spec.risks.some(r => r.type === "security");
            const confirmationViolations = result.policyViolations?.filter(
                v => v.severity === "require_confirmation"
            ) || [];

            expect(hasSecurityRisk || confirmationViolations.length > 0).toBe(true);
        }
    });

    test("Invariant: Empty goal triggers policy violation", () => {
        const result = module.processSync("");

        const blockingViolations = result.policyViolations?.filter(
            v => v.severity === "block" && v.policyId === "require_goal_clarity"
        ) || [];

        expect(blockingViolations.length).toBeGreaterThan(0);
    });

    test("Invariant: All results have a requestId", () => {
        const result = module.processSync("Any prompt here");
        expect(result.requestId).toBeDefined();
        expect(result.requestId.length).toBeGreaterThan(0);
    });

    test("Invariant: Processing time is tracked", () => {
        const result = module.processSync("Test prompt");
        expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    test("Invariant: Confidence is between 0 and 1", () => {
        const result = module.processSync("Search for information");
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
    });
});
