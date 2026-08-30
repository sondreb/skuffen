import { createAdaDemo, createBeaDemo, expect, openDemo, test } from "../helpers/app";

const BUNDLE_KEY = "skuffen.bundle.files";
const BLOBS_KEY = "skuffen.bundle.blobs";
const SETTINGS_KEY = "skuffen.settings";

async function diskSnapshot(page: import("@playwright/test").Page) {
  return page.evaluate(
    ({ filesKey, blobsKey, settingsKey }) => ({
      files: localStorage.getItem(filesKey),
      blobs: localStorage.getItem(blobsKey),
      settings: localStorage.getItem(settingsKey),
    }),
    { filesKey: BUNDLE_KEY, blobsKey: BLOBS_KEY, settingsKey: SETTINGS_KEY },
  );
}

async function settingsSelfSlug(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate((settingsKey) => {
    const raw = localStorage.getItem(settingsKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { selfSlug?: string | null };
    return parsed.selfSlug ?? null;
  }, SETTINGS_KEY);
}

test("mark This is me; only one self; persists in settings not tokens", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);

  await expect(page.locator("[data-self-toggle]")).toHaveText("This is me");
  await expect(page.locator("[data-self-badge]")).toHaveCount(0);

  await page.locator("[data-self-toggle]").click();
  await expect(page.locator("[data-self-badge]")).toHaveText("This is me · this local copy");
  await expect(page.locator("[data-self-toggle]")).toHaveCount(0);
  expect(await settingsSelfSlug(page)).toBe("ada-demo");

  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.locator("[data-self-owner]")).toHaveText("You · Ada Demo");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "People" }).click();
  await expect(page.locator("[data-self-card='ada-demo']")).toBeVisible();
  await expect(page.locator("[data-self-card='ada-demo']")).toContainText("This is me");

  const afterMark = await diskSnapshot(page);
  expect(afterMark.settings ?? "").toContain('"selfSlug":"ada-demo"');
  expect(afterMark.settings ?? "").not.toMatch(/token|secret|password|api[_-]?key|authorization|bearer/i);
  expect(afterMark.files ?? "").not.toMatch(/access_token|grok_api_key|xai-|AIza/);

  await page.addInitScript(
    ({ files, blobs, settings, filesKey, blobsKey, settingsKey }) => {
      if (files) localStorage.setItem(filesKey, files);
      if (blobs) localStorage.setItem(blobsKey, blobs);
      if (settings) localStorage.setItem(settingsKey, settings);
    },
    {
      ...afterMark,
      filesKey: BUNDLE_KEY,
      blobsKey: BLOBS_KEY,
      settingsKey: SETTINGS_KEY,
    },
  );
  await page.reload();
  await expect(page.locator("[data-self-card='ada-demo']")).toBeVisible();
  await expect(page.locator("[data-self-card='ada-demo']")).toContainText("This is me");
  expect(await settingsSelfSlug(page)).toBe("ada-demo");

  await page.locator("[data-self-card='ada-demo']").click();
  await expect(page.locator("[data-self-badge]")).toHaveText("This is me · this local copy");
  await expect(page.locator("[data-self-toggle]")).toHaveCount(0);

  await page.getByRole("button", { name: "People" }).click();
  await createBeaDemo(page);
  await expect(page.locator("[data-self-toggle]")).toHaveCount(0);
  await expect(page.locator("[data-self-badge]")).toHaveCount(0);
  expect(await settingsSelfSlug(page)).toBe("ada-demo");

  await page.getByRole("button", { name: "People" }).click();
  const adaCard = page.locator(".person-card").filter({ has: page.locator("b", { hasText: /^Ada Demo$/ }) });
  const beaCard = page.locator(".person-card").filter({ has: page.locator("b", { hasText: /^Bea Demo$/ }) });
  await expect(page.locator("[data-self-card='ada-demo']")).toBeVisible();
  await expect(page.locator("[data-self-card='bea-demo']")).toHaveCount(0);
  await expect(adaCard).toBeVisible();
  await expect(adaCard).toContainText("This is me");
  await expect(beaCard).toBeVisible();
  await expect(beaCard).not.toContainText("This is me");
});
