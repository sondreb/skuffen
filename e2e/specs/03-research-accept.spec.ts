import { captureReadmeStill, createAdaDemo, expect, openDemo, test } from "../helpers/app";
import { hold, showDemoLabel } from "../helpers/labels";

test("Grok research proposes, user Accepts", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();

  await page.locator("[data-demo='suggest']").click();
  await showDemoLabel(page, "Grok research proposes");
  await page.locator("[data-demo='research']").click();

  await expect(page.getByText("Nothing is written until you accept.")).toBeVisible();
  await expect(page.getByText("Public park mention (demo)")).toBeVisible();
  await expect(page.getByText(/Synthetic Grok proposal for Ada Demo/)).toBeVisible();
  const offers = page.locator(".suggest .offers");
  await expect(offers.getByText("ada.demo@example.invalid")).toBeVisible();
  await expect(offers.getByText("+1 555 0100")).toBeVisible();
  await expect(offers.getByText("field · email")).toBeVisible();
  await expect(offers.getByText("field · phone")).toBeVisible();
  await expect(offers.getByText("Public portrait (demo)")).toBeVisible();
  const preview = offers.locator("[data-photo-preview]");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /\/assets\/skuffen-icon\.png$/);
  await page.locator("[data-demo='accept']").scrollIntoViewIfNeeded();

  await showDemoLabel(page, "Accept to save — nothing is written before this");
  await expect(page.locator("[data-demo-label]")).toHaveText(
    "Accept to save — nothing is written before this",
  );
  await captureReadmeStill(page, "screenshot-research.png");
  await page.locator("[data-demo='accept']").click();

  await expect(page.getByRole("heading", { name: "Public park mention (demo)" })).toBeVisible();
  await expect(page.getByText(/Synthetic Grok proposal for Ada Demo/)).toBeVisible();
  await expect(page.getByText("+1 555 0100")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Public portrait (demo)" })).toBeVisible();
  await expect(page.getByText("No photos yet.")).toHaveCount(0);
  await expect(page.locator("[data-photos] [data-photo-profile]")).toBeVisible();
  await expect(page.locator("[data-demo='accept']")).toHaveCount(0);
  await hold(page);
});
