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
    await composer.fill("crea un Word de la IA");
    await composer.press("Enter");

    await expect(page.getByText("Documento listo para descargar.")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Office Engine — Run/i)).toBeVisible({ timeout: 90_000 });

    const downloadButton = page.getByRole("link", { name: "Descargar" }).last();
    await expect(downloadButton).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await downloadButton.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename().toLowerCase()).toContain(".docx");
  });
});
