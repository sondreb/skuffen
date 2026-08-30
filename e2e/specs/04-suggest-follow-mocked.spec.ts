import { createAdaDemo, expect, openDemo, test } from "../helpers/app";

test("Suggest and Follow use synthetic Ada Demo proposals", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);
  await page.locator("[data-demo='suggest']").click();

  await page.getByRole("button", { name: "Suggest facts" }).click();
  await expect(page.getByText("Nothing is written until you accept.")).toBeVisible();
  await expect(page.getByText("Public park mention (demo)")).toBeVisible();
  await expect(page.getByText("ask · note")).toBeVisible();

  await page.getByLabel("Follow this person").check();
  await expect(page.getByLabel("Follow this person")).toBeChecked();
  await expect(page.getByText("follow · note")).toBeVisible();
  await expect(page.locator("[data-demo='accept']")).toBeVisible();
});
