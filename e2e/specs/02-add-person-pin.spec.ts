import { DEMO } from "../helpers/demo-data";
import { createAdaDemo, expect, openDemo, test } from "../helpers/app";
import { hold, showDemoLabel } from "../helpers/labels";

test("add a person and pin a place on the map", async ({ demoPage: page }) => {
  await openDemo(page);
  await showDemoLabel(page, "2. New person");

  await createAdaDemo(page);
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();
  await expect(page.getByText(DEMO.person.description)).toBeVisible();

  await showDemoLabel(page, "Pin a public park (demo)");
  await page.locator("[data-demo='pin']").click();
  await page.locator('input[name="person-address"]').scrollIntoViewIfNeeded();
  await page.locator('input[name="person-address"]').fill(DEMO.park.query);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: DEMO.park.label }).click();
  await expect(page.locator("[data-demo='save-pin']")).toBeEnabled();
  await page.locator("[data-demo='save-pin']").click();
  await expect(page.getByText(DEMO.park.label)).toBeVisible();
  await hold(page);
});
