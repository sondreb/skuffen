import { expect, openDemo, test } from "../helpers/app";

test("Cmd/Ctrl+, Latch, find, and capture feel instant — no scrim trap", async ({ demoPage: page }) => {
  await openDemo(page);

  await page.keyboard.press("Control+,");
  await expect(page.getByRole("dialog", { name: "Latch" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Providers" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close latch" })).toHaveCount(0);

  await page.locator("[data-demo='capture']").click();
  await expect(page.getByRole("dialog", { name: "Latch" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Capture" })).toBeVisible();
  await expect(page.locator("[data-demo='capture-note']")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "The drawer is empty" })).toBeVisible();

  await page.keyboard.press("/");
  await expect(page.getByPlaceholder("Find someone")).toBeFocused();

  await page.keyboard.press("Control+Shift+C");
  await expect(page.getByRole("heading", { name: "Capture" })).toBeVisible();
  await expect(page.locator("[data-demo='capture-note']")).toBeFocused();
});
