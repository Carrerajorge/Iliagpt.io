import { test, expect } from "@playwright/test";

test.describe("Chat artifact generation", () => {
  test("natural DOCX request triggers the office engine and produces a downloadable artifact", async ({ page }) => {
    test.setTimeout(240_000);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "¿En qué puedo ayudarte?" })).toBeVisible({
      timeout: 60_000,
    });

    const composer = page.getByRole("textbox", { name: "Message input" });
    await expect(composer).toBeVisible({ timeout: 20_000 });
    await composer.fill("crea un Word de la administración");
    await composer.press("Enter");

    await expect(page.getByText("Documento listo para descargar.")).toBeVisible({ timeout: 90_000 });
    await expect(
      page.locator('[data-testid^="office-steps-panel-"], [data-testid^="office-steps-"]')
        .filter({ hasText: /Office Engine|Esperando eventos del run/i })
        .last()
    ).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/EventSource error/i)).toHaveCount(0);
    await expect(page.getByText(/^failed$/i)).toHaveCount(0);
    await expect(page.locator('[data-testid*="thinking-indicator"]')).toHaveCount(0);

    const viewButton = page.locator('[data-testid^="button-view-artifact-"]').last();
    await expect(viewButton).toBeVisible();
    const previewResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/office-engine/runs/") &&
        response.url().includes("/artifacts/preview") &&
        response.request().method() === "GET",
      { timeout: 30_000 },
    );
    await viewButton.click();
    const previewResponse = await previewResponsePromise;
    expect(previewResponse.ok()).toBeTruthy();
    expect((previewResponse.headers()["content-type"] || "").toLowerCase()).toContain(
      "officedocument.wordprocessingml.document",
    );

    await expect(page.getByTestId("chat-artifact-split-preview")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("document-preview-docx")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("document-preview-docx-canvas")).toContainText(
      /administraci[oó]n|administracion/i,
      { timeout: 30_000 },
    );
    await expect(composer).toBeVisible();

    await page.getByTestId("chat-artifact-close-button").click();
    await expect(page.getByTestId("chat-artifact-split-preview")).toHaveCount(0);

    const previewButton = page.locator('[data-testid^="button-preview-artifact-"]').last();
    await expect(previewButton).toBeVisible();
    await previewButton.click();
    await expect(page.getByTestId("chat-artifact-split-preview")).toBeVisible({ timeout: 30_000 });

    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByTestId("chat-artifact-download-button").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.docx$/i);
  });

  test("natural PPT request produces a professional presentation with split preview and download", async ({ page }) => {
    test.setTimeout(240_000);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "¿En qué puedo ayudarte?" })).toBeVisible({
      timeout: 60_000,
    });

    const composer = page.getByRole("textbox", { name: "Message input" });
    await expect(composer).toBeVisible({ timeout: 20_000 });
    await composer.fill("crea un excelente ppt con formulas de ventas");
    await composer.press("Enter");

    await expect(page.getByText("Presentación lista para descargar.")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/EventSource error/i)).toHaveCount(0);
    await expect(page.getByText(/^failed$/i)).toHaveCount(0);
    await expect(page.locator('[data-testid*="thinking-indicator"]')).toHaveCount(0);
    await expect(page.getByText("Presentación PowerPoint")).toBeVisible({ timeout: 30_000 });

    const previewButton = page.locator('[data-testid^="button-preview-artifact-"]').last();
    await expect(previewButton).toBeVisible({ timeout: 30_000 });
    await previewButton.click();

    await expect(page.getByTestId("chat-artifact-split-preview")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("document-preview-html")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("document-preview-html")).toContainText(
      /cac|tasa de conversión|inversión comercial/i,
      { timeout: 30_000 },
    );
    await expect(composer).toBeVisible();

    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByTestId("chat-artifact-download-button").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pptx$/i);
  });
});
