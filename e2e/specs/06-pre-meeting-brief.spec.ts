import { DEMO } from "../helpers/demo-data";
import { createAdaDemo, expect, openDemo, test } from "../helpers/app";
import { hold, showDemoLabel } from "../helpers/labels";

test("local pre-meeting brief from OKF facts; no write until Accept", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);

  await page.getByRole("button", { name: "Note" }).click();
  await page.getByPlaceholder("A line about them").fill("Asked about the park pin and the land-plot slip.");
  await page.getByPlaceholder("Title (optional)").fill("Last coffee");
  await page.getByRole("button", { name: "Pin note" }).click();
  await expect(page.getByRole("heading", { name: "Last coffee" })).toBeVisible();

  await page.locator("[data-demo='pin']").click();
  await page.locator('input[name="person-address"]').fill(DEMO.park.query);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: DEMO.park.label }).click();
  await page.locator("[data-demo='save-pin']").click();
  await expect(page.getByText(DEMO.park.label)).toBeVisible();

  await page.locator("[data-demo='suggest']").click();
  await page.locator("[data-demo='research']").click();
  await expect(page.getByText("Public park mention (demo)")).toBeVisible();

  await showDemoLabel(page, "Brief from local notes — nothing written yet");
  await page.locator("[data-demo='brief']").click();

  await expect(page.getByRole("heading", { name: "Pre-meeting brief" })).toBeVisible();
  await expect(page.locator("[data-demo='brief-panel']")).toBeVisible();
  await expect(page.locator("[data-demo='brief-body']")).toContainText("Ada Demo");
  await expect(page.locator("[data-demo='brief-body']")).toContainText("Last coffee");
  await expect(page.locator("[data-demo='brief-body']")).toContainText("Public park mention (demo)");
  await expect(page.locator("[data-demo='brief-body']")).toContainText(DEMO.park.label);
  await expect(page.getByText("Nothing is written until you Accept.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pre-meeting brief — Ada Demo" })).toHaveCount(0);

  await page.locator("[data-demo='brief-dismiss']").click();
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Last coffee" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pre-meeting brief — Ada Demo" })).toHaveCount(0);

  await page.getByRole("button", { name: "Latch" }).click();
  await page.locator("[data-demo='open-brief']").click();
  await expect(page.locator("[data-demo='brief-body']")).toContainText("Ada Demo");

  await page.locator("[data-demo='brief-event']").fill("Coffee with Ada Demo\nTuesday 10:00\nGolden Gate Park");
  await expect(page.locator("[data-demo='brief-body']")).toContainText("Coffee with Ada Demo");

  await page.locator("[data-demo='brief-polish']").click();
  await expect(page.locator("[data-demo='brief-body']")).toContainText("Polish:");

  await showDemoLabel(page, "Accept saves the brief as a note");
  await page.locator("[data-demo='brief-accept']").click();

  await expect(page.getByRole("heading", { name: "Pre-meeting brief — Coffee with Ada Demo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Last coffee" })).toBeVisible();
  await expect(page.getByText(/Assembled on this machine from the OKF card/)).toBeVisible();
  await hold(page);
});
