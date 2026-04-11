/**
 * Cognitive Middleware — Turn J real-browser Playwright suite.
 *
 * Drives a real chromium browser against the cognitive test
 * harness (`GET /api/cognitive/test-harness`) and invokes every
 * category of the ILIAGPT capability catalog through the
 * browser's own `fetch` API. This is the "navegador real"
 * verification the product spec requires: chromium executes the
 * JavaScript, hits the backend routes, and the tests assert on
 * the JSON that comes back.
 *
 * Each test follows the same pattern:
 *
 *   1. Navigate to the harness page.
 *   2. `page.evaluate(() => window.invokeCapability(id, args))`
 *      runs fetch inside the browser context.
 *   3. Assert on the returned CapabilityInvocation shape.
 *   4. Spot-check the DOM element the harness updates so we know
 *      the result actually hit the page, not just the network.
 *
 * No mocking. Every call goes through the full cognitive
 * pipeline: rate limit check, OTel span emission, registry
 * dispatch, real handler execution, persistence to the run
 * repository.
 *
 * Running:
 *   npx playwright test --config=playwright.config.capabilities.ts
 */

import { test, expect, type Page } from "@playwright/test";

const HARNESS_URL = "/api/cognitive/test-harness";

/** Navigate to the harness + wait for the JS helpers to be loaded. */
async function openHarness(page: Page): Promise<void> {
  await page.goto(HARNESS_URL);
  await page.waitForFunction(
    () =>
      (window as unknown as { __COGNITIVE_HARNESS__?: boolean })
        .__COGNITIVE_HARNESS__ === true,
  );
  // Reset handler stores so each test starts with a clean in-memory
  // state (scheduled tasks, projects, dispatch queue).
  await page.evaluate(() =>
    (window as unknown as { resetHandlerStores: () => Promise<unknown> }).resetHandlerStores(),
  );
}

/** Invoke a capability via the browser's fetch and return the JSON. */
async function invokeInBrowser(
  page: Page,
  id: string,
  args: Record<string, unknown> = {},
  userId: string = "harness",
  approvalToken?: string,
): Promise<{
  ok: boolean;
  result?: unknown;
  error?: string;
  errorCode?: string;
  category?: string;
  approvalChallengeToken?: string;
  message?: string;
}> {
  return page.evaluate(
    async (payload) => {
      const w = window as unknown as {
        invokeCapability: (
          id: string,
          args: Record<string, unknown>,
          userId: string,
          approvalToken: string | undefined,
        ) => Promise<unknown>;
      };
      return (await w.invokeCapability(
        payload.id,
        payload.args,
        payload.userId,
        payload.approvalToken,
      )) as unknown as {
        ok: boolean;
        result?: unknown;
        error?: string;
        errorCode?: string;
        category?: string;
        approvalChallengeToken?: string;
        message?: string;
      };
    },
    { id, args, userId, approvalToken },
  );
}

// ---------------------------------------------------------------------------
// 1. Discovery + availability
// ---------------------------------------------------------------------------

test.describe("cognitive capabilities — discovery", () => {
  test("E01 GET /capabilities lists 30+ descriptors across 17 categories", async ({
    page,
  }) => {
    await openHarness(page);
    const catalog = (await page.evaluate(async () => {
      const w = window as unknown as {
        listCapabilities: () => Promise<unknown>;
      };
      return (await w.listCapabilities()) as {
        categories: Array<{ key: string; label: string; count: number }>;
        capabilities: Array<{ id: string; status: string; category: string }>;
        totalCount: number;
        availableCount: number;
      };
    })) as {
      categories: Array<{ key: string; label: string; count: number }>;
      capabilities: Array<{ id: string; status: string; category: string }>;
      totalCount: number;
      availableCount: number;
    };

    expect(catalog.totalCount).toBeGreaterThanOrEqual(30);
    expect(catalog.availableCount).toBeGreaterThanOrEqual(20);
    // Every major ILIAGPT category must be present.
    const keys = catalog.categories.map((c) => c.key);
    for (const required of [
      "file_generation",
      "file_management",
      "data_analysis",
      "research_synthesis",
      "format_conversion",
      "browser_automation",
      "computer_use",
      "scheduled_tasks",
      "connectors",
      "plugins",
      "code_execution",
      "sub_agents",
      "projects",
      "security_governance",
      "enterprise",
      "dispatch_mobile",
      "availability",
    ]) {
      expect(keys, `missing category ${required}`).toContain(required);
    }

    // The harness page should show the count in its DOM.
    await expect(page.locator("#registry-count")).toContainText(
      `count=${catalog.totalCount}`,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Always-available capabilities
// ---------------------------------------------------------------------------

test.describe("cognitive capabilities — always available", () => {
  test("E02 availability.echo round-trips args", async ({ page }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "availability.echo", {
      hello: "mundo",
      n: 42,
    });
    expect(result.ok).toBe(true);
    expect(result.category).toBe("availability");
    expect(
      (result.result as { echoed: { hello: string; n: number } }).echoed,
    ).toEqual({ hello: "mundo", n: 42 });
  });

  test("E03 availability.platform_status returns buildInfo + plans", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "availability.platform_status");
    expect(result.ok).toBe(true);
    const res = result.result as {
      buildInfo: string;
      plans: string[];
      platforms: string[];
    };
    expect(res.buildInfo).toBeDefined();
    expect(Array.isArray(res.plans)).toBe(true);
    expect(res.plans.length).toBeGreaterThanOrEqual(4);
    expect(res.platforms).toContain("macOS");
  });
});

// ---------------------------------------------------------------------------
// 3. File generation
// ---------------------------------------------------------------------------

test.describe("cognitive capabilities — file generation", () => {
  test("E04 file_generation.create_excel_workbook returns xlsx bytes", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "file_generation.create_excel_workbook", {
      sheets: [
        {
          name: "Budget",
          headers: ["month", "revenue", "costs"],
          rows: [
            ["Jan", 10_000, 3_000],
            ["Feb", 12_000, 3_500],
          ],
          formulas: [{ cell: "D1", formula: "SUM(B2:B3)-SUM(C2:C3)" }],
        },
      ],
    });
    expect(result.ok).toBe(true);
    const res = result.result as {
      format: string;
      base64: string;
      sizeBytes: number;
      metadata: { sheetCount: number; totalRows: number; formulaCount: number };
    };
    expect(res.format).toBe("xlsx");
    expect(res.sizeBytes).toBeGreaterThan(1000);
    expect(res.metadata.sheetCount).toBe(1);
    expect(res.metadata.totalRows).toBe(2);
    expect(res.metadata.formulaCount).toBe(1);
    // Verify the base64 decodes to a zip inside the browser too.
    const verdict = await page.evaluate((base64) => {
      const binary = atob(base64);
      return binary.charCodeAt(0) === 0x50 && binary.charCodeAt(1) === 0x4b;
    }, res.base64);
    expect(verdict).toBe(true);
  });

  test("E05 file_generation.create_word_document returns docx bytes", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "file_generation.create_word_document", {
      title: "Quarterly Report",
      sections: [
        { heading: "Summary", paragraphs: ["Revenue grew 12% YoY."] },
        {
          heading: "Highlights",
          table: {
            headers: ["Metric", "Value"],
            rows: [
              ["ARR", "$1.2M"],
              ["Customers", "340"],
            ],
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
    const res = result.result as {
      format: string;
      sizeBytes: number;
      metadata: { paragraphCount: number; tableCount: number };
    };
    expect(res.format).toBe("docx");
    expect(res.sizeBytes).toBeGreaterThan(1000);
    expect(res.metadata.paragraphCount).toBe(1);
    expect(res.metadata.tableCount).toBe(1);
  });

  test("E06 file_generation.create_pdf returns PDF bytes with %PDF header", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "file_generation.create_pdf", {
      title: "Invoice 2026-04",
      body: [
        "This is the first paragraph of the invoice.",
        "Total: $1,234.56",
        "Thank you for your business.",
      ],
    });
    expect(result.ok).toBe(true);
    const res = result.result as {
      format: string;
      base64: string;
      sizeBytes: number;
      metadata: { pageCount: number };
    };
    expect(res.format).toBe("pdf");
    expect(res.metadata.pageCount).toBeGreaterThanOrEqual(1);
    // Decode in the browser and verify the %PDF header.
    const header = await page.evaluate((base64) => {
      const binary = atob(base64);
      return (
        binary.charCodeAt(0) === 0x25 &&
        binary.charCodeAt(1) === 0x50 &&
        binary.charCodeAt(2) === 0x44 &&
        binary.charCodeAt(3) === 0x46
      );
    }, res.base64);
    expect(header).toBe(true);
  });

  test("E07 file_generation.create_powerpoint returns pptx bytes with N slides", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "file_generation.create_powerpoint", {
      title: "Q4 Review",
      slides: [
        { title: "Highlights", bullets: ["ARR +12%", "NPS +5"] },
        { title: "Risks", bullets: ["Churn", "Pipeline"] },
      ],
    });
    expect(result.ok).toBe(true);
    const res = result.result as {
      format: string;
      metadata: { slideCount: number; bulletCount: number };
    };
    expect(res.format).toBe("pptx");
    expect(res.metadata.slideCount).toBe(3); // +1 for title slide
    expect(res.metadata.bulletCount).toBe(4);
  });

  test("E08 file_generation.create_code_file packages source as base64", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "file_generation.create_code_file", {
      language: "python",
      filename: "sum.py",
      source: "def add(a, b):\n    return a + b\n",
    });
    expect(result.ok).toBe(true);
    const res = result.result as {
      format: string;
      language: string;
      base64: string;
      metadata: { lineCount: number };
    };
    expect(res.format).toBe("code");
    expect(res.language).toBe("python");
    expect(res.metadata.lineCount).toBe(3);
    // Decode + verify in the browser too.
    const decoded = await page.evaluate((base64) => atob(base64), res.base64);
    expect(decoded).toBe("def add(a, b):\n    return a + b\n");
  });
});

// ---------------------------------------------------------------------------
// 4. Data analysis
// ---------------------------------------------------------------------------

test.describe("cognitive capabilities — data analysis", () => {
  test("E09 data_analysis.describe_dataset computes per-column stats", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "data_analysis.describe_dataset", {
      headers: ["price", "qty", "region"],
      rows: [
        [10, 5, "north"],
        [20, 3, "south"],
        [30, 7, "north"],
        [40, 2, "east"],
      ],
    });
    expect(result.ok).toBe(true);
    const res = result.result as {
      rowCount: number;
      stats: Record<string, { type: string; mean?: number; distinctCount?: number }>;
    };
    expect(res.rowCount).toBe(4);
    expect(res.stats.price.type).toBe("numeric");
    expect(res.stats.price.mean).toBe(25);
    expect(res.stats.region.type).toBe("string");
    expect(res.stats.region.distinctCount).toBe(3);
  });

  test("E10 data_analysis.describe_dataset parses CSV input", async ({ page }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "data_analysis.describe_dataset", {
      csv: "a,b\n1,2\n3,4\n5,6",
    });
    expect(result.ok).toBe(true);
    const res = result.result as { rowCount: number; columnCount: number };
    expect(res.rowCount).toBe(3);
    expect(res.columnCount).toBe(2);
  });

  test("E11 data_analysis.clean_and_transform deduplicates rows by key", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "data_analysis.clean_and_transform", {
      rows: [
        [1, "alice"],
        [2, "bob"],
        [1, "duplicate"],
      ],
      dedupeKey: 0,
    });
    expect(result.ok).toBe(true);
    const res = result.result as {
      cleanedRowCount: number;
      removedDuplicates: number;
    };
    expect(res.cleanedRowCount).toBe(2);
    expect(res.removedDuplicates).toBe(1);
  });

  test("E12 data_analysis.forecast_series produces horizon + fitted + rmse", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "data_analysis.forecast_series", {
      series: [100, 105, 110, 115, 120, 125, 130, 135],
      horizon: 4,
      alpha: 0.4,
    });
    expect(result.ok).toBe(true);
    const res = result.result as {
      forecast: number[];
      fitted: number[];
      rmse: number;
      horizon: number;
    };
    expect(res.forecast.length).toBe(4);
    expect(res.fitted.length).toBe(8);
    expect(res.horizon).toBe(4);
    expect(typeof res.rmse).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// 5. Format conversion
// ---------------------------------------------------------------------------

test.describe("cognitive capabilities — format conversion", () => {
  test("E13 format_conversion.csv_to_excel_model builds xlsx with SUM formulas", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "format_conversion.csv_to_excel_model", {
      csv: "product,price,qty\napple,10,5\nbanana,2,30\ncherry,5,12",
    });
    expect(result.ok).toBe(true);
    const res = result.result as {
      format: string;
      base64: string;
      metadata: { rowCount: number; sumFormulas: number };
    };
    expect(res.format).toBe("xlsx");
    expect(res.metadata.rowCount).toBe(3);
    expect(res.metadata.sumFormulas).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 6. Research + synthesis + sub-agents
// ---------------------------------------------------------------------------

test.describe("cognitive capabilities — research + synthesis", () => {
  test("E14 research_synthesis.executive_summary selects top sentences", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "research_synthesis.executive_summary", {
      text:
        "The new policy takes effect next month. This document explains each change in detail. " +
        "All employees must review the updated guidelines before November. " +
        "Questions should be directed to the HR team. We appreciate your cooperation.",
      maxSentences: 2,
    });
    expect(result.ok).toBe(true);
    const res = result.result as {
      summary: string;
      selectedCount: number;
      totalSentences: number;
    };
    expect(res.summary.length).toBeGreaterThan(0);
    expect(res.selectedCount).toBeLessThanOrEqual(2);
    expect(res.totalSentences).toBeGreaterThanOrEqual(3);
  });

  test("E15 sub_agents.decompose_task splits task into ordered subtasks", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "sub_agents.decompose_task", {
      task:
        "1. Research competitors. " +
        "2. Draft product spec. " +
        "3. Review with team. " +
        "4. Build MVP.",
    });
    expect(result.ok).toBe(true);
    const res = result.result as {
      subtasks: Array<{ id: string; dependsOn: string[] }>;
      count: number;
    };
    expect(res.count).toBeGreaterThanOrEqual(3);
    expect(res.subtasks[0].dependsOn).toEqual([]);
    expect(res.subtasks[1].dependsOn).toEqual([res.subtasks[0].id]);
  });
});

// ---------------------------------------------------------------------------
// 7. Connectors + plugins
// ---------------------------------------------------------------------------

test.describe("cognitive capabilities — connectors + plugins", () => {
  test("E16 connectors.list_available returns registered connectors", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "connectors.list_available");
    expect(result.ok).toBe(true);
    const res = result.result as {
      connectors: Array<{ id: string; name: string; status: string }>;
      count: number;
      availableCount: number;
    };
    expect(res.count).toBeGreaterThanOrEqual(8);
    expect(res.availableCount).toBeGreaterThanOrEqual(1);
    const ids = res.connectors.map((c) => c.id);
    expect(ids).toContain("gmail");
    expect(ids).toContain("slack");
    expect(ids).toContain("github");
  });

  test("E17 plugins.list_marketplace returns the plugin list", async ({ page }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "plugins.list_marketplace");
    expect(result.ok).toBe(true);
    const res = result.result as { plugins: Array<{ id: string }>; count: number };
    expect(res.count).toBeGreaterThanOrEqual(5);
    const ids = res.plugins.map((p) => p.id);
    expect(ids).toContain("skills.xlsx");
    expect(ids).toContain("skills.pdf");
  });
});

// ---------------------------------------------------------------------------
// 8. File management
// ---------------------------------------------------------------------------

test.describe("cognitive capabilities — file management", () => {
  test("E18 file_management.bulk_rename applies patterns with placeholders", async ({
    page,
  }) => {
    await openHarness(page);
    // bulk_rename has requiresApproval: true — first invocation
    // mints a challenge token, second invocation with the token
    // actually runs. Verify the two-phase handshake works
    // end-to-end in a real browser.
    const challenge = await invokeInBrowser(page, "file_management.bulk_rename", {
      files: ["notes.txt"],
      pattern: "x",
    });
    expect(challenge.ok).toBe(false);
    expect(challenge.errorCode).toBe("approval_required");
    expect(challenge.approvalChallengeToken).toBeDefined();

    const result = await invokeInBrowser(
      page,
      "file_management.bulk_rename",
      {
        files: ["notes.txt", "draft.md", "slides.pptx"],
        pattern: "{date}_{index:03d}_{original}",
        date: "2026-04-11",
      },
      "harness",
      challenge.approvalChallengeToken,
    );
    if (!result.ok) {
      throw new Error(
        `bulk_rename failed: code=${result.errorCode} message=${result.error}`,
      );
    }
    const res = result.result as {
      renamed: Array<{ original: string; renamed: string }>;
      count: number;
    };
    expect(res.count).toBe(3);
    expect(res.renamed[0].renamed).toBe("2026-04-11_001_notes.txt");
    expect(res.renamed[2].renamed).toBe("2026-04-11_003_slides.pptx");
  });

  test("E19 file_management.organize_folder groups files by type", async ({
    page,
  }) => {
    await openHarness(page);
    // Same two-phase approval handshake as E18.
    const challenge = await invokeInBrowser(
      page,
      "file_management.organize_folder",
      { files: [{ name: "report.pdf", type: "documents" }] },
    );
    expect(challenge.ok).toBe(false);
    expect(challenge.errorCode).toBe("approval_required");

    const result = await invokeInBrowser(
      page,
      "file_management.organize_folder",
      {
        files: [
          { name: "report.pdf", type: "documents" },
          { name: "photo.jpg", type: "images" },
          { name: "chart.png", type: "images" },
          { name: "memo.docx", type: "documents" },
        ],
      },
      "harness",
      challenge.approvalChallengeToken,
    );
    expect(result.ok).toBe(true);
    const res = result.result as {
      plan: Record<string, string[]>;
      folderCount: number;
      fileCount: number;
    };
    expect(res.fileCount).toBe(4);
    expect(res.folderCount).toBe(2);
    expect(res.plan.documents).toContain("report.pdf");
    expect(res.plan.images).toContain("photo.jpg");
  });
});

// ---------------------------------------------------------------------------
// 9. Scheduled tasks + projects (stateful round-trip)
// ---------------------------------------------------------------------------

test.describe("cognitive capabilities — state round-trips", () => {
  test("E20 scheduled_tasks create + list sees the new task", async ({ page }) => {
    await openHarness(page);
    const userId = "e2e-alice";
    const created = await invokeInBrowser(
      page,
      "scheduled_tasks.create_recurring",
      { name: "morning digest", cadence: "daily" },
      userId,
    );
    expect(created.ok).toBe(true);
    const createdResult = created.result as { id: string; cadence: string };
    expect(createdResult.id).toMatch(/^sched_/);
    expect(createdResult.cadence).toBe("daily");

    const listed = await invokeInBrowser(
      page,
      "scheduled_tasks.list_user_schedules",
      {},
      userId,
    );
    expect(listed.ok).toBe(true);
    const listedResult = listed.result as {
      tasks: Array<{ id: string; name: string }>;
      count: number;
    };
    expect(listedResult.count).toBe(1);
    expect(listedResult.tasks[0].name).toBe("morning digest");
  });

  test("E21 projects create + list sees the new project", async ({ page }) => {
    await openHarness(page);
    const userId = "e2e-bob";
    await invokeInBrowser(
      page,
      "projects.create_workspace",
      { name: "Q4 Launch", description: "Launch prep for Q4" },
      userId,
    );
    const listed = await invokeInBrowser(
      page,
      "projects.list_my_projects",
      {},
      userId,
    );
    expect(listed.ok).toBe(true);
    const res = listed.result as {
      projects: Array<{ name: string }>;
      count: number;
    };
    expect(res.count).toBe(1);
    expect(res.projects[0].name).toBe("Q4 Launch");
  });
});

// ---------------------------------------------------------------------------
// 10. Governance + enterprise
// ---------------------------------------------------------------------------

test.describe("cognitive capabilities — governance + enterprise", () => {
  test("E22 enterprise.rbac_check allows admin + denies editor for destructive action", async ({
    page,
  }) => {
    await openHarness(page);
    const admin = await invokeInBrowser(page, "enterprise.rbac_check", {
      userId: "someone",
      action: "delete_project",
      role: "admin",
    });
    expect(admin.ok).toBe(true);
    expect((admin.result as { allowed: boolean }).allowed).toBe(true);

    const editor = await invokeInBrowser(page, "enterprise.rbac_check", {
      userId: "someone",
      action: "delete_project",
      role: "editor",
    });
    expect(editor.ok).toBe(true);
    expect((editor.result as { allowed: boolean }).allowed).toBe(false);
  });

  test("E23 security_governance.audit_recent_actions returns a shape", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(
      page,
      "security_governance.audit_recent_actions",
      { hours: 24 },
    );
    expect(result.ok).toBe(true);
    const res = result.result as {
      windowHours: number;
      summary: { totalActions: number };
    };
    expect(res.windowHours).toBe(24);
    expect(typeof res.summary.totalActions).toBe("number");
  });

  test("E24 enterprise.usage_analytics returns placeholder shape", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "enterprise.usage_analytics");
    expect(result.ok).toBe(true);
    const res = result.result as {
      period: string;
      totalRequests: number;
    };
    expect(res.period).toBeDefined();
    expect(typeof res.totalRequests).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// 11. Dispatch mobile + error paths
// ---------------------------------------------------------------------------

test.describe("cognitive capabilities — dispatch + error paths", () => {
  test("E25 dispatch_mobile.queue_task stores a task with priority", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "dispatch_mobile.queue_task", {
      description: "Run weekly metrics report",
      priority: "high",
    });
    expect(result.ok).toBe(true);
    const res = result.result as { id: string; priority: string };
    expect(res.id).toMatch(/^disp_/);
    expect(res.priority).toBe("high");
  });

  test("E26 unknown capability returns structured unknown_capability", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "ghost.nothing", {});
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("unknown_capability");
  });

  test("E27 stub capability returns not_implemented", async ({ page }) => {
    await openHarness(page);
    // `computer_use.open_application` is deliberately NOT promoted
    // in the handler map — it stays as a stub to verify the
    // not_implemented path.
    const result = await invokeInBrowser(
      page,
      "computer_use.open_application",
      { app: "Safari" },
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("not_implemented");
    expect(result.category).toBe("computer_use");
  });

  test("E28 run record for the invocation is persistable", async ({ page }) => {
    await openHarness(page);
    const userId = "e2e-persist-user";
    const invoked = await invokeInBrowser(
      page,
      "availability.echo",
      { persisted: true },
      userId,
    );
    expect(invoked.ok).toBe(true);
    // Fetch /users/:userId/runs to verify the capability invocation
    // landed in the in-memory repo.
    const runs = (await page.evaluate(async (u) => {
      const r = await fetch(`/api/cognitive/users/${u}/runs?limit=5`);
      return (await r.json()) as {
        count: number;
        runs: Array<{ providerName: string; ok: boolean }>;
      };
    }, userId)) as { count: number; runs: Array<{ providerName: string; ok: boolean }> };
    expect(runs.count).toBeGreaterThanOrEqual(1);
    const hit = runs.runs.find(
      (r) => r.providerName === "capability:availability.echo",
    );
    expect(hit).toBeDefined();
    expect(hit?.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. Additional functional scenarios per capability (Turn K)
// ---------------------------------------------------------------------------

test.describe("cognitive capabilities — Turn K additional scenarios", () => {
  test("E29 create_excel_workbook: multi-sheet + totalRows matches sum", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "file_generation.create_excel_workbook", {
      sheets: [
        { name: "North", headers: ["rep", "sales"], rows: [["A", 1], ["B", 2]] },
        { name: "South", headers: ["rep", "sales"], rows: [["C", 3]] },
      ],
    });
    expect(result.ok).toBe(true);
    const res = result.result as {
      metadata: { sheetCount: number; sheetNames: string[]; totalRows: number };
    };
    expect(res.metadata.sheetCount).toBe(2);
    expect(res.metadata.sheetNames).toEqual(["North", "South"]);
    expect(res.metadata.totalRows).toBe(3);
  });

  test("E30 create_excel_workbook: empty sheets array returns handler_threw", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(
      page,
      "file_generation.create_excel_workbook",
      { sheets: [] },
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("handler_threw");
  });

  test("E31 create_word_document: long document with 15 sections", async ({
    page,
  }) => {
    await openHarness(page);
    const sections = Array.from({ length: 15 }, (_, i) => ({
      heading: `Chapter ${i + 1}`,
      paragraphs: [`This is chapter ${i + 1} content.`],
    }));
    const result = await invokeInBrowser(page, "file_generation.create_word_document", {
      title: "Long Book",
      sections,
    });
    expect(result.ok).toBe(true);
    const res = result.result as { metadata: { sectionCount: number; paragraphCount: number } };
    expect(res.metadata.sectionCount).toBe(15);
    expect(res.metadata.paragraphCount).toBe(15);
  });

  test("E32 create_pdf: single-line body still valid", async ({ page }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "file_generation.create_pdf", {
      title: "One-liner",
      body: ["Just this line."],
    });
    expect(result.ok).toBe(true);
    const res = result.result as { sizeBytes: number; base64: string };
    expect(res.sizeBytes).toBeGreaterThan(500);
  });

  test("E33 create_powerpoint: slide without bullets still renders", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "file_generation.create_powerpoint", {
      title: "Minimal",
      slides: [{ title: "Only a title" }],
    });
    expect(result.ok).toBe(true);
    const res = result.result as { metadata: { slideCount: number; bulletCount: number } };
    expect(res.metadata.slideCount).toBe(2);
    expect(res.metadata.bulletCount).toBe(0);
  });

  test("E34 create_code_file: unicode source round-trips through base64", async ({
    page,
  }) => {
    await openHarness(page);
    const source = "const saludo = '¡Hola mundo! 🌍';";
    const result = await invokeInBrowser(page, "file_generation.create_code_file", {
      language: "ts",
      filename: "unicode.ts",
      source,
    });
    expect(result.ok).toBe(true);
    const res = result.result as { base64: string };
    // Decode using TextDecoder in the browser for full unicode fidelity.
    const decoded = await page.evaluate(async (base64) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder("utf-8").decode(bytes);
    }, res.base64);
    expect(decoded).toBe(source);
  });

  test("E35 describe_dataset: numeric column statistics are mathematically correct", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "data_analysis.describe_dataset", {
      headers: ["x"],
      rows: [[2], [4], [4], [4], [5], [5], [7], [9]],
    });
    expect(result.ok).toBe(true);
    const stats = (result.result as {
      stats: Record<string, { mean: number; min: number; max: number; stddev: number }>;
    }).stats.x;
    expect(stats.mean).toBe(5); // (2+4+4+4+5+5+7+9)/8 = 5
    expect(stats.min).toBe(2);
    expect(stats.max).toBe(9);
    expect(stats.stddev).toBeCloseTo(2, 1);
  });

  test("E36 describe_dataset: CSV with trailing newline still parses", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "data_analysis.describe_dataset", {
      csv: "a,b\n1,2\n3,4\n5,6\n",
    });
    expect(result.ok).toBe(true);
    expect((result.result as { rowCount: number }).rowCount).toBe(3);
  });

  test("E37 clean_and_transform: normalizes empty strings to null", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "data_analysis.clean_and_transform", {
      rows: [
        [1, ""],
        [2, "bob"],
      ],
    });
    expect(result.ok).toBe(true);
    const res = result.result as { rows: unknown[][]; normalizedNulls: number };
    expect(res.normalizedNulls).toBeGreaterThan(0);
    expect(res.rows[0][1]).toBeNull();
  });

  test("E38 forecast_series: alpha=1 makes forecast equal last observation", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "data_analysis.forecast_series", {
      series: [10, 20, 30, 40],
      horizon: 2,
      alpha: 1,
    });
    expect(result.ok).toBe(true);
    const res = result.result as { pointForecast: number; forecast: number[] };
    expect(res.pointForecast).toBe(40);
    expect(res.forecast).toEqual([40, 40]);
  });

  test("E39 forecast_series: horizon clamps to 365", async ({ page }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "data_analysis.forecast_series", {
      series: [1, 2, 3],
      horizon: 10_000,
    });
    expect(result.ok).toBe(true);
    const res = result.result as { horizon: number; forecast: number[] };
    expect(res.horizon).toBe(365);
    expect(res.forecast.length).toBe(365);
  });

  test("E40 csv_to_excel_model: string-only CSV produces zero sum formulas", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "format_conversion.csv_to_excel_model", {
      csv: "name,city\nalice,NYC\nbob,LA",
    });
    expect(result.ok).toBe(true);
    const res = result.result as { metadata: { sumFormulas: number; rowCount: number } };
    expect(res.metadata.sumFormulas).toBe(0);
    expect(res.metadata.rowCount).toBe(2);
  });

  test("E41 executive_summary: maxSentences clamps to 20", async ({ page }) => {
    await openHarness(page);
    const longText = Array.from({ length: 50 }, (_, i) => `Sentence ${i + 1}.`).join(" ");
    const result = await invokeInBrowser(page, "research_synthesis.executive_summary", {
      text: longText,
      maxSentences: 500,
    });
    expect(result.ok).toBe(true);
    const res = result.result as { selectedCount: number };
    expect(res.selectedCount).toBeLessThanOrEqual(20);
  });

  test("E42 decompose_task: bullet list is also decomposed", async ({ page }) => {
    await openHarness(page);
    const result = await invokeInBrowser(page, "sub_agents.decompose_task", {
      task: "- Gather data\n- Clean dataset\n- Train model\n- Evaluate",
    });
    expect(result.ok).toBe(true);
    expect((result.result as { count: number }).count).toBeGreaterThanOrEqual(3);
  });

  test("E43 rbac_check: viewer can read, cannot write", async ({ page }) => {
    await openHarness(page);
    const read = await invokeInBrowser(page, "enterprise.rbac_check", {
      userId: "u",
      action: "view_profile",
      role: "viewer",
    });
    expect(read.ok).toBe(true);
    expect((read.result as { allowed: boolean }).allowed).toBe(true);

    const write = await invokeInBrowser(page, "enterprise.rbac_check", {
      userId: "u",
      action: "create_resource",
      role: "viewer",
    });
    expect(write.ok).toBe(true);
    expect((write.result as { allowed: boolean }).allowed).toBe(false);
  });

  test("E44 state isolation: two users don't see each other's projects", async ({
    page,
  }) => {
    await openHarness(page);
    // Create one project per user.
    await invokeInBrowser(page, "projects.create_workspace", { name: "alice-proj" }, "iso-alice");
    await invokeInBrowser(page, "projects.create_workspace", { name: "bob-proj" }, "iso-bob");

    const aliceList = await invokeInBrowser(page, "projects.list_my_projects", {}, "iso-alice");
    const bobList = await invokeInBrowser(page, "projects.list_my_projects", {}, "iso-bob");

    const aliceProjects = (aliceList.result as { projects: Array<{ name: string }> }).projects;
    const bobProjects = (bobList.result as { projects: Array<{ name: string }> }).projects;

    expect(aliceProjects.map((p) => p.name)).toEqual(["alice-proj"]);
    expect(bobProjects.map((p) => p.name)).toEqual(["bob-proj"]);
  });

  test("E45 state isolation: two users don't see each other's scheduled tasks", async ({
    page,
  }) => {
    await openHarness(page);
    await invokeInBrowser(
      page,
      "scheduled_tasks.create_recurring",
      { name: "alice-task", cadence: "daily" },
      "iso-alice2",
    );
    await invokeInBrowser(
      page,
      "scheduled_tasks.create_recurring",
      { name: "bob-task", cadence: "weekly" },
      "iso-bob2",
    );

    const aliceList = await invokeInBrowser(
      page,
      "scheduled_tasks.list_user_schedules",
      {},
      "iso-alice2",
    );
    const bobList = await invokeInBrowser(
      page,
      "scheduled_tasks.list_user_schedules",
      {},
      "iso-bob2",
    );

    expect((aliceList.result as { count: number }).count).toBe(1);
    expect((bobList.result as { count: number }).count).toBe(1);
    const aliceNames = (aliceList.result as { tasks: Array<{ name: string }> }).tasks.map(
      (t) => t.name,
    );
    expect(aliceNames).toEqual(["alice-task"]);
  });

  test("E46 bulk_rename: plain {original} pattern keeps filename", async ({
    page,
  }) => {
    await openHarness(page);
    // approval challenge first
    const challenge = await invokeInBrowser(page, "file_management.bulk_rename", {
      files: ["hello.txt"],
      pattern: "{original}",
    });
    expect(challenge.errorCode).toBe("approval_required");

    const result = await invokeInBrowser(
      page,
      "file_management.bulk_rename",
      { files: ["hello.txt"], pattern: "{original}" },
      "harness",
      challenge.approvalChallengeToken,
    );
    expect(result.ok).toBe(true);
    const res = result.result as { renamed: Array<{ renamed: string }> };
    expect(res.renamed[0].renamed).toBe("hello.txt");
  });

  test("E47 organize_folder: files without type land in 'other' bucket", async ({
    page,
  }) => {
    await openHarness(page);
    const challenge = await invokeInBrowser(
      page,
      "file_management.organize_folder",
      { files: [{ name: "a" }] },
    );
    expect(challenge.errorCode).toBe("approval_required");

    const result = await invokeInBrowser(
      page,
      "file_management.organize_folder",
      { files: [{ name: "a" }, { name: "b" }] },
      "harness",
      challenge.approvalChallengeToken,
    );
    expect(result.ok).toBe(true);
    const res = result.result as { plan: Record<string, string[]> };
    expect(res.plan.other.length).toBe(2);
  });

  test("E48 invalid args (array) returns invalid_args code", async ({
    page,
  }) => {
    await openHarness(page);
    // Invoke with args=[] which the registry flags as invalid_args.
    // Using an array (not null) because the route coerces null via
    // `args ?? {}` but passes arrays straight through to the
    // registry's shape check.
    const result = await page.evaluate(async () => {
      const res = await fetch(
        "/api/cognitive/capabilities/availability.echo/invoke",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: "u", args: [] }),
        },
      );
      return (await res.json()) as {
        ok: boolean;
        errorCode?: string;
      };
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("invalid_args");
  });

  test("E49 concurrent invocations produce distinct run records", async ({
    page,
  }) => {
    await openHarness(page);
    const userId = "concurrent-test-user";
    // Fire 10 concurrent invokes from the browser.
    const results = await page.evaluate(async (u) => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        const w = window as unknown as {
          invokeCapability: (
            id: string,
            args: Record<string, unknown>,
            userId: string,
            approvalToken?: string,
          ) => Promise<{ ok: boolean }>;
        };
        promises.push(w.invokeCapability("availability.echo", { i }, u, undefined));
      }
      return Promise.all(promises);
    }, userId);
    expect(results.length).toBe(10);
    expect(results.every((r) => r.ok)).toBe(true);
    // Verify persistence.
    const runs = (await page.evaluate(async (u) => {
      const r = await fetch(`/api/cognitive/users/${u}/runs?limit=20`);
      return (await r.json()) as { count: number };
    }, userId)) as { count: number };
    expect(runs.count).toBe(10);
  });

  test("E50 listCapabilities exposes availableCount ≥ 20", async ({ page }) => {
    await openHarness(page);
    const catalog = (await page.evaluate(async () => {
      const w = window as unknown as {
        listCapabilities: () => Promise<unknown>;
      };
      return (await w.listCapabilities()) as {
        totalCount: number;
        availableCount: number;
      };
    })) as { totalCount: number; availableCount: number };
    expect(catalog.totalCount).toBeGreaterThanOrEqual(30);
    expect(catalog.availableCount).toBeGreaterThanOrEqual(20);
  });
});
