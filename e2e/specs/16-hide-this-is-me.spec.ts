import { createAdaDemo, createBeaDemo, expect, openDemo, test } from "../helpers/app";

const SETTINGS_KEY = "skuffen.settings";

async function settingsSelfSlug(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate((settingsKey) => {
    const raw = localStorage.getItem(settingsKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { selfSlug?: string | null };
    return parsed.selfSlug ?? null;
  }, SETTINGS_KEY);
}

test("This is me hides after mark and returns after self is cleared", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);

  await expect(page.locator("[data-self-toggle]")).toHaveText("This is me");
  await page.locator("[data-self-toggle]").click();
  await expect(page.locator("[data-self-badge]")).toHaveText("This is me · this local copy");
  await expect(page.locator("[data-self-toggle]")).toHaveCount(0);
  expect(await settingsSelfSlug(page)).toBe("ada-demo");

  await page.getByRole("button", { name: "People" }).click();
  await createBeaDemo(page);
  await expect(page.locator("[data-self-toggle]")).toHaveCount(0);
  await expect(page.locator("[data-self-badge]")).toHaveCount(0);

  await page.getByRole("button", { name: "People" }).click();
  await page.locator("[data-self-card='ada-demo']").click();
  await expect(page.locator("[data-self-badge]")).toBeVisible();
  await expect(page.locator("[data-self-toggle]")).toHaveCount(0);

  await page.locator("[data-delete-person]").click();
  await page.locator("[data-delete-confirm-write]").click();
  expect(await settingsSelfSlug(page)).toBeNull();

  await page.getByRole("button", { name: "People" }).click();
  const beaCard = page.locator(".person-card").filter({ has: page.locator("b", { hasText: /^Bea Demo$/ }) });
  await beaCard.click();
  await expect(page.locator("[data-self-toggle]")).toHaveText("This is me");
  await expect(page.locator("[data-self-badge]")).toHaveCount(0);
});
