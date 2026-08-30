import { createAdaDemo, createBeaDemo, expect, openDemo, test } from "../helpers/app";
import { DEMO } from "../helpers/demo-data";

const BUNDLE_KEY = "skuffen.bundle.files";
const BLOBS_KEY = "skuffen.bundle.blobs";
const SETTINGS_KEY = "skuffen.settings";

async function settingsCollapsed(page: import("@playwright/test").Page): Promise<boolean | null> {
  return page.evaluate((settingsKey) => {
    const raw = localStorage.getItem(settingsKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { peoplePaneCollapsed?: boolean | null };
    return typeof parsed.peoplePaneCollapsed === "boolean" ? parsed.peoplePaneCollapsed : null;
  }, SETTINGS_KEY);
}

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

test("people heading is gone; collapse shows photos; expand restores names; choice survives reload", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await expect(page.getByRole("heading", { name: "People", exact: true })).toHaveCount(0);
  await expect(page.locator("[data-people-pane]")).toBeVisible();
  await expect(page.locator("[data-people-pane]")).toHaveAttribute("data-people-pane-collapsed", "false");

  await createAdaDemo(page);
  await createBeaDemo(page);

  const sidebar = page.locator("[data-people-pane]");
  const ada = sidebar.locator(".person-card", { hasText: DEMO.person.title });
  const bea = sidebar.locator(".person-card", { hasText: DEMO.bea.title });
  await expect(ada.locator(".person-meta")).toBeVisible();
  await expect(bea.locator(".person-meta")).toBeVisible();
  await expect(ada.locator(".node")).toBeVisible();

  await page.locator("[data-people-pane-toggle]").click();
  await expect(sidebar).toHaveAttribute("data-people-pane-collapsed", "true");
  await expect(ada.locator(".node")).toBeVisible();
  await expect(bea.locator(".node")).toBeVisible();
  await expect(ada.locator(".person-meta")).toBeHidden();
  await expect(bea.locator(".person-meta")).toBeHidden();
  await expect.poll(() => settingsCollapsed(page)).toBe(true);

  await page.locator("[data-people-filter-toggle]").click();
  await page.locator("[data-people-filter]").fill("Ada");
  await expect(ada).toBeVisible();
  await expect(bea).toHaveCount(0);

  await page.locator("[data-people-pane-toggle]").click();
  await expect(sidebar).toHaveAttribute("data-people-pane-collapsed", "false");
  await expect(ada.locator(".person-meta")).toBeVisible();
  await expect(ada.locator(".person-meta")).toContainText(DEMO.person.title);

  await page.locator("[data-people-pane-toggle]").click();
  await expect(sidebar).toHaveAttribute("data-people-pane-collapsed", "true");
  const afterCollapse = await diskSnapshot(page);
  expect(afterCollapse.settings ?? "").toContain('"peoplePaneCollapsed":true');
  expect(afterCollapse.settings ?? "").not.toMatch(/token|secret|password|api[_-]?key|authorization|bearer/i);

  await page.addInitScript(
    ({ files, blobs, settings, filesKey, blobsKey, settingsKey }) => {
      if (files) localStorage.setItem(filesKey, files);
      if (blobs) localStorage.setItem(blobsKey, blobs);
      if (settings) localStorage.setItem(settingsKey, settings);
    },
    {
      ...afterCollapse,
      filesKey: BUNDLE_KEY,
      blobsKey: BLOBS_KEY,
      settingsKey: SETTINGS_KEY,
    },
  );
  await page.reload();
  await expect(page.locator("[data-people-pane]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "People", exact: true })).toHaveCount(0);
  await expect(page.locator("[data-people-pane]")).toHaveAttribute("data-people-pane-collapsed", "true");
  await expect(page.locator("[data-people-pane] .person-card .node").first()).toBeVisible();
  await expect(page.locator("[data-people-pane] .person-card .person-meta").first()).toBeHidden();
  expect(await settingsCollapsed(page)).toBe(true);
});
