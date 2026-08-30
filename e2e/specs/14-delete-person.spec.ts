import { DEMO } from "../helpers/demo-data";
import { createAdaDemo, createBeaDemo, expect, openDemo, test } from "../helpers/app";

const BUNDLE_KEY = "skuffen.bundle.files";
const SETTINGS_KEY = "skuffen.settings";

async function diskSnapshot(page: import("@playwright/test").Page) {
  return page.evaluate(
    ({ filesKey, settingsKey }) => ({
      files: localStorage.getItem(filesKey),
      settings: localStorage.getItem(settingsKey),
    }),
    { filesKey: BUNDLE_KEY, settingsKey: SETTINGS_KEY },
  );
}

function bundlePaths(filesJson: string | null): string[] {
  if (!filesJson) return [];
  return Object.keys(JSON.parse(filesJson) as Record<string, string>);
}

function personFolderGone(filesJson: string | null, slug: string): boolean {
  const prefix = `people/${slug}/`;
  return !bundlePaths(filesJson).some((path) => path.startsWith(prefix));
}

test("cancel leaves the card; confirm removes it from the list and disk", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);

  await expect(page.locator("[data-delete-person]")).toBeVisible();
  await page.locator("[data-delete-person]").click();
  await expect(page.locator("[data-delete-confirm]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delete Ada Demo?" })).toBeVisible();
  await expect(page.getByText(/Nothing is uploaded/)).toBeVisible();

  await page.locator("[data-delete-cancel]").click();
  await expect(page.locator("[data-delete-confirm]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();
  const afterCancel = await diskSnapshot(page);
  expect(bundlePaths(afterCancel.files)).toContain("people/ada-demo/person.md");

  await page.locator("[data-delete-person]").click();
  await page.locator("[data-delete-confirm-write]").click();

  await expect(page.locator("[data-delete-confirm]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No people yet" })).toBeVisible();
  await expect(page.locator(".person-card")).toHaveCount(0);
  await expect(page.locator(".person-card b").filter({ hasText: /^Ada Demo$/ })).toHaveCount(0);

  const afterDelete = await diskSnapshot(page);
  expect(personFolderGone(afterDelete.files, "ada-demo")).toBe(true);
  expect(afterDelete.settings ?? "").not.toMatch(/"slug"\s*:\s*"ada-demo"/);
});

test("deleting This is me clears selfSlug and drops follow/memory for that slug", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);

  await page.locator("[data-self-toggle]").click();
  await expect(page.locator("[data-self-badge]")).toBeVisible();

  await page.locator("[data-demo='suggest']").click();
  await page.getByLabel("Follow this person").check();
  await expect(page.getByLabel("Follow this person")).toBeChecked();

  await page.locator("[data-delete-person]").click();
  await expect(page.getByText(/This card is marked This is me/)).toBeVisible();
  await page.locator("[data-delete-confirm-write]").click();

  await expect(page.getByRole("heading", { name: "No people yet" })).toBeVisible();

  const after = await diskSnapshot(page);
  expect(personFolderGone(after.files, "ada-demo")).toBe(true);
  expect(after.settings ?? "").toContain('"selfSlug":null');
  expect(after.settings ?? "").not.toMatch(/"slug"\s*:\s*"ada-demo"/);
  expect(after.settings ?? "").not.toMatch(/token|secret|password|api[_-]?key|authorization|bearer/i);

  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.locator("[data-self-owner]")).toHaveCount(0);
  await page.locator("[data-demo='open-memory']").click();
  await expect(page.getByRole("heading", { name: "Memory" })).toBeVisible();
  await expect(page.getByText("Ada Demo")).toHaveCount(0);
});

test("people-list context menu Delete opens the same confirm path", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);
  await page.getByRole("button", { name: "People" }).click();
  await createBeaDemo(page);
  await page.getByRole("button", { name: "People" }).click();

  const adaCard = page.locator(".person-card").filter({ has: page.locator("b", { hasText: /^Ada Demo$/ }) });
  await adaCard.click({ button: "right" });
  await expect(page.locator("[data-delete-person-menu]")).toBeVisible();
  await page.locator("[data-delete-person-menu]").click();

  await expect(page.locator("[data-delete-confirm]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delete Ada Demo?" })).toBeVisible();
  await page.locator("[data-delete-confirm-write]").click();

  await expect(page.locator(".person-card b").filter({ hasText: /^Ada Demo$/ })).toHaveCount(0);
  await expect(page.locator(".person-card b").filter({ hasText: DEMO.bea.title })).toBeVisible();
  const after = await diskSnapshot(page);
  expect(personFolderGone(after.files, "ada-demo")).toBe(true);
  expect(bundlePaths(after.files)).toContain("people/bea-demo/person.md");
});
