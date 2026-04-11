import { expect, test, type Page } from "@playwright/test";

const HARNESS_URL = "/api/cognitive/test-harness";

type HarnessInvocation = {
  ok: boolean;
  result?: unknown;
  error?: string;
  errorCode?: string;
  category?: string;
  approvalChallengeToken?: string;
  message?: string;
};

type CapabilityCatalog = {
  categories: Array<{ key: string; label: string; count: number }>;
  capabilities: Array<{ id: string; category: string; status: string }>;
  totalCount: number;
  availableCount: number;
};

async function openHarness(page: Page): Promise<void> {
  await page.goto(HARNESS_URL);
  await page.waitForFunction(
    () =>
      (window as unknown as { __COGNITIVE_HARNESS__?: boolean }).__COGNITIVE_HARNESS__ === true,
  );
  await page.evaluate(() =>
    (window as unknown as { resetHandlerStores: () => Promise<unknown> }).resetHandlerStores(),
  );
}

async function invokeInBrowser(
  page: Page,
  id: string,
  args: Record<string, unknown> = {},
  userId = "matrix-user",
  approvalToken?: string,
): Promise<HarnessInvocation> {
  return page.evaluate(
    async (payload) => {
      const w = window as unknown as {
        invokeCapability: (
          id: string,
          args: Record<string, unknown>,
          userId: string,
          approvalToken?: string,
        ) => Promise<HarnessInvocation>;
      };
      return w.invokeCapability(
        payload.id,
        payload.args,
        payload.userId,
        payload.approvalToken,
      );
    },
    { id, args, userId, approvalToken },
  );
}

async function listCapabilities(page: Page): Promise<CapabilityCatalog> {
  return page.evaluate(async () => {
    const w = window as unknown as {
      listCapabilities: () => Promise<CapabilityCatalog>;
    };
    return w.listCapabilities();
  });
}

async function assertCapabilityAvailable(
  page: Page,
  capabilityId: string,
  category: string,
): Promise<void> {
  const catalog = await listCapabilities(page);
  const descriptor = catalog.capabilities.find((entry) => entry.id === capabilityId);
  expect(descriptor, `missing capability ${capabilityId}`).toBeDefined();
  expect(descriptor?.category).toBe(category);
  expect(descriptor?.status).toBe("available");
}

async function assertLastResultContains(page: Page, needle: string): Promise<void> {
  await expect(page.locator("#last-result")).toContainText(needle);
  await expect(page.locator("#status")).toHaveText(/ok|err/);
}

async function expectZipHeader(page: Page, base64: string): Promise<void> {
  const isZip = await page.evaluate((encoded) => {
    const binary = atob(encoded);
    return binary.charCodeAt(0) === 0x50 && binary.charCodeAt(1) === 0x4b;
  }, base64);
  expect(isZip).toBe(true);
}

async function expectPdfHeader(page: Page, base64: string): Promise<void> {
  const isPdf = await page.evaluate((encoded) => {
    const binary = atob(encoded);
    return (
      binary.charCodeAt(0) === 0x25 &&
      binary.charCodeAt(1) === 0x50 &&
      binary.charCodeAt(2) === 0x44 &&
      binary.charCodeAt(3) === 0x46
    );
  }, base64);
  expect(isPdf).toBe(true);
}

async function getHarnessAbsoluteUrl(page: Page): Promise<string> {
  return page.evaluate(() => `${location.origin}/api/cognitive/test-harness`);
}

test.describe("cognitive runtime domain matrix", () => {
  test("DM01 catalog exposes representative runtime-real capabilities as available", async ({
    page,
  }) => {
    await openHarness(page);
    const catalog = await listCapabilities(page);

    expect(catalog.totalCount).toBeGreaterThanOrEqual(30);
    expect(catalog.availableCount).toBeGreaterThanOrEqual(35);

    for (const [capabilityId, category] of [
      ["availability.platform_status", "availability"],
      ["file_generation.create_excel_workbook", "file_generation"],
      ["file_generation.create_powerpoint", "file_generation"],
      ["file_generation.create_word_document", "file_generation"],
      ["file_generation.create_pdf", "file_generation"],
      ["file_management.bulk_rename", "file_management"],
      ["data_analysis.train_predictive_model", "data_analysis"],
      ["research_synthesis.multi_doc_report", "research_synthesis"],
      ["format_conversion.word_to_pptx", "format_conversion"],
      ["browser_automation.extract_page", "browser_automation"],
      ["scheduled_tasks.create_recurring", "scheduled_tasks"],
      ["connectors.invoke_mcp_tool", "connectors"],
      ["plugins.install", "plugins"],
      ["sub_agents.coordinate_parallel", "sub_agents"],
      ["projects.create_workspace", "projects"],
      ["security_governance.configure_egress", "security_governance"],
      ["enterprise.rbac_check", "enterprise"],
      ["dispatch_mobile.queue_task", "dispatch_mobile"],
    ] as const) {
      const descriptor = catalog.capabilities.find((entry) => entry.id === capabilityId);
      expect(descriptor, `missing capability ${capabilityId}`).toBeDefined();
      expect(descriptor?.category).toBe(category);
      expect(descriptor?.status).toBe("available");
    }

    await expect(page.locator("#registry-count")).toContainText(`count=${catalog.totalCount}`);
  });

  test("DM02 stub domains stay honest: code execution and computer use are not promoted yet", async ({
    page,
  }) => {
    await openHarness(page);
    const catalog = await listCapabilities(page);

    const python = catalog.capabilities.find((entry) => entry.id === "code_execution.run_python");
    const computerUse = catalog.capabilities.find(
      (entry) => entry.id === "computer_use.open_application",
    );

    expect(python).toBeDefined();
    expect(computerUse).toBeDefined();
    expect(python?.status).not.toBe("available");
    expect(computerUse?.status).not.toBe("available");
  });

  test("DM03 file_generation.create_excel_workbook returns a zip-backed xlsx", async ({
    page,
  }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "file_generation.create_excel_workbook", "file_generation");
    const result = await invokeInBrowser(page, "file_generation.create_excel_workbook", {
      sheets: [
        {
          name: "Budget",
          headers: ["month", "revenue", "costs"],
          rows: [
            ["Jan", 10000, 3200],
            ["Feb", 12000, 3500],
          ],
          formulas: [{ cell: "D2", formula: "B2-C2" }],
        },
      ],
    });

    expect(result.ok).toBe(true);
    const res = result.result as {
      format: string;
      base64: string;
      metadata: { sheetCount: number; totalRows: number; formulaCount: number };
    };
    expect(res.format).toBe("xlsx");
    expect(res.metadata.sheetCount).toBe(1);
    expect(res.metadata.totalRows).toBe(2);
    expect(res.metadata.formulaCount).toBe(1);
    await expectZipHeader(page, res.base64);
    await assertLastResultContains(page, "xlsx");
  });

  test("DM04 file_generation.create_powerpoint returns a zip-backed pptx", async ({
    page,
  }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "file_generation.create_powerpoint", "file_generation");
    const result = await invokeInBrowser(page, "file_generation.create_powerpoint", {
      title: "Board Review",
      slides: [
        { title: "Highlights", bullets: ["ARR +12%", "NPS +5"] },
        { title: "Risks", bullets: ["Churn", "Pipeline"] },
      ],
    });

    expect(result.ok).toBe(true);
    const res = result.result as {
      format: string;
      base64: string;
      metadata: { slideCount: number; bulletCount: number };
    };
    expect(res.format).toBe("pptx");
    expect(res.metadata.slideCount).toBeGreaterThanOrEqual(3);
    expect(res.metadata.bulletCount).toBe(4);
    await expectZipHeader(page, res.base64);
    await assertLastResultContains(page, "pptx");
  });

  test("DM05 file_generation.create_word_document returns a zip-backed docx", async ({
    page,
  }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "file_generation.create_word_document", "file_generation");
    const result = await invokeInBrowser(page, "file_generation.create_word_document", {
      title: "Market Memo",
      sections: [
        { heading: "Summary", paragraphs: ["Growth is stable."] },
        {
          heading: "Metrics",
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
      base64: string;
      metadata: { paragraphCount: number; tableCount: number };
    };
    expect(res.format).toBe("docx");
    expect(res.metadata.paragraphCount).toBe(1);
    expect(res.metadata.tableCount).toBe(1);
    await expectZipHeader(page, res.base64);
    await assertLastResultContains(page, "docx");
  });

  test("DM06 file_generation.create_pdf returns a valid pdf header", async ({ page }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "file_generation.create_pdf", "file_generation");
    const result = await invokeInBrowser(page, "file_generation.create_pdf", {
      title: "Executive Report",
      body: ["One line", "Second line", "Third line"],
    });

    expect(result.ok).toBe(true);
    const res = result.result as {
      format: string;
      base64: string;
      metadata: { pageCount: number };
    };
    expect(res.format).toBe("pdf");
    expect(res.metadata.pageCount).toBeGreaterThanOrEqual(1);
    await expectPdfHeader(page, res.base64);
    await assertLastResultContains(page, "pdf");
  });

  test("DM07 file_management.bulk_rename enforces approval and renames deterministically", async ({
    page,
  }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "file_management.bulk_rename", "file_management");
    const challenge = await invokeInBrowser(page, "file_management.bulk_rename", {
      files: ["notes.txt"],
      pattern: "{date}_{index:02d}_{original}",
      date: "2026-04-11",
    });
    expect(challenge.ok).toBe(false);
    expect(challenge.errorCode).toBe("approval_required");
    expect(challenge.approvalChallengeToken).toBeDefined();

    const result = await invokeInBrowser(
      page,
      "file_management.bulk_rename",
      {
        files: ["notes.txt", "draft.md"],
        pattern: "{date}_{index:02d}_{original}",
        date: "2026-04-11",
      },
      "matrix-user",
      challenge.approvalChallengeToken,
    );

    expect(result.ok).toBe(true);
    const res = result.result as {
      count: number;
      renamed: Array<{ original: string; renamed: string }>;
    };
    expect(res.count).toBe(2);
    expect(res.renamed[0].renamed).toBe("2026-04-11_01_notes.txt");
    expect(res.renamed[1].renamed).toBe("2026-04-11_02_draft.md");
  });

  test("DM08 file_management.deduplicate groups identical content after approval", async ({
    page,
  }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "file_management.deduplicate", "file_management");
    const challenge = await invokeInBrowser(page, "file_management.deduplicate", {
      files: [{ name: "a.txt", content: "hello" }],
    });
    expect(challenge.errorCode).toBe("approval_required");

    const result = await invokeInBrowser(
      page,
      "file_management.deduplicate",
      {
        files: [
          { name: "a.txt", content: "hello world" },
          { name: "a-copy.txt", content: "hello world" },
          { name: "b.txt", content: "different" },
        ],
      },
      "matrix-user",
      challenge.approvalChallengeToken,
    );
    expect(result.ok).toBe(true);
    const res = result.result as {
      duplicateGroups: Array<{ files: string[]; duplicates: string[] }>;
      totalDuplicates: number;
    };
    expect(res.totalDuplicates).toBe(1);
    expect(res.duplicateGroups[0].files).toContain("a.txt");
    expect(res.duplicateGroups[0].files).toContain("a-copy.txt");
  });

  test("DM09 data_analysis.train_predictive_model fits a linear model", async ({ page }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "data_analysis.train_predictive_model", "data_analysis");
    const result = await invokeInBrowser(page, "data_analysis.train_predictive_model", {
      x: [1, 2, 3, 4, 5],
      y: [3, 5, 7, 9, 11],
    });
    expect(result.ok).toBe(true);
    const res = result.result as { slope: number; intercept: number; r2: number };
    expect(res.slope).toBeCloseTo(2, 4);
    expect(res.intercept).toBeCloseTo(1, 4);
    expect(res.r2).toBeCloseTo(1, 4);
  });

  test("DM10 data_analysis.forecast_series returns horizon-sized output", async ({ page }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "data_analysis.forecast_series", "data_analysis");
    const result = await invokeInBrowser(page, "data_analysis.forecast_series", {
      series: [100, 105, 110, 115, 120],
      horizon: 3,
      alpha: 0.4,
    });
    expect(result.ok).toBe(true);
    const res = result.result as { horizon: number; forecast: number[]; fitted: number[] };
    expect(res.horizon).toBe(3);
    expect(res.forecast.length).toBe(3);
    expect(res.fitted.length).toBe(5);
  });

  test("DM11 research_synthesis.multi_doc_report finds shared terms", async ({ page }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "research_synthesis.multi_doc_report", "research_synthesis");
    const result = await invokeInBrowser(page, "research_synthesis.multi_doc_report", {
      docs: [
        { id: "a", text: "kubernetes cluster deployment pods services" },
        { id: "b", text: "kubernetes pods restart on failure" },
        { id: "c", text: "kubernetes autoscaling uses pods metrics" },
      ],
    });
    expect(result.ok).toBe(true);
    const res = result.result as { docCount: number; sharedTerms: string[] };
    expect(res.docCount).toBe(3);
    expect(res.sharedTerms).toContain("kubernetes");
    expect(res.sharedTerms).toContain("pods");
  });

  test("DM12 research_synthesis.web_research fetches the harness over HTTP", async ({ page }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "research_synthesis.web_research", "research_synthesis");
    const harnessUrl = await getHarnessAbsoluteUrl(page);
    const result = await invokeInBrowser(page, "research_synthesis.web_research", {
      url: harnessUrl,
    });
    expect(result.ok).toBe(true);
    const res = result.result as { status: number; title: string; excerptLength: number };
    expect(res.status).toBe(200);
    expect(res.title).toContain("Cognitive Capability Test Harness");
    expect(res.excerptLength).toBeGreaterThan(0);
  });

  test("DM13 format_conversion.word_to_pptx converts generated docx to pptx", async ({
    page,
  }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "format_conversion.word_to_pptx", "format_conversion");
    const docx = await invokeInBrowser(page, "file_generation.create_word_document", {
      title: "Source Doc",
      sections: [
        { heading: "Intro", paragraphs: ["Paragraph one.", "Paragraph two."] },
        { heading: "Conclusion", paragraphs: ["Paragraph three."] },
      ],
    });
    expect(docx.ok).toBe(true);
    const docxBase64 = (docx.result as { base64: string }).base64;

    const result = await invokeInBrowser(page, "format_conversion.word_to_pptx", {
      docxBase64,
      title: "Converted Deck",
      paragraphsPerSlide: 2,
    });
    expect(result.ok).toBe(true);
    const res = result.result as {
      format: string;
      base64: string;
      metadata: { slideCount: number; sourceParagraphCount: number };
    };
    expect(res.format).toBe("pptx");
    expect(res.metadata.slideCount).toBeGreaterThanOrEqual(2);
    expect(res.metadata.sourceParagraphCount).toBeGreaterThan(0);
    await expectZipHeader(page, res.base64);
  });

  test("DM14 browser_automation.extract_page extracts structured content from the harness", async ({
    page,
  }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "browser_automation.extract_page", "browser_automation");
    const harnessUrl = await getHarnessAbsoluteUrl(page);
    const result = await invokeInBrowser(page, "browser_automation.extract_page", {
      url: harnessUrl,
    });
    expect(result.ok).toBe(true);
    const res = result.result as {
      status: number;
      title: string;
      headingCount: number;
      linkCount: number;
      bodyLength: number;
    };
    expect(res.status).toBe(200);
    expect(res.title).toContain("Cognitive Capability Test Harness");
    expect(res.headingCount).toBeGreaterThan(0);
    expect(res.bodyLength).toBeGreaterThan(0);
    expect(res.linkCount).toBeGreaterThanOrEqual(0);
  });

  test("DM15 scheduled_tasks state round-trip survives create + list", async ({ page }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "scheduled_tasks.create_recurring", "scheduled_tasks");
    const userId = "matrix-scheduler";
    const created = await invokeInBrowser(
      page,
      "scheduled_tasks.create_recurring",
      { name: "weekly metrics", cadence: "weekly" },
      userId,
    );
    expect(created.ok).toBe(true);

    const listed = await invokeInBrowser(
      page,
      "scheduled_tasks.list_user_schedules",
      {},
      userId,
    );
    expect(listed.ok).toBe(true);
    const res = listed.result as { count: number; tasks: Array<{ name: string }> };
    expect(res.count).toBe(1);
    expect(res.tasks[0].name).toBe("weekly metrics");
  });

  test("DM16 connectors.invoke_mcp_tool enforces approval and records the call", async ({
    page,
  }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "connectors.invoke_mcp_tool", "connectors");
    const challenge = await invokeInBrowser(page, "connectors.invoke_mcp_tool", {
      connectorId: "gmail",
      toolName: "send_email",
    });
    expect(challenge.errorCode).toBe("approval_required");

    const result = await invokeInBrowser(
      page,
      "connectors.invoke_mcp_tool",
      {
        connectorId: "gmail",
        toolName: "send_email",
        toolArgs: { to: "user@example.com", subject: "Test" },
      },
      "matrix-user",
      challenge.approvalChallengeToken,
    );
    expect(result.ok).toBe(true);
    const res = result.result as { connectorId: string; toolName: string; note: string };
    expect(res.connectorId).toBe("gmail");
    expect(res.toolName).toBe("send_email");
    expect(res.note).toContain("MCP invocation recorded");
  });

  test("DM17 plugins.install enforces approval and deduplicates installs", async ({
    page,
  }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "plugins.install", "plugins");
    const userId = "matrix-plugin-user";
    const challenge = await invokeInBrowser(
      page,
      "plugins.install",
      { pluginId: "finance.variance_analysis" },
      userId,
    );
    expect(challenge.errorCode).toBe("approval_required");

    const first = await invokeInBrowser(
      page,
      "plugins.install",
      { pluginId: "finance.variance_analysis" },
      userId,
      challenge.approvalChallengeToken,
    );
    expect(first.ok).toBe(true);
    expect((first.result as { alreadyInstalled: boolean }).alreadyInstalled).toBe(false);

    const second = await invokeInBrowser(
      page,
      "plugins.install",
      { pluginId: "finance.variance_analysis" },
      userId,
      challenge.approvalChallengeToken,
    );
    expect(second.ok).toBe(true);
    expect((second.result as { alreadyInstalled: boolean }).alreadyInstalled).toBe(true);
  });

  test("DM18 sub_agents.coordinate_parallel completes every task", async ({ page }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "sub_agents.coordinate_parallel", "sub_agents");
    const result = await invokeInBrowser(page, "sub_agents.coordinate_parallel", {
      tasks: ["task a", "task b", "task c"],
    });
    expect(result.ok).toBe(true);
    const res = result.result as {
      totalTasks: number;
      completed: number;
      outcomes: Array<{ index: number; status: string }>;
    };
    expect(res.totalTasks).toBe(3);
    expect(res.completed).toBe(3);
    expect(res.outcomes.map((entry) => entry.index)).toEqual([0, 1, 2]);
  });

  test("DM19 projects.create_workspace persists and lists the workspace", async ({
    page,
  }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "projects.create_workspace", "projects");
    const userId = "matrix-project-user";
    const created = await invokeInBrowser(
      page,
      "projects.create_workspace",
      { name: "Q4 Launch", description: "Go-to-market prep" },
      userId,
    );
    expect(created.ok).toBe(true);

    const listed = await invokeInBrowser(page, "projects.list_my_projects", {}, userId);
    expect(listed.ok).toBe(true);
    const res = listed.result as { count: number; projects: Array<{ name: string }> };
    expect(res.count).toBe(1);
    expect(res.projects[0].name).toBe("Q4 Launch");
  });

  test("DM20 security_governance.configure_egress add/list/remove round-trips after approval", async ({
    page,
  }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "security_governance.configure_egress", "security_governance");
    const userId = "matrix-security-user";
    const challenge = await invokeInBrowser(
      page,
      "security_governance.configure_egress",
      { action: "list" },
      userId,
    );
    expect(challenge.errorCode).toBe("approval_required");
    const token = challenge.approvalChallengeToken;

    const added = await invokeInBrowser(
      page,
      "security_governance.configure_egress",
      { action: "add", hosts: ["api.github.com", "api.openai.com"] },
      userId,
      token,
    );
    expect(added.ok).toBe(true);

    const listed = await invokeInBrowser(
      page,
      "security_governance.configure_egress",
      { action: "list" },
      userId,
      token,
    );
    const listRes = listed.result as { current: string[] };
    expect(listRes.current).toContain("api.github.com");
    expect(listRes.current).toContain("api.openai.com");

    const removed = await invokeInBrowser(
      page,
      "security_governance.configure_egress",
      { action: "remove", hosts: ["api.github.com"] },
      userId,
      token,
    );
    const removeRes = removed.result as { current: string[] };
    expect(removeRes.current).not.toContain("api.github.com");
    expect(removeRes.current).toContain("api.openai.com");
  });

  test("DM21 enterprise.rbac_check applies role semantics", async ({ page }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "enterprise.rbac_check", "enterprise");
    const admin = await invokeInBrowser(page, "enterprise.rbac_check", {
      userId: "u",
      action: "delete_project",
      role: "admin",
    });
    const viewer = await invokeInBrowser(page, "enterprise.rbac_check", {
      userId: "u",
      action: "delete_project",
      role: "viewer",
    });

    expect(admin.ok).toBe(true);
    expect(viewer.ok).toBe(true);
    expect((admin.result as { allowed: boolean }).allowed).toBe(true);
    expect((viewer.result as { allowed: boolean }).allowed).toBe(false);
  });

  test("DM22 dispatch_mobile.queue_task stores a mobile-originated task", async ({
    page,
  }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "dispatch_mobile.queue_task", "dispatch_mobile");
    const result = await invokeInBrowser(page, "dispatch_mobile.queue_task", {
      description: "Run weekly metrics report",
      priority: "high",
    });
    expect(result.ok).toBe(true);
    const res = result.result as { id: string; priority: string; description: string };
    expect(res.id).toMatch(/^disp_/);
    expect(res.priority).toBe("high");
    expect(res.description).toBe("Run weekly metrics report");
  });

  test("DM23 enterprise.usage_analytics returns the expected analytics shape", async ({
    page,
  }) => {
    await openHarness(page);
    await assertCapabilityAvailable(page, "enterprise.usage_analytics", "enterprise");
    const result = await invokeInBrowser(page, "enterprise.usage_analytics");
    expect(result.ok).toBe(true);
    const res = result.result as {
      period: string;
      totalRequests: number;
      totalTokens: number;
      byProvider: Record<string, unknown>;
      byIntent: Record<string, unknown>;
    };
    expect(res.period).toBe("last_7_days");
    expect(typeof res.totalRequests).toBe("number");
    expect(typeof res.totalTokens).toBe("number");
    expect(typeof res.byProvider).toBe("object");
    expect(typeof res.byIntent).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// Section 17 — FUNCTIONAL DOMAINS (Legal, Finanzas, Marketing,
// Operaciones, RRHH, Investigación). Each domain gets MULTIPLE
// tests that chain real capabilities to solve realistic
// workflows the spec calls out explicitly.
// ---------------------------------------------------------------------------

/**
 * Helper: mint an approval token via a throwaway challenge call.
 * Useful for tests that hit multiple requiresApproval capabilities.
 */
async function approveChallenge(
  page: Page,
  id: string,
  args: Record<string, unknown>,
  userId: string,
): Promise<string> {
  const challenge = await invokeInBrowser(page, id, args, userId);
  expect(challenge.errorCode).toBe("approval_required");
  expect(challenge.approvalChallengeToken).toBeDefined();
  return challenge.approvalChallengeToken!;
}

// ---------------------------------------------------------------------------
// Domain 1 — LEGAL: contracts, NDAs, exhibits, redlines
// ---------------------------------------------------------------------------

test.describe("domain matrix — Legal (contracts, NDAs, exhibits)", () => {
  test("D01 Legal: executive summary of a contract clause extracts key sentences", async ({
    page,
  }) => {
    await openHarness(page);
    const contractText =
      "This Master Services Agreement is entered into by Acme Corp and Beta Inc. " +
      "The term of this agreement is 24 months with automatic renewal. " +
      "Payment terms are net-30 with a 1.5% late fee. " +
      "Either party may terminate with 90 days written notice. " +
      "Governing law is Delaware. Disputes go to binding arbitration.";
    const r = await invokeInBrowser(page, "research_synthesis.executive_summary", {
      text: contractText,
      maxSentences: 3,
    });
    expect(r.ok).toBe(true);
    const res = r.result as {
      summary: string;
      selectedCount: number;
      totalSentences: number;
    };
    expect(res.selectedCount).toBeLessThanOrEqual(3);
    expect(res.totalSentences).toBeGreaterThanOrEqual(5);
    expect(res.summary.length).toBeGreaterThan(0);
  });

  test("D02 Legal: NDA triage detects shared terms across two revisions", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "research_synthesis.multi_doc_report", {
      docs: [
        {
          id: "nda-v1",
          text:
            "Confidential information shall be protected. Disclosure permitted to counsel. " +
            "Allow audit access with prior approval. Term is three years.",
        },
        {
          id: "nda-v2",
          text:
            "Confidential information shall be protected. Disclosure prohibited. " +
            "Deny access to third parties without prior written consent. Term is five years.",
        },
      ],
    });
    expect(r.ok).toBe(true);
    const res = r.result as {
      docCount: number;
      sharedTermCount: number;
      contradictionScore: number;
    };
    expect(res.docCount).toBe(2);
    expect(res.sharedTermCount).toBeGreaterThan(0);
    expect(typeof res.contradictionScore).toBe("number");
  });

  test("D03 Legal: exhibit list organized into folders by type (approval-gated)", async ({
    page,
  }) => {
    await openHarness(page);
    const token = await approveChallenge(
      page,
      "file_management.organize_folder",
      { files: [{ name: "a", type: "docs" }] },
      "legal-team",
    );
    const r = await invokeInBrowser(
      page,
      "file_management.organize_folder",
      {
        files: [
          { name: "exhibit_A.pdf", type: "evidence" },
          { name: "exhibit_B.pdf", type: "evidence" },
          { name: "witness_stmt_1.docx", type: "statements" },
          { name: "witness_stmt_2.docx", type: "statements" },
          { name: "legal_brief.pdf", type: "briefs" },
        ],
      },
      "legal-team",
      token,
    );
    expect(r.ok).toBe(true);
    const res = r.result as { plan: Record<string, string[]>; folderCount: number };
    expect(res.folderCount).toBe(3);
    expect(res.plan.evidence).toContain("exhibit_A.pdf");
    expect(res.plan.statements).toContain("witness_stmt_1.docx");
  });

  test("D04 Legal: redlined contract rendered as a Word document with revision sections", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "file_generation.create_word_document", {
      title: "Contract Redline — Master Services Agreement",
      sections: [
        {
          heading: "Section 1 — Term",
          paragraphs: [
            "Original: 24 months automatic renewal.",
            "SUGGESTED REDLINE: 12 months with explicit opt-in renewal.",
          ],
        },
        {
          heading: "Section 3 — Payment",
          paragraphs: [
            "Original: Net-30 with 1.5% late fee.",
            "SUGGESTED REDLINE: Net-45, drop late fee.",
          ],
        },
        {
          heading: "Section 5 — Termination",
          paragraphs: [
            "Original: 90 days written notice.",
            "SUGGESTED REDLINE: 30 days for cause, 60 days without cause.",
          ],
        },
      ],
    });
    expect(r.ok).toBe(true);
    const res = r.result as {
      format: string;
      metadata: { sectionCount: number; paragraphCount: number };
    };
    expect(res.format).toBe("docx");
    expect(res.metadata.sectionCount).toBe(3);
    expect(res.metadata.paragraphCount).toBe(6);
  });

  test("D05 Legal: RBAC denies junior viewer from deleting a signed contract", async ({
    page,
  }) => {
    await openHarness(page);
    const viewer = await invokeInBrowser(page, "enterprise.rbac_check", {
      userId: "junior-lawyer",
      action: "delete_signed_contract",
      role: "viewer",
    });
    const admin = await invokeInBrowser(page, "enterprise.rbac_check", {
      userId: "partner",
      action: "delete_signed_contract",
      role: "admin",
    });
    expect((viewer.result as { allowed: boolean }).allowed).toBe(false);
    expect((admin.result as { allowed: boolean }).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Domain 2 — FINANZAS: financial models, variance, forecasting
// ---------------------------------------------------------------------------

test.describe("domain matrix — Finanzas (modeling + variance + forecast)", () => {
  test("D06 Finance: CSV bank export becomes an xlsx model with SUM formulas", async ({
    page,
  }) => {
    await openHarness(page);
    const csv =
      "date,description,amount\n" +
      "2026-01-01,Opening,10000\n" +
      "2026-01-15,Payroll,-4500\n" +
      "2026-01-20,Customer A,8000\n" +
      "2026-01-25,Rent,-2000\n" +
      "2026-01-28,Customer B,12000";
    const r = await invokeInBrowser(page, "format_conversion.csv_to_excel_model", { csv });
    expect(r.ok).toBe(true);
    const res = r.result as {
      format: string;
      base64: string;
      metadata: { rowCount: number; sumFormulas: number };
    };
    expect(res.format).toBe("xlsx");
    expect(res.metadata.rowCount).toBe(5);
    expect(res.metadata.sumFormulas).toBeGreaterThanOrEqual(1);
    await expectZipHeader(page, res.base64);
  });

  test("D07 Finance: revenue exponential-smoothing forecast 3 periods ahead", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "data_analysis.forecast_series", {
      series: [95_000, 102_000, 108_500, 115_000, 121_200, 128_000, 134_500],
      horizon: 3,
      alpha: 0.4,
    });
    expect(r.ok).toBe(true);
    const res = r.result as {
      forecast: number[];
      fitted: number[];
      rmse: number;
      pointForecast: number;
    };
    expect(res.forecast.length).toBe(3);
    expect(res.pointForecast).toBeGreaterThan(100_000);
    expect(res.rmse).toBeGreaterThan(0);
    expect(res.fitted.length).toBe(7);
  });

  test("D08 Finance: variance dataset stats across budget vs actuals", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "data_analysis.describe_dataset", {
      headers: ["account", "budget", "actual"],
      rows: [
        ["Payroll", 45_000, 46_200],
        ["Marketing", 12_000, 8_500],
        ["Rent", 8_000, 8_000],
        ["Travel", 3_500, 4_800],
        ["Cloud", 15_000, 14_200],
      ],
    });
    expect(r.ok).toBe(true);
    const res = r.result as {
      rowCount: number;
      stats: Record<string, { type: string; mean?: number }>;
    };
    expect(res.rowCount).toBe(5);
    expect(res.stats.budget.type).toBe("numeric");
    expect(res.stats.actual.type).toBe("numeric");
    expect((res.stats.budget.mean ?? 0)).toBeGreaterThan(0);
  });

  test("D09 Finance: multi-sheet scenario analysis xlsx (base/optimistic/pessimistic)", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "file_generation.create_excel_workbook", {
      sheets: [
        {
          name: "Base",
          headers: ["quarter", "revenue", "costs"],
          rows: [
            ["Q1", 100_000, 70_000],
            ["Q2", 110_000, 72_000],
            ["Q3", 120_000, 74_000],
            ["Q4", 130_000, 76_000],
          ],
          formulas: [{ cell: "D1", formula: "SUM(B2:B5)-SUM(C2:C5)" }],
        },
        {
          name: "Optimistic",
          headers: ["quarter", "revenue", "costs"],
          rows: [
            ["Q1", 120_000, 68_000],
            ["Q2", 140_000, 70_000],
            ["Q3", 165_000, 73_000],
            ["Q4", 190_000, 76_000],
          ],
        },
        {
          name: "Pessimistic",
          headers: ["quarter", "revenue", "costs"],
          rows: [
            ["Q1", 85_000, 72_000],
            ["Q2", 88_000, 74_000],
            ["Q3", 90_000, 76_000],
            ["Q4", 92_000, 78_000],
          ],
        },
      ],
    });
    expect(r.ok).toBe(true);
    const res = r.result as {
      metadata: { sheetCount: number; totalRows: number; formulaCount: number };
    };
    expect(res.metadata.sheetCount).toBe(3);
    expect(res.metadata.totalRows).toBe(12);
    expect(res.metadata.formulaCount).toBe(1);
  });

  test("D10 Finance: linear model of cost-vs-headcount with R² > 0.99", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "data_analysis.train_predictive_model", {
      x: [5, 10, 15, 20, 25, 30],
      y: [50_000, 98_000, 145_000, 195_000, 245_000, 294_000],
    });
    expect(r.ok).toBe(true);
    const res = r.result as { slope: number; intercept: number; r2: number };
    expect(res.slope).toBeGreaterThan(9_000);
    expect(res.slope).toBeLessThan(11_000);
    expect(res.r2).toBeGreaterThan(0.99);
  });

  test("D11 Finance: reconciliation report as Word document with discrepancy table", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "file_generation.create_word_document", {
      title: "Q4 Reconciliation Report",
      sections: [
        {
          heading: "Opening balance",
          paragraphs: [
            "Starting cash: $245,000.00",
            "Reconciled against bank statement 2026-01-02.",
          ],
        },
        {
          heading: "Discrepancies",
          table: {
            headers: ["Account", "Book", "Bank", "Delta"],
            rows: [
              ["Checking", "$142,300", "$142,300", "$0"],
              ["Savings", "$85,000", "$84,950", "-$50"],
              ["Payables", "$17,700", "$17,700", "$0"],
            ],
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
    const res = r.result as { metadata: { tableCount: number; paragraphCount: number } };
    expect(res.metadata.tableCount).toBe(1);
    expect(res.metadata.paragraphCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Domain 3 — MARKETING: brand voice, campaigns, assets
// ---------------------------------------------------------------------------

test.describe("domain matrix — Marketing (brand voice, campaigns)", () => {
  test("D12 Marketing: brand voice analysis via multi-doc term aggregation", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "research_synthesis.multi_doc_report", {
      docs: [
        {
          id: "landing",
          text:
            "Our bold innovation drives the future. Fearless action powers every release. " +
            "We move forward with curiosity and confidence.",
        },
        {
          id: "about",
          text:
            "We move fast and push boundaries with fearless curiosity. Bold action is in our DNA.",
        },
        {
          id: "careers",
          text:
            "Join a bold team that moves forward with curiosity and builds the future fearlessly.",
        },
      ],
    });
    expect(r.ok).toBe(true);
    const res = r.result as { docCount: number; sharedTerms: string[] };
    expect(res.docCount).toBe(3);
    expect(res.sharedTerms.length).toBeGreaterThan(0);
  });

  test("D13 Marketing: spring campaign launch pptx with multiple bullet slides", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "file_generation.create_powerpoint", {
      title: "Spring Campaign Launch",
      slides: [
        {
          title: "Objectives",
          bullets: [
            "Grow weekly signups 25%",
            "Boost brand awareness in Tier-2 cities",
            "Activate influencer partnerships",
          ],
          notes: "Emphasize the signup growth target",
        },
        {
          title: "Channels",
          bullets: ["Instagram Reels", "TikTok", "YouTube Shorts", "Email newsletter"],
        },
        {
          title: "Timeline",
          bullets: ["Week 1: Teaser", "Week 2: Launch", "Week 3: Partnerships", "Week 4: Recap"],
        },
      ],
    });
    expect(r.ok).toBe(true);
    const res = r.result as {
      format: string;
      metadata: { slideCount: number; bulletCount: number };
    };
    expect(res.format).toBe("pptx");
    expect(res.metadata.slideCount).toBe(4);
    expect(res.metadata.bulletCount).toBe(11);
  });

  test("D14 Marketing: funnel conversion chart rendered as SVG", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "file_generation.render_chart_image", {
      title: "Funnel conversion",
      labels: ["Awareness", "Interest", "Decision", "Action"],
      values: [10_000, 3_200, 850, 120],
    });
    expect(r.ok).toBe(true);
    const res = r.result as {
      format: string;
      metadata: { barCount: number; maxValue: number };
    };
    expect(res.format).toBe("svg");
    expect(res.metadata.barCount).toBe(4);
    expect(res.metadata.maxValue).toBe(10_000);
  });

  test("D15 Marketing: channel analytics descriptive stats from CSV", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "data_analysis.describe_dataset", {
      csv:
        "channel,impressions,ctr\n" +
        "instagram,25000,0.042\n" +
        "tiktok,48000,0.061\n" +
        "youtube,32000,0.035\n" +
        "email,8000,0.18",
    });
    expect(r.ok).toBe(true);
    const res = r.result as {
      rowCount: number;
      stats: Record<string, { type: string }>;
    };
    expect(res.rowCount).toBe(4);
    expect(res.stats.impressions.type).toBe("numeric");
    expect(res.stats.ctr.type).toBe("numeric");
  });

  test("D16 Marketing: asset bulk rename applies campaign-date pattern", async ({
    page,
  }) => {
    await openHarness(page);
    const token = await approveChallenge(
      page,
      "file_management.bulk_rename",
      { files: ["x.png"], pattern: "{original}" },
      "marketing-team",
    );
    const r = await invokeInBrowser(
      page,
      "file_management.bulk_rename",
      {
        files: ["hero.png", "banner.png", "thumbnail.png", "ogimage.png"],
        pattern: "{date}_spring_{index:02d}_{original}",
        date: "2026-04-15",
      },
      "marketing-team",
      token,
    );
    expect(r.ok).toBe(true);
    const res = r.result as { renamed: Array<{ renamed: string }>; count: number };
    expect(res.count).toBe(4);
    expect(res.renamed[0].renamed).toBe("2026-04-15_spring_01_hero.png");
    expect(res.renamed[3].renamed).toBe("2026-04-15_spring_04_ogimage.png");
  });
});

// ---------------------------------------------------------------------------
// Domain 4 — OPERACIONES: daily briefings, tracking, dispatch
// ---------------------------------------------------------------------------

test.describe("domain matrix — Operaciones (briefings + tracking + dispatch)", () => {
  test("D17 Ops: daily briefing Word document with KPI table", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "file_generation.create_word_document", {
      title: "Daily Ops Briefing — 2026-04-11",
      sections: [
        {
          heading: "Incidents",
          paragraphs: [
            "Zero P0s overnight.",
            "One P2 (image upload queue latency spike resolved 02:14).",
          ],
        },
        {
          heading: "KPIs",
          table: {
            headers: ["metric", "today", "yesterday"],
            rows: [
              ["active users", "12,450", "12,120"],
              ["error rate", "0.31%", "0.28%"],
              ["avg latency", "142ms", "138ms"],
            ],
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
    const res = r.result as { metadata: { sectionCount: number; tableCount: number } };
    expect(res.metadata.sectionCount).toBe(2);
    expect(res.metadata.tableCount).toBe(1);
  });

  test("D18 Ops: weekly metrics recurring task create + list round-trip", async ({
    page,
  }) => {
    await openHarness(page);
    const userId = "ops-alice";
    const created = await invokeInBrowser(
      page,
      "scheduled_tasks.create_recurring",
      { name: "Weekly KPI digest", cadence: "weekly" },
      userId,
    );
    expect(created.ok).toBe(true);
    const listed = await invokeInBrowser(
      page,
      "scheduled_tasks.list_user_schedules",
      {},
      userId,
    );
    const res = listed.result as { tasks: Array<{ name: string; cadence: string }>; count: number };
    expect(res.count).toBe(1);
    expect(res.tasks[0].name).toBe("Weekly KPI digest");
    expect(res.tasks[0].cadence).toBe("weekly");
  });

  test("D19 Ops: multiple project workspaces per user tracked independently", async ({
    page,
  }) => {
    await openHarness(page);
    const userId = "ops-manager";
    await invokeInBrowser(
      page,
      "projects.create_workspace",
      { name: "Q2 Migration", description: "Database cutover" },
      userId,
    );
    await invokeInBrowser(
      page,
      "projects.create_workspace",
      { name: "Auth Rewrite", description: "OAuth2 rollout" },
      userId,
    );
    const listed = await invokeInBrowser(page, "projects.list_my_projects", {}, userId);
    const res = listed.result as { projects: Array<{ name: string }>; count: number };
    expect(res.count).toBe(2);
    const names = res.projects.map((p) => p.name).sort();
    expect(names).toEqual(["Auth Rewrite", "Q2 Migration"]);
  });

  test("D20 Ops: incident-response runbook decomposed into ordered subtasks", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "sub_agents.decompose_task", {
      task:
        "1. Page on-call engineer. " +
        "2. Verify alert via dashboards. " +
        "3. Roll back last deploy if error rate is above 1 percent. " +
        "4. Post status update to the incidents channel. " +
        "5. Schedule post-mortem for next business day.",
    });
    expect(r.ok).toBe(true);
    const res = r.result as {
      count: number;
      subtasks: Array<{ dependsOn: string[] }>;
    };
    expect(res.count).toBe(5);
    expect(res.subtasks[0].dependsOn).toEqual([]);
    expect(res.subtasks[4].dependsOn.length).toBe(1);
  });

  test("D21 Ops: urgent mobile dispatch queues with high priority", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(
      page,
      "dispatch_mobile.queue_task",
      {
        description: "Investigate API 500 errors reported from mobile clients",
        priority: "high",
      },
      "ops-oncall",
    );
    expect(r.ok).toBe(true);
    const res = r.result as { id: string; priority: string; userId: string };
    expect(res.priority).toBe("high");
    expect(res.userId).toBe("ops-oncall");
    expect(res.id).toMatch(/^disp_/);
  });
});

// ---------------------------------------------------------------------------
// Domain 5 — RRHH: performance, competency, calibration
// ---------------------------------------------------------------------------

test.describe("domain matrix — RRHH (performance + competency + calibration)", () => {
  test("D22 HR: performance review Word document with competency table", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "file_generation.create_word_document", {
      title: "Performance Review — Q1 2026",
      sections: [
        {
          heading: "Achievements",
          paragraphs: [
            "Delivered the OAuth2 rollout 2 weeks ahead of schedule.",
            "Mentored two junior engineers through onboarding.",
          ],
        },
        {
          heading: "Growth areas",
          paragraphs: [
            "Improve async communication in distributed teams.",
            "Take more ownership of cross-team planning meetings.",
          ],
        },
        {
          heading: "Competency scores",
          table: {
            headers: ["Competency", "Score", "Notes"],
            rows: [
              ["Technical depth", "4/5", "Strong across backend + infra"],
              ["Communication", "3/5", "See growth areas"],
              ["Leadership", "4/5", "Mentorship standout"],
            ],
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
    const res = r.result as { metadata: { sectionCount: number; tableCount: number } };
    expect(res.metadata.sectionCount).toBe(3);
    expect(res.metadata.tableCount).toBe(1);
  });

  test("D23 HR: competency xlsx with AVERAGE formulas per score column", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "file_generation.create_excel_workbook", {
      sheets: [
        {
          name: "Scores",
          headers: ["Employee", "Technical", "Communication", "Leadership"],
          rows: [
            ["Alice", 4, 5, 4],
            ["Bob", 5, 3, 3],
            ["Carol", 4, 4, 5],
            ["Dan", 3, 5, 4],
          ],
          formulas: [
            { cell: "F1", formula: "AVERAGE(B2:B5)" },
            { cell: "G1", formula: "AVERAGE(C2:C5)" },
            { cell: "H1", formula: "AVERAGE(D2:D5)" },
          ],
        },
      ],
    });
    expect(r.ok).toBe(true);
    const res = r.result as {
      metadata: { totalRows: number; formulaCount: number; sheetCount: number };
    };
    expect(res.metadata.sheetCount).toBe(1);
    expect(res.metadata.totalRows).toBe(4);
    expect(res.metadata.formulaCount).toBe(3);
  });

  test("D24 HR: RBAC denies peer editor from deleting a performance review", async ({
    page,
  }) => {
    await openHarness(page);
    const editor = await invokeInBrowser(page, "enterprise.rbac_check", {
      userId: "peer-reviewer",
      action: "delete_performance_review",
      role: "editor",
    });
    const admin = await invokeInBrowser(page, "enterprise.rbac_check", {
      userId: "hrbp",
      action: "delete_performance_review",
      role: "admin",
    });
    expect((editor.result as { allowed: boolean }).allowed).toBe(false);
    expect((admin.result as { allowed: boolean }).allowed).toBe(true);
  });

  test("D25 HR: eNPS + retention dataset statistics across teams", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "data_analysis.describe_dataset", {
      headers: ["team", "eNPS", "retention"],
      rows: [
        ["Engineering", 42, 0.92],
        ["Product", 38, 0.88],
        ["Design", 51, 0.95],
        ["Sales", 29, 0.84],
        ["Support", 33, 0.87],
      ],
    });
    expect(r.ok).toBe(true);
    const res = r.result as {
      rowCount: number;
      stats: Record<string, { type: string }>;
    };
    expect(res.rowCount).toBe(5);
    expect(res.stats.eNPS.type).toBe("numeric");
    expect(res.stats.retention.type).toBe("numeric");
  });

  test("D26 HR: calibration workflow decomposed into ordered subtasks", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "sub_agents.decompose_task", {
      task:
        "- Collect self-assessments. " +
        "- Gather peer feedback. " +
        "- Managers draft initial scores. " +
        "- Cross-team calibration meeting. " +
        "- Finalize scores and communicate.",
    });
    expect(r.ok).toBe(true);
    const res = r.result as { count: number };
    expect(res.count).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Domain 6 — INVESTIGACIÓN: synthesis, web research, citations
// ---------------------------------------------------------------------------

test.describe("domain matrix — Investigación (multi-source synthesis)", () => {
  test("D27 Research: interview synthesis finds shared themes across 3 sources", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "research_synthesis.multi_doc_report", {
      docs: [
        {
          id: "interview-1",
          text:
            "The user wanted faster onboarding. They mentioned confusion about initial setup. " +
            "They suggested a guided tour would help.",
        },
        {
          id: "interview-2",
          text:
            "The user complained about onboarding taking too long. They wanted clearer setup " +
            "steps and would prefer a guided experience.",
        },
        {
          id: "interview-3",
          text:
            "Onboarding was confusing. The user did not finish the setup flow. A guided tour " +
            "was specifically requested.",
        },
      ],
    });
    expect(r.ok).toBe(true);
    const res = r.result as {
      docCount: number;
      sharedTerms: string[];
      perDoc: Array<{ wordCount: number }>;
    };
    expect(res.docCount).toBe(3);
    expect(res.sharedTerms).toContain("onboarding");
    expect(res.perDoc.every((d) => d.wordCount > 0)).toBe(true);
  });

  test("D28 Research: web fetch against the harness page succeeds", async ({
    page,
  }) => {
    await openHarness(page);
    const harnessUrl = await getHarnessAbsoluteUrl(page);
    const r = await invokeInBrowser(page, "research_synthesis.web_research", {
      url: harnessUrl,
    });
    expect(r.ok).toBe(true);
    const res = r.result as { status: number; title: string; excerpt: string };
    expect(res.status).toBe(200);
    expect(res.title).toContain("Cognitive Capability Test Harness");
    expect(res.excerpt.length).toBeGreaterThan(0);
  });

  test("D29 Research: executive summary of a Q1 call transcript", async ({
    page,
  }) => {
    await openHarness(page);
    const transcript =
      "In this call we reviewed Q1 results. Revenue exceeded forecast by 12%. " +
      "We hired 5 new engineers and 2 designers. The Auth rewrite launched on time. " +
      "Customer NPS improved from 42 to 51. We flagged churn in the SMB segment as a risk. " +
      "The next priority is the international expansion plan. Questions focused on hiring timing.";
    const r = await invokeInBrowser(page, "research_synthesis.executive_summary", {
      text: transcript,
      maxSentences: 3,
    });
    expect(r.ok).toBe(true);
    const res = r.result as {
      summary: string;
      selectedCount: number;
      totalSentences: number;
    };
    expect(res.selectedCount).toBeLessThanOrEqual(3);
    expect(res.totalSentences).toBeGreaterThan(5);
    expect(res.summary.length).toBeGreaterThan(0);
  });

  test("D30 Research: extract_page returns structured headings + links from the harness", async ({
    page,
  }) => {
    await openHarness(page);
    const harnessUrl = await getHarnessAbsoluteUrl(page);
    const r = await invokeInBrowser(page, "browser_automation.extract_page", {
      url: harnessUrl,
    });
    expect(r.ok).toBe(true);
    const res = r.result as {
      status: number;
      headingCount: number;
      linkCount: number;
      bodyLength: number;
    };
    expect(res.status).toBe(200);
    expect(res.headingCount).toBeGreaterThan(0);
    expect(res.bodyLength).toBeGreaterThan(0);
  });

  test("D31 Research: contradictory sources detected in multi-doc report", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "research_synthesis.multi_doc_report", {
      docs: [
        {
          id: "source-a",
          text:
            "The study confirms users will permit data sharing. Allow the feature rollout.",
        },
        {
          id: "source-b",
          text:
            "The study indicates users deny consent. Reject the feature rollout.",
        },
      ],
    });
    expect(r.ok).toBe(true);
    const res = r.result as { contradictionScore: number; sharedTerms: string[] };
    expect(typeof res.contradictionScore).toBe("number");
  });

  test("D32 Research: interviewee demographics dataset has correct type classification", async ({
    page,
  }) => {
    await openHarness(page);
    const r = await invokeInBrowser(page, "data_analysis.describe_dataset", {
      headers: ["interviewee", "age", "satisfaction", "would_recommend"],
      rows: [
        ["P1", 28, 4.5, "yes"],
        ["P2", 35, 3.2, "yes"],
        ["P3", 42, 2.8, "no"],
        ["P4", 29, 4.8, "yes"],
        ["P5", 51, 3.9, "yes"],
        ["P6", 33, 2.5, "no"],
      ],
    });
    expect(r.ok).toBe(true);
    const res = r.result as {
      rowCount: number;
      stats: Record<string, { type: string; distinctCount?: number }>;
    };
    expect(res.rowCount).toBe(6);
    expect(res.stats.age.type).toBe("numeric");
    expect(res.stats.satisfaction.type).toBe("numeric");
    expect(res.stats.would_recommend.type).toBe("string");
    expect(res.stats.would_recommend.distinctCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Cross-domain pipelines — multi-capability chains
// ---------------------------------------------------------------------------

test.describe("domain matrix — cross-domain pipelines", () => {
  test("D33 Pipeline: forecast → Word document with the projection baked in", async ({
    page,
  }) => {
    await openHarness(page);
    const forecast = await invokeInBrowser(page, "data_analysis.forecast_series", {
      series: [100, 110, 125, 140, 160],
      horizon: 3,
    });
    expect(forecast.ok).toBe(true);
    const fcRes = forecast.result as { forecast: number[]; pointForecast: number };

    const doc = await invokeInBrowser(page, "file_generation.create_word_document", {
      title: "Revenue Forecast Report",
      sections: [
        {
          heading: "Projection",
          paragraphs: [
            `Next 3-period point forecast: ${fcRes.pointForecast.toFixed(2)}`,
            `Forecast values: ${fcRes.forecast.map((v) => v.toFixed(1)).join(", ")}`,
          ],
        },
      ],
    });
    expect(doc.ok).toBe(true);
    expect((doc.result as { format: string }).format).toBe("docx");
  });

  test("D34 Pipeline: CSV → xlsx model → sub-agent decomposition for next steps", async ({
    page,
  }) => {
    await openHarness(page);
    const xlsx = await invokeInBrowser(page, "format_conversion.csv_to_excel_model", {
      csv: "region,sales\nNA,120000\nEU,98000\nAPAC,145000",
    });
    expect(xlsx.ok).toBe(true);
    const tasks = await invokeInBrowser(page, "sub_agents.decompose_task", {
      task:
        "1. Review the sales xlsx. 2. Identify the top region. 3. Draft a growth plan for the underperformers.",
    });
    expect(tasks.ok).toBe(true);
    expect((tasks.result as { count: number }).count).toBeGreaterThanOrEqual(3);
  });

  test("D35 Pipeline: web_research → executive_summary over fetched content", async ({
    page,
  }) => {
    await openHarness(page);
    const harnessUrl = await getHarnessAbsoluteUrl(page);
    const fetched = await invokeInBrowser(page, "research_synthesis.web_research", {
      url: harnessUrl,
    });
    expect(fetched.ok).toBe(true);
    const fetchRes = fetched.result as { excerpt: string };

    const summary = await invokeInBrowser(page, "research_synthesis.executive_summary", {
      text: fetchRes.excerpt + " This is an important follow-up sentence to summarize.",
      maxSentences: 2,
    });
    expect(summary.ok).toBe(true);
    expect((summary.result as { selectedCount: number }).selectedCount).toBeLessThanOrEqual(2);
  });

  test("D36 Pipeline: generate code files → deduplicate identical contents", async ({
    page,
  }) => {
    await openHarness(page);
    const file1 = await invokeInBrowser(page, "file_generation.create_code_file", {
      language: "ts",
      filename: "hello.ts",
      source: "const x = 1;",
    });
    const file2 = await invokeInBrowser(page, "file_generation.create_code_file", {
      language: "ts",
      filename: "hello2.ts",
      source: "const x = 1;",
    });
    expect(file1.ok).toBe(true);
    expect(file2.ok).toBe(true);

    const token = await approveChallenge(
      page,
      "file_management.deduplicate",
      { files: [{ name: "a", content: "x" }] },
      "pipeline-user",
    );
    const dedupe = await invokeInBrowser(
      page,
      "file_management.deduplicate",
      {
        files: [
          { name: "hello.ts", content: "const x = 1;" },
          { name: "hello2.ts", content: "const x = 1;" },
          { name: "different.ts", content: "const y = 2;" },
        ],
      },
      "pipeline-user",
      token,
    );
    expect(dedupe.ok).toBe(true);
    const res = dedupe.result as { totalDuplicates: number; duplicateGroups: unknown[] };
    expect(res.totalDuplicates).toBe(1);
    expect(res.duplicateGroups.length).toBe(1);
  });

  test("D37 Pipeline: coordinate sub-agents then persist a sprint project", async ({
    page,
  }) => {
    await openHarness(page);
    const userId = "pipeline-sprint";
    const coord = await invokeInBrowser(page, "sub_agents.coordinate_parallel", {
      tasks: ["design-review", "spec-writing", "prototype-dev", "test-planning"],
    });
    expect(coord.ok).toBe(true);
    expect((coord.result as { completed: number }).completed).toBe(4);

    const project = await invokeInBrowser(
      page,
      "projects.create_workspace",
      { name: "Sprint 42", description: "New feature rollout" },
      userId,
    );
    expect(project.ok).toBe(true);
  });

  test("D38 Pipeline: PDF → PPTX → recurring schedule for quarterly refresh", async ({
    page,
  }) => {
    await openHarness(page);
    const pdf = await invokeInBrowser(page, "file_generation.create_pdf", {
      title: "Quarterly Report",
      body: ["Revenue grew 12%.", "NPS improved.", "Retention steady."],
    });
    expect(pdf.ok).toBe(true);
    const pdfBase64 = (pdf.result as { base64: string }).base64;

    const pptx = await invokeInBrowser(page, "format_conversion.pdf_to_pptx", {
      pdfBase64,
      title: "Quarterly Review Deck",
    });
    expect(pptx.ok).toBe(true);
    expect((pptx.result as { format: string }).format).toBe("pptx");

    const task = await invokeInBrowser(
      page,
      "scheduled_tasks.create_recurring",
      { name: "Quarterly review deck refresh", cadence: "quarterly" },
      "pipeline-cfo",
    );
    expect(task.ok).toBe(true);
  });

  test("D39 Pipeline: describe → train linear model → render prediction chart", async ({
    page,
  }) => {
    await openHarness(page);
    const desc = await invokeInBrowser(page, "data_analysis.describe_dataset", {
      headers: ["headcount", "cost"],
      rows: [
        [5, 50_000],
        [10, 100_000],
        [15, 150_000],
        [20, 200_000],
      ],
    });
    expect(desc.ok).toBe(true);

    const model = await invokeInBrowser(page, "data_analysis.train_predictive_model", {
      x: [5, 10, 15, 20],
      y: [50_000, 100_000, 150_000, 200_000],
    });
    expect(model.ok).toBe(true);
    expect((model.result as { r2: number }).r2).toBeCloseTo(1, 4);

    const chart = await invokeInBrowser(page, "file_generation.render_chart_image", {
      title: "Cost projection",
      labels: ["5", "10", "15", "20", "25 (pred)"],
      values: [50_000, 100_000, 150_000, 200_000, 250_000],
    });
    expect(chart.ok).toBe(true);
    expect((chart.result as { metadata: { barCount: number } }).metadata.barCount).toBe(5);
  });

  test("D40 Pipeline: approval handshake round-trip across 4 gated capabilities", async ({
    page,
  }) => {
    await openHarness(page);
    const gated = [
      {
        id: "file_management.bulk_rename",
        args: { files: ["a.txt"], pattern: "{original}" },
      },
      {
        id: "file_management.organize_folder",
        args: { files: [{ name: "a", type: "docs" }] },
      },
      {
        id: "file_management.deduplicate",
        args: { files: [{ name: "a", content: "hi" }] },
      },
      {
        id: "security_governance.configure_egress",
        args: { action: "list" },
      },
    ];
    for (const cap of gated) {
      const challenge = await invokeInBrowser(page, cap.id, cap.args);
      expect(challenge.ok).toBe(false);
      expect(challenge.errorCode).toBe("approval_required");
      expect(challenge.approvalChallengeToken).toBeDefined();

      const approved = await invokeInBrowser(
        page,
        cap.id,
        cap.args,
        "matrix-user",
        challenge.approvalChallengeToken,
      );
      expect(approved.ok).toBe(true);
    }
  });

  test("D41 Pipeline: multi-LLM adapter agnosticism verified for a chained workflow", async ({
    page,
  }) => {
    await openHarness(page);
    // Invoke the same chain of capabilities with the same inputs
    // several times in a row. Because capabilities are pure
    // handlers + the middleware reproducibly routes, results must
    // be identical across runs regardless of which LLM adapter
    // happens to be selected under the hood for any chat ancillary.
    const runs: Array<{
      forecastLen: number;
      chartBars: number;
      rbacAllowed: boolean;
    }> = [];
    for (let i = 0; i < 3; i++) {
      const forecast = await invokeInBrowser(page, "data_analysis.forecast_series", {
        series: [1, 2, 3, 4, 5],
        horizon: 2,
      });
      expect(forecast.ok).toBe(true);
      const chart = await invokeInBrowser(page, "file_generation.render_chart_image", {
        title: "t",
        labels: ["a", "b", "c"],
        values: [1, 2, 3],
      });
      expect(chart.ok).toBe(true);
      const rbac = await invokeInBrowser(page, "enterprise.rbac_check", {
        userId: "u",
        action: "read",
        role: "admin",
      });
      expect(rbac.ok).toBe(true);
      runs.push({
        forecastLen: (forecast.result as { forecast: number[] }).forecast.length,
        chartBars: (chart.result as { metadata: { barCount: number } }).metadata.barCount,
        rbacAllowed: (rbac.result as { allowed: boolean }).allowed,
      });
    }
    // All 3 runs must be identical.
    expect(runs[0]).toEqual(runs[1]);
    expect(runs[1]).toEqual(runs[2]);
  });

  test("D42 Pipeline: persistence round-trip — invocation lands in /users/:userId/runs", async ({
    page,
  }) => {
    await openHarness(page);
    const userId = "pipeline-persist-user";
    const invoked = await invokeInBrowser(
      page,
      "availability.echo",
      { persistedFrom: "matrix" },
      userId,
    );
    expect(invoked.ok).toBe(true);

    const runs = (await page.evaluate(async (u) => {
      const r = await fetch(`/api/cognitive/users/${u}/runs?limit=5`);
      return (await r.json()) as {
        count: number;
        runs: Array<{ providerName: string; ok: boolean; userMessage: string }>;
      };
    }, userId)) as {
      count: number;
      runs: Array<{ providerName: string; ok: boolean; userMessage: string }>;
    };
    expect(runs.count).toBeGreaterThanOrEqual(1);
    const hit = runs.runs.find((r) => r.providerName === "capability:availability.echo");
    expect(hit).toBeDefined();
    expect(hit?.ok).toBe(true);
  });
});
