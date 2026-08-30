import { expect, test } from "../helpers/app";

async function openPreview(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "The drawer is empty" })).toBeVisible({
    timeout: 30_000,
  });
}

async function expectLatchOpen(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByRole("dialog", { name: "Latch" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Providers" })).toBeVisible();
}

async function expectLatchClosed(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByRole("dialog", { name: "Latch" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Providers" })).toHaveCount(0);
}

test("no-provider research opens Latch, dismiss recovers the page", async ({ demoPage: page }) => {
  await openPreview(page);

  await page.getByPlaceholder("Find someone").fill("Ada Lovelace");
  await page.getByRole("button", { name: "Research" }).click();

  await expectLatchOpen(page);
  await expect(page.getByText(/Connect Grok in Latch/)).toBeVisible();

  await page.getByRole("button", { name: "Latch", exact: true }).click();
  await expectLatchClosed(page);
  await expect(page.getByRole("heading", { name: "The drawer is empty" })).toBeVisible();
  await expect(page.getByText(/Connect Grok in Latch/)).toBeVisible();

  await page.getByRole("button", { name: "Put someone in" }).click();
  await expect(page.getByRole("heading", { name: "Who?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "The drawer is empty" })).toBeVisible();

  await page.getByRole("button", { name: "Research" }).click();
  await expectLatchOpen(page);
  await page.keyboard.press("Escape");
  await expectLatchClosed(page);
  await expect(page.getByRole("heading", { name: "The drawer is empty" })).toBeVisible();

  await page.getByRole("button", { name: "Research" }).click();
  await expectLatchOpen(page);
  await page.getByRole("button", { name: "Close latch" }).click();
  await expectLatchClosed(page);

  await page.getByRole("button", { name: "Research" }).click();
  await expectLatchOpen(page);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expectLatchClosed(page);

  await page.getByRole("button", { name: "Put someone in" }).click();
  await page.locator('input[name="person-name"]').fill("Ada Demo");
  await page.getByRole("button", { name: "Put in the drawer" }).click();
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();

  await page.getByRole("button", { name: "Suggest" }).click();
  await page.getByRole("button", { name: "Suggest facts" }).click();
  await expectLatchOpen(page);
  await expect(page.getByText("Connect Grok in Latch → Providers first.")).toBeVisible();

  await page.getByRole("button", { name: "Latch", exact: true }).click();
  await expectLatchClosed(page);
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();

  await page.getByRole("button", { name: "Note" }).click();
  await expect(page.getByPlaceholder("A line about them")).toBeVisible();
});
