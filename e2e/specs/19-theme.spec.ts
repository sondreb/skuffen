import { expect, openDemo, test } from "../helpers/app";

const SETTINGS_KEY = "skuffen.settings";

async function settingsTheme(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate((settingsKey) => {
    const raw = localStorage.getItem(settingsKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { theme?: string | null };
    return parsed.theme ?? null;
  }, SETTINGS_KEY);
}

async function settingsSnapshot(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate((settingsKey) => localStorage.getItem(settingsKey), SETTINGS_KEY);
}

async function restoreSettingsOnReload(page: import("@playwright/test").Page, settings: string | null): Promise<void> {
  await page.addInitScript(
    ({ settings, settingsKey }) => {
      if (settings) localStorage.setItem(settingsKey, settings);
    },
    { settings, settingsKey: SETTINGS_KEY },
  );
}

async function openThemeMenu(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await expect(page.locator("[data-theme-picker]")).toBeVisible();
}

test("switch Light, Dark, Auto; choice survives reload in settings not tokens", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await openThemeMenu(page);

  await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "auto");
  await expect(page.locator("[data-theme-choice='auto']")).toHaveAttribute("aria-checked", "true");

  await page.locator("[data-theme-choice='light']").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("[data-theme-choice='light']")).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => settingsTheme(page)).toBe("light");

  const afterLight = await settingsSnapshot(page);
  expect(afterLight ?? "").toContain('"theme":"light"');
  expect(afterLight ?? "").not.toMatch(/token|secret|password|api[_-]?key|authorization|bearer/i);

  await restoreSettingsOnReload(page, afterLight);
  await page.reload();
  await expect(page.getByRole("heading", { name: "No people yet" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await settingsTheme(page)).toBe("light");

  await openThemeMenu(page);
  await page.locator("[data-theme-choice='dark']").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => settingsTheme(page)).toBe("dark");

  const afterDark = await settingsSnapshot(page);
  expect(afterDark ?? "").toContain('"theme":"dark"');
  await restoreSettingsOnReload(page, afterDark);
  await page.reload();
  await expect(page.getByRole("heading", { name: "No people yet" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await settingsTheme(page)).toBe("dark");

  await openThemeMenu(page);
  await page.locator("[data-theme-choice='auto']").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "auto");
  await expect.poll(() => settingsTheme(page)).toBe("auto");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const afterAuto = await settingsSnapshot(page);
  expect(afterAuto ?? "").toContain('"theme":"auto"');
  expect(afterAuto ?? "").not.toMatch(/token|secret|password|api[_-]?key|authorization|bearer/i);
  await restoreSettingsOnReload(page, afterAuto);
  await page.reload();
  await expect(page.getByRole("heading", { name: "No people yet" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "auto");
  expect(await settingsTheme(page)).toBe("auto");
});
