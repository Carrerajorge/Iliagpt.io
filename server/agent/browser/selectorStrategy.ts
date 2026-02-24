/**
 * Selector Strategy — Anti-fragile element targeting for browser automation.
 *
 * Cascade order:
 *   1. ARIA role + name  (most stable)
 *   2. data-testid / data-qa
 *   3. Visible text + proximity heuristic
 *   4. CSS selector
 *   5. XPath (last resort)
 *
 * Each resolved selector includes the strategy used and a stability score.
 */

import type { Page, Locator } from "playwright";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type SelectorStrategyType =
  | "aria"
  | "data-testid"
  | "text"
  | "css"
  | "xpath";

export interface SelectorTarget {
  /** Original target specification from the agent. */
  raw: string;
  /** Resolved Playwright locator string. */
  resolved: string;
  /** Which strategy resolved the target. */
  strategy: SelectorStrategyType;
  /** Stability score 0–1 (higher = more resilient to UI changes). */
  stability: number;
  /** If true, the element was found in the DOM. */
  found: boolean;
}

export interface SelectorOptions {
  /** Only try specific strategies (default: all in cascade order). */
  strategies?: SelectorStrategyType[];
  /** Timeout for each strategy attempt (ms). */
  timeoutMs?: number;
  /** If true, require element to be visible. */
  requireVisible?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Stability scores per strategy                                     */
/* ------------------------------------------------------------------ */

const STABILITY: Record<SelectorStrategyType, number> = {
  aria: 0.95,
  "data-testid": 0.90,
  text: 0.70,
  css: 0.50,
  xpath: 0.30,
};

/* ------------------------------------------------------------------ */
/*  Default cascade                                                   */
/* ------------------------------------------------------------------ */

const DEFAULT_CASCADE: SelectorStrategyType[] = [
  "aria",
  "data-testid",
  "text",
  "css",
  "xpath",
];

/* ------------------------------------------------------------------ */
/*  Resolver                                                          */
/* ------------------------------------------------------------------ */

export class SelectorResolver {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Resolve a target string to the best available selector.
   *
   * The target can be:
   *   - An explicit strategy prefix: `aria:Button:Submit`, `testid:login-btn`
   *   - A CSS selector: `#login-form button.submit`
   *   - Plain text: `Submit` (will be searched across strategies)
   */
  async resolve(target: string, options: SelectorOptions = {}): Promise<SelectorTarget> {
    const strategies = options.strategies || DEFAULT_CASCADE;
    const timeout = options.timeoutMs || 5000;

    // Check for explicit strategy prefix
    const prefixed = this.parsePrefix(target);
    if (prefixed) {
      const found = await this.tryLocator(prefixed.locator, timeout, options.requireVisible);
      return {
        raw: target,
        resolved: prefixed.locator,
        strategy: prefixed.strategy,
        stability: STABILITY[prefixed.strategy],
        found,
      };
    }

    // Cascade through strategies
    for (const strategy of strategies) {
      const candidates = this.generateCandidates(target, strategy);

      for (const candidate of candidates) {
        const found = await this.tryLocator(candidate, timeout, options.requireVisible);
        if (found) {
          return {
            raw: target,
            resolved: candidate,
            strategy,
            stability: STABILITY[strategy],
            found: true,
          };
        }
      }
    }

    // Nothing worked — return the raw target as CSS (best guess)
    return {
      raw: target,
      resolved: target,
      strategy: "css",
      stability: 0.2,
      found: false,
    };
  }

  /**
   * Get the Playwright Locator for a resolved target.
   */
  getLocator(resolved: SelectorTarget): Locator {
    return this.page.locator(resolved.resolved);
  }

  /* -- Internal ---------------------------------------------------- */

  private parsePrefix(target: string): { strategy: SelectorStrategyType; locator: string } | null {
    const prefixMap: Record<string, { strategy: SelectorStrategyType; transform: (v: string) => string }> = {
      "aria:": { strategy: "aria", transform: (v) => `role=${v.split(":")[0]}[name="${v.split(":").slice(1).join(":")}"]` },
      "role:": { strategy: "aria", transform: (v) => `role=${v}` },
      "testid:": { strategy: "data-testid", transform: (v) => `[data-testid="${v}"]` },
      "data-testid:": { strategy: "data-testid", transform: (v) => `[data-testid="${v}"]` },
      "data-qa:": { strategy: "data-testid", transform: (v) => `[data-qa="${v}"]` },
      "text:": { strategy: "text", transform: (v) => `text=${v}` },
      "xpath:": { strategy: "xpath", transform: (v) => `xpath=${v}` },
      "css:": { strategy: "css", transform: (v) => v },
    };

    for (const [prefix, config] of Object.entries(prefixMap)) {
      if (target.startsWith(prefix)) {
        const value = target.slice(prefix.length).trim();
        return { strategy: config.strategy, locator: config.transform(value) };
      }
    }

    return null;
  }

  private generateCandidates(target: string, strategy: SelectorStrategyType): string[] {
    switch (strategy) {
      case "aria":
        return [
          `role=button[name="${target}"]`,
          `role=link[name="${target}"]`,
          `role=textbox[name="${target}"]`,
          `role=checkbox[name="${target}"]`,
          `role=menuitem[name="${target}"]`,
          `role=tab[name="${target}"]`,
          `role=heading[name="${target}"]`,
        ];

      case "data-testid":
        return [
          `[data-testid="${target}"]`,
          `[data-qa="${target}"]`,
          `[data-cy="${target}"]`,
          `[data-test="${target}"]`,
          `[data-testid*="${target}"]`,
        ];

      case "text":
        return [
          `text="${target}"`,
          `text=${target}`,
          `*:has-text("${target}")`,
        ];

      case "css":
        return [target]; // Assume the raw target is a valid CSS selector

      case "xpath":
        return [
          `xpath=//*[contains(text(), "${target}")]`,
          `xpath=//*[@aria-label="${target}"]`,
          `xpath=//*[@title="${target}"]`,
          `xpath=//*[@placeholder="${target}"]`,
        ];
    }
  }

  private async tryLocator(selector: string, timeoutMs: number, requireVisible?: boolean): Promise<boolean> {
    try {
      const locator = this.page.locator(selector).first();
      await locator.waitFor({
        state: requireVisible ? "visible" : "attached",
        timeout: timeoutMs,
      });
      return true;
    } catch {
      return false;
    }
  }
}
