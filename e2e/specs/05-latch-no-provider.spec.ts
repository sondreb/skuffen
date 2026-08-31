import { expect, startNameResearch, test } from "../helpers/app";

async function openPreview(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "No people yet" })).toBeVisible({
    timeout: 30_000,
  });
}

async function expectMenuOpen(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Providers" })).toBeVisible();
}

async function expectMenuClosed(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Providers" })).toHaveCount(0);
}

test("no-provider research opens Menu, dismiss recovers the page", async ({ demoPage: page }) => {
  await openPreview(page);

  await startNameResearch(page, "Ada Lovelace");

  await expectMenuOpen(page);
  await expect(page.getByText(/Connect Grok in Menu/)).toBeVisible();

  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expectMenuClosed(page);
  await expect(page.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
  await expect(page.locator("[data-research-empty]")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("heading", { name: "No people yet" })).toBeVisible();

  await page.getByRole("button", { name: "Add person" }).first().click();
  await expect(page.getByRole("heading", { name: "Who?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "No people yet" })).toBeVisible();

  await startNameResearch(page, "Ada Lovelace");
  await expectMenuOpen(page);
  await page.keyboard.press("Escape");
  await expectMenuClosed(page);
  await expect(page.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("heading", { name: "No people yet" })).toBeVisible();

  await startNameResearch(page, "Ada Lovelace");
  await expectMenuOpen(page);
  // Menu opens from the logo (left). Click the well on the right — outside the sheet.
  await page.locator(".well").click({ position: { x: 520, y: 80 } });
  await expectMenuClosed(page);
  await page.getByRole("button", { name: "Dismiss" }).click();

  await startNameResearch(page, "Ada Lovelace");
  await expectMenuOpen(page);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expectMenuClosed(page);
  await page.getByRole("button", { name: "Dismiss" }).click();

  await page.getByRole("button", { name: "Add person" }).first().click();
  await page.locator('input[name="person-name"]').fill("Ada Demo");
  await page.locator(".card-form").getByRole("button", { name: "Add person" }).click();
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();

  await page.getByRole("button", { name: "Suggest" }).click();
  await page.getByRole("button", { name: "Suggest facts" }).click();
  await expectMenuOpen(page);
  await expect(page.getByText("Connect Grok in Menu → Providers first.")).toBeVisible();

  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expectMenuClosed(page);
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();

  await page.getByRole("button", { name: "Note" }).click();
  await expect(page.getByPlaceholder("A line about them")).toBeVisible();
});
