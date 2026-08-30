import { expect, test } from "../helpers/app";

async function openPreview(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "The drawer is empty" })).toBeVisible({
    timeout: 30_000,
  });
}

test("header and person research show an in-place empty state without a provider", async ({
  demoPage: page,
}) => {
  await openPreview(page);

  await page.getByPlaceholder("Find someone").fill("Ada Lovelace");
  await page.getByRole("button", { name: "Research" }).click();

  await expect(page.getByRole("dialog", { name: "Latch" })).toBeVisible();
  await expect(page.getByText(/Connect Grok in Latch/)).toBeVisible();
  await page.getByRole("button", { name: "Latch", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Latch" })).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
  await expect(page.getByText("Proposed card — not in the drawer yet")).toBeVisible();
  const headerEmpty = page.locator("[data-research-empty]");
  await expect(headerEmpty).toBeVisible();
  await expect(headerEmpty.getByText(/Connect Grok or Gemini in Latch/)).toBeVisible();
  await expect(headerEmpty.getByText(/Nothing is written until you accept/)).toBeVisible();
  await expect(headerEmpty.getByText("No proposals yet.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Accept selected" })).toHaveCount(0);

  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("heading", { name: "The drawer is empty" })).toBeVisible();

  await page.getByRole("button", { name: "Put someone in" }).click();
  await page.locator('input[name="person-name"]').fill("Ada Demo");
  await page.getByRole("button", { name: "Put in the drawer" }).click();
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();

  await page.getByRole("button", { name: "Suggest" }).click();
  await expect(page.locator("[data-research-empty]")).toHaveCount(0);
  await expect(page.getByText("No proposals yet.")).toBeVisible();

  await page.getByRole("button", { name: "Suggest facts" }).click();
  await expect(page.getByRole("dialog", { name: "Latch" })).toBeVisible();
  await page.getByRole("button", { name: "Latch", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Latch" })).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();
  const cardEmpty = page.locator(".suggest [data-research-empty]");
  await expect(cardEmpty).toBeVisible();
  await expect(cardEmpty.getByText(/Connect Grok or Gemini in Latch/)).toBeVisible();
  await expect(cardEmpty.getByText("No proposals yet.")).toHaveCount(0);
  await expect(cardEmpty.getByText(/Nothing is written until you accept/)).toBeVisible();
  await expect(page.getByText("Follow this person")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept selected" })).toHaveCount(0);

  await page.getByRole("button", { name: "Research with Grok" }).click();
  await expect(page.getByRole("dialog", { name: "Latch" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(cardEmpty).toBeVisible();
});
