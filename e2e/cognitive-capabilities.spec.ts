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
