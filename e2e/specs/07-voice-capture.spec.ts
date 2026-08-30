import { expect, openDemo, test } from "../helpers/app";
import { hold, showDemoLabel } from "../helpers/labels";

const NOTE = "Met Ada Demo at Golden Gate Park Tuesday. Follow up about the land-plot.";

test("paste/demo capture proposes structure; Accept writes; dismiss does not", async ({ demoPage: page }) => {
  await openDemo(page);

  await showDemoLabel(page, "Paste a capture — nothing written yet");
  await page.locator("[data-demo='capture']").click();

  await expect(page.getByRole("heading", { name: "Capture" })).toBeVisible();
  await expect(page.locator("[data-demo='capture-panel']")).toBeVisible();
  await expect(page.getByText(/Nothing is written until you Accept/)).toBeVisible();

  await page.locator("[data-demo='capture-note']").fill(NOTE);
  await page.locator("[data-demo='capture-propose']").click();

  await expect(page.getByText("Ada Demo").first()).toBeVisible();
  await expect(page.getByText(/^Date —/)).toBeVisible();
  await expect(page.getByText(/Follow-up —/)).toBeVisible();
  await expect(page.getByText("Voice note (demo)")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toHaveCount(0);

  await showDemoLabel(page, "Dismiss writes nothing");
  await page.locator("[data-demo='capture-dismiss']").click();
  await expect(page.getByRole("heading", { name: "No people yet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toHaveCount(0);
  await expect(page.getByText("Voice note (demo)")).toHaveCount(0);
  await expect(page.getByText(/Follow-up —/)).toHaveCount(0);

  await page.locator("[data-demo='capture']").click();
  await page.locator("[data-demo='capture-note']").fill(NOTE);
  await page.locator("[data-demo='capture-propose']").click();
  await expect(page.getByText("Ada Demo").first()).toBeVisible();

  await showDemoLabel(page, "Accept writes people, dates, follow-ups");
  await page.locator("[data-demo='capture-accept']").click();

  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Date —/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Follow-up —/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Voice note (demo)" })).toBeVisible();
  await expect(page.locator("[data-demo='capture-accept']")).toHaveCount(0);
  await hold(page);
});
