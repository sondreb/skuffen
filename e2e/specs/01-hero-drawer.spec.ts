import { expect, openDemo, captureReadmeStill, test } from "../helpers/app";
import { hold, showDemoLabel } from "../helpers/labels";

test("what is Skuffen / open the people drawer", async ({ demoPage: page }) => {
  await openDemo(page);
  await showDemoLabel(page, "1. Open drawer");

  await expect(page.getByText("Skuffen").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "The drawer is empty" })).toBeVisible();
  await expect(page.getByText("Private drawer")).toBeVisible();
  await expect(page.getByText(/Preview cannot encrypt at rest/)).toBeVisible();
  await expect(page.locator("[data-demo-label]")).toHaveText("1. Open drawer");
  await captureReadmeStill(page, "screenshot-drawer.png");

  await page.getByRole("button", { name: "Latch" }).click();
  await expect(page.getByRole("button", { name: "Providers" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export plaintext OKF" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check for update" })).toBeVisible();
  await expect(page.getByText(/Updates look at published GitHub Releases/)).toBeVisible();
  await expect(page.getByText(/Preview: encryption needs/)).toBeVisible();
  await page.getByRole("button", { name: "Check for update" }).click();
  await expect(page.getByText("Updates need the desktop app.")).toBeVisible();
  await hold(page);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The drawer is empty" })).toBeVisible();
  await hold(page);
});
