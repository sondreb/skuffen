import { createAdaDemo, expect, openDemo, test } from "../helpers/app";
import { hold, showDemoLabel } from "../helpers/labels";

test("Grok research proposes, user Accepts", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);
  await page.getByRole("button", { name: /Ada Demo/ }).click();
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();

  await page.locator("[data-demo='suggest']").click();
  await showDemoLabel(page, "Grok research proposes");
  await page.locator("[data-demo='research']").click();

  await expect(page.getByText("Nothing is written until you accept.")).toBeVisible();
  await expect(page.getByText("Public park mention (demo)")).toBeVisible();
  await expect(page.getByText(/Synthetic Grok proposal for Ada Demo/)).toBeVisible();

  await showDemoLabel(page, "Accept to save — nothing is written before this");
  await expect(page.locator("[data-demo-label]")).toHaveText(
    "Accept to save — nothing is written before this",
  );
  await page.locator("[data-demo='accept']").click();

  await expect(page.getByRole("heading", { name: "Public park mention (demo)" })).toBeVisible();
  await expect(page.getByText(/Synthetic Grok proposal for Ada Demo/)).toBeVisible();
  await expect(page.locator("[data-demo='accept']")).toHaveCount(0);
  await hold(page);
});
