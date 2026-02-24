/**
 * Browser Assertion DSL — Structured assertions for browser automation.
 *
 * Every assertion captures evidence (screenshot, HTML snippet, logs)
 * so the Verifier agent can audit results.
 */

import type { Page } from "playwright";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type AssertionStatus = "pass" | "fail" | "skip" | "error";

export interface AssertionEvidence {
  screenshot?: string;
  htmlSnippet?: string;
  networkLog?: Array<{ url: string; status: number; method: string }>;
  consoleLog?: string[];
  timestamp: number;
  extra?: Record<string, any>;
}

export interface AssertionResult {
  name: string;
  status: AssertionStatus;
  message: string;
  evidence: AssertionEvidence;
  durationMs: number;
}

/* ------------------------------------------------------------------ */
/*  BrowserExpect — assertion builder                                 */
/* ------------------------------------------------------------------ */

export class BrowserExpect {
  private page: Page;
  private results: AssertionResult[] = [];
  private defaultTimeout: number;

  constructor(page: Page, defaultTimeout = 10_000) {
    this.page = page;
    this.defaultTimeout = defaultTimeout;
  }

  getResults(): AssertionResult[] {
    return [...this.results];
  }

  allPassed(): boolean {
    return this.results.every((r) => r.status === "pass" || r.status === "skip");
  }

  getSummary(): { total: number; passed: number; failed: number; errors: number } {
    return {
      total: this.results.length,
      passed: this.results.filter((r) => r.status === "pass").length,
      failed: this.results.filter((r) => r.status === "fail").length,
      errors: this.results.filter((r) => r.status === "error").length,
    };
  }

  /* -- Assertions -------------------------------------------------- */

  /** Assert that an element matching the selector is visible. */
  async visible(selector: string, timeout?: number): Promise<AssertionResult> {
    return this.runAssertion(`visible(${selector})`, async () => {
      const locator = this.page.locator(selector).first();
      await locator.waitFor({ state: "visible", timeout: timeout || this.defaultTimeout });
      return { status: "pass" as const, message: `Element "${selector}" is visible` };
    });
  }

  /** Assert that an element matching the selector is NOT visible. */
  async hidden(selector: string, timeout?: number): Promise<AssertionResult> {
    return this.runAssertion(`hidden(${selector})`, async () => {
      const locator = this.page.locator(selector).first();
      await locator.waitFor({ state: "hidden", timeout: timeout || this.defaultTimeout });
      return { status: "pass" as const, message: `Element "${selector}" is hidden` };
    });
  }

  /** Assert that an element's text contains the expected substring. */
  async textContains(selector: string, expected: string, timeout?: number): Promise<AssertionResult> {
    return this.runAssertion(`textContains(${selector}, "${expected}")`, async () => {
      const locator = this.page.locator(selector).first();
      await locator.waitFor({ state: "visible", timeout: timeout || this.defaultTimeout });
      const text = await locator.innerText();
      if (text.includes(expected)) {
        return { status: "pass" as const, message: `Text contains "${expected}"` };
      }
      return { status: "fail" as const, message: `Expected text to contain "${expected}", got: "${text.slice(0, 200)}"` };
    });
  }

  /** Assert that an element's text exactly equals the expected value. */
  async textEquals(selector: string, expected: string, timeout?: number): Promise<AssertionResult> {
    return this.runAssertion(`textEquals(${selector}, "${expected}")`, async () => {
      const locator = this.page.locator(selector).first();
      await locator.waitFor({ state: "visible", timeout: timeout || this.defaultTimeout });
      const text = (await locator.innerText()).trim();
      if (text === expected) {
        return { status: "pass" as const, message: `Text equals "${expected}"` };
      }
      return { status: "fail" as const, message: `Expected "${expected}", got: "${text.slice(0, 200)}"` };
    });
  }

  /** Assert that the current URL matches a pattern. */
  async urlMatches(pattern: string | RegExp): Promise<AssertionResult> {
    return this.runAssertion(`urlMatches(${pattern})`, async () => {
      const url = this.page.url();
      const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
      if (regex.test(url)) {
        return { status: "pass" as const, message: `URL "${url}" matches ${pattern}` };
      }
      return { status: "fail" as const, message: `URL "${url}" does not match ${pattern}` };
    });
  }

  /** Assert that the page title contains the expected substring. */
  async titleContains(expected: string): Promise<AssertionResult> {
    return this.runAssertion(`titleContains("${expected}")`, async () => {
      const title = await this.page.title();
      if (title.includes(expected)) {
        return { status: "pass" as const, message: `Title contains "${expected}"` };
      }
      return { status: "fail" as const, message: `Expected title to contain "${expected}", got: "${title}"` };
    });
  }

  /** Assert that a specific network request returned a success status. */
  async networkStatus(
    urlPattern: string | RegExp,
    expectedRange: [number, number] = [200, 299],
    timeout?: number
  ): Promise<AssertionResult> {
    return this.runAssertion(`networkStatus(${urlPattern}, ${expectedRange})`, async () => {
      const regex = typeof urlPattern === "string" ? new RegExp(urlPattern) : urlPattern;

      try {
        const response = await this.page.waitForResponse(
          (resp) => regex.test(resp.url()),
          { timeout: timeout || this.defaultTimeout }
        );
        const status = response.status();
        if (status >= expectedRange[0] && status <= expectedRange[1]) {
          return { status: "pass" as const, message: `Network ${response.url()} returned ${status}` };
        }
        return {
          status: "fail" as const,
          message: `Expected status ${expectedRange[0]}–${expectedRange[1]}, got ${status} for ${response.url()}`,
        };
      } catch {
        return { status: "fail" as const, message: `No matching network request for ${urlPattern}` };
      }
    });
  }

  /** Assert that an element has a specific attribute value. */
  async attributeEquals(
    selector: string,
    attribute: string,
    expected: string,
    timeout?: number
  ): Promise<AssertionResult> {
    return this.runAssertion(`attributeEquals(${selector}, ${attribute}, "${expected}")`, async () => {
      const locator = this.page.locator(selector).first();
      await locator.waitFor({ state: "attached", timeout: timeout || this.defaultTimeout });
      const value = await locator.getAttribute(attribute);
      if (value === expected) {
        return { status: "pass" as const, message: `${attribute}="${expected}"` };
      }
      return { status: "fail" as const, message: `Expected ${attribute}="${expected}", got: "${value}"` };
    });
  }

  /** Assert that an element count matches. */
  async elementCount(selector: string, expected: number): Promise<AssertionResult> {
    return this.runAssertion(`elementCount(${selector}, ${expected})`, async () => {
      const count = await this.page.locator(selector).count();
      if (count === expected) {
        return { status: "pass" as const, message: `Found ${count} element(s)` };
      }
      return { status: "fail" as const, message: `Expected ${expected} element(s), found ${count}` };
    });
  }

  /** Assert that a file was downloaded (check by waiting for download event). */
  async fileDownloaded(triggerAction: () => Promise<void>, timeout?: number): Promise<AssertionResult> {
    return this.runAssertion("fileDownloaded()", async () => {
      try {
        const [download] = await Promise.all([
          this.page.waitForEvent("download", { timeout: timeout || this.defaultTimeout }),
          triggerAction(),
        ]);
        const filename = download.suggestedFilename();
        return { status: "pass" as const, message: `File downloaded: ${filename}` };
      } catch {
        return { status: "fail" as const, message: "No download event detected" };
      }
    });
  }

  /** Custom assertion using a page.evaluate expression. */
  async custom(name: string, evaluateFn: string): Promise<AssertionResult> {
    return this.runAssertion(`custom(${name})`, async () => {
      const result = await this.page.evaluate(evaluateFn);
      if (result) {
        return { status: "pass" as const, message: `Custom assertion "${name}" passed` };
      }
      return { status: "fail" as const, message: `Custom assertion "${name}" failed` };
    });
  }

  /* -- Internal ---------------------------------------------------- */

  private async runAssertion(
    name: string,
    fn: () => Promise<{ status: "pass" | "fail"; message: string }>
  ): Promise<AssertionResult> {
    const start = Date.now();
    let status: AssertionStatus;
    let message: string;
    let evidence: AssertionEvidence;

    try {
      const result = await fn();
      status = result.status;
      message = result.message;
    } catch (err: any) {
      status = "error";
      message = `Assertion error: ${err.message}`;
    }

    // Capture evidence regardless of outcome
    evidence = await this.captureEvidence();

    const assertionResult: AssertionResult = {
      name,
      status,
      message,
      evidence,
      durationMs: Date.now() - start,
    };

    this.results.push(assertionResult);
    return assertionResult;
  }

  private async captureEvidence(): Promise<AssertionEvidence> {
    const evidence: AssertionEvidence = {
      timestamp: Date.now(),
    };

    try {
      const buffer = await this.page.screenshot({ type: "png", fullPage: false });
      evidence.screenshot = `data:image/png;base64,${buffer.toString("base64")}`;
    } catch {
      // screenshot capture failed — non-critical
    }

    try {
      const html = await this.page.content();
      evidence.htmlSnippet = html.slice(0, 2000);
    } catch {
      // html capture failed — non-critical
    }

    return evidence;
  }
}
