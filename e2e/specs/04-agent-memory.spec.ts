import { createAdaDemo, expect, openDemo, test } from "../helpers/app";
import { hold, showDemoLabel } from "../helpers/labels";

test("inspectable memory lists pending facts; Accept writes; Dismiss drops", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);

  await page.locator("[data-demo='suggest']").click();
  await page.locator("[data-demo='research']").click();
  await expect(page.getByText("Public park mention (demo)")).toBeVisible();
  await expect(page.getByText("Nothing is written until you accept.")).toBeVisible();

  await page.getByRole("button", { name: "Menu" }).click();
  await showDemoLabel(page, "Memory lists what the agent proposed");
  await page.locator("[data-demo='open-memory']").click();

  await expect(page.getByRole("heading", { name: "Memory" })).toBeVisible();
  await expect(page.locator("[data-demo='memory-panel']")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pending facts" })).toBeVisible();
  await expect(page.getByText("Public park mention (demo)")).toBeVisible();
  await expect(page.getByText(/Public web — hostile until Accept/).first()).toBeVisible();
  await expect(page.locator("details.told summary")).toHaveText("What the model was told");
  await page.locator("details.told summary").click();
  await expect(page.locator("details.told pre")).toContainText("Name: Ada Demo");
  await expect(page.getByRole("heading", { name: "Follow schedules" })).toBeVisible();

  await page.locator("[data-demo='memory-dismiss']").click();
  await expect(page.getByText("Nothing pending. Research or Follow only proposes.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Public park mention (demo)" })).toHaveCount(0);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();
  await page.locator("[data-demo='suggest']").click();
  await page.locator("[data-demo='research']").click();
  await expect(page.getByText("Public park mention (demo)")).toBeVisible();

  await page.getByRole("button", { name: "Menu" }).click();
  await page.locator("[data-demo='open-memory']").click();
  await showDemoLabel(page, "Accept writes — dismiss wrote nothing");
  await page.locator("[data-demo='memory-accept']").click();

  await expect(page.getByRole("heading", { name: "Public park mention (demo)" })).toBeVisible();
  await expect(page.getByText(/Synthetic Grok proposal for Ada Demo/)).toBeVisible();
  await hold(page);
});
