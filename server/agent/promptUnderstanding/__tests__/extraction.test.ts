import { describe, test, expect, beforeEach } from "vitest";
import { PromptUnderstanding } from "../index";

describe("PromptUnderstanding - Extraction (Golden Set)", () => {
    let module: PromptUnderstanding;

    beforeEach(() => {
        module = new PromptUnderstanding();
    });

    test("Simple Research Request", () => {
        const result = module.processSync("Please search for the latest advancements in AI agents.");

        expect(result.isReady).toBe(true);
        expect(result.spec.goal).toContain("search for the latest advancements in AI agents");
        expect(result.spec.tasks.length).toBeGreaterThan(0);
        expect(result.spec.tasks.some(t => t.verb === "search")).toBe(true);

        // Check plan
        expect(result.plan).toBeDefined();
        expect(result.plan?.steps[0].toolName).toBe("search_web");
    });

    test("Document Creation with Constraints", () => {
        const result = module.processSync("Create a summary of the report in Spanish. Output as PDF.");

        expect(result.spec.goal).toContain("Create a summary");

        // Check constraints
        const constraints = result.spec.constraints;
        expect(constraints.some(c => c.type === "language" && c.value.includes("Spanish"))).toBe(true);
        expect(constraints.some(c => c.type === "format" && c.value.includes("PDF"))).toBe(true);
    });

    test("Multi-step complex request", () => {
        const result = module.processSync("First search for Apple stock price. Then analyze the trend. Finally write a report.");

        const tasks = result.spec.tasks;
        expect(tasks.length).toBeGreaterThanOrEqual(2);

        expect(tasks.some(t => t.verb === "search")).toBe(true);
        expect(tasks.some(t => t.verb === "write")).toBe(true);
    });

    test("Request with success criteria", () => {
        const result = module.processSync("Generate a report that must include all sales data from Q4.");

        expect(result.spec.tasks.some(t => t.verb === "generate")).toBe(true);
    });

    test("Request with external API hint", () => {
        const result = module.processSync("Fetch data from the weather API and display it.");

        expect(result.spec.tasks.some(t => t.verb === "fetch")).toBe(true);
    });
});
