import { createAdaDemo, createBeaDemo, expect, openDemo, pinNote, test } from "../helpers/app";
import { DEMO } from "../helpers/demo-data";

const BUNDLE_KEY = "skuffen.bundle.files";
const BLOBS_KEY = "skuffen.bundle.blobs";
const SETTINGS_KEY = "skuffen.settings";

async function settingsSort(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate((settingsKey) => {
    const raw = localStorage.getItem(settingsKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { peopleSort?: string | null };
    return parsed.peopleSort ?? null;
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

async function peopleOrder(page: import("@playwright/test").Page): Promise<string[]> {
  return page.locator("[data-people-pane] [data-person-row]").evaluateAll((rows) =>
    rows.map((row) => (row as HTMLElement).dataset["personRow"] ?? ""),
  );
}

test("people list defaults to name A–Z; recency sorts change order; choice survives reload", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);
  await page.waitForTimeout(1100);
  await createBeaDemo(page);

  const sort = page.locator("[data-people-sort]");
  await expect(sort).toBeVisible();
  await expect(page.locator("[data-people-sort-wrap]")).toHaveAttribute("data-people-sort-method", "name-az");
  await expect(sort).toHaveValue("name-az");
  await expect.poll(() => peopleOrder(page)).toEqual(["ada-demo", "bea-demo"]);
  await expect(page.locator("[data-people-pane]")).not.toContainText(/heat|score|closeness|importance|rank/i);

  await sort.selectOption("added");
  await expect(page.locator("[data-people-sort-wrap]")).toHaveAttribute("data-people-sort-method", "added");
  await expect.poll(() => peopleOrder(page)).toEqual(["bea-demo", "ada-demo"]);
  await expect.poll(() => settingsSort(page)).toBe("added");

  await sort.selectOption("updated");
  await page.locator("[data-person-row='ada-demo']").click();
  await pinNote(page, DEMO.bea.noteBody, DEMO.bea.noteTitle);
  await expect.poll(() => peopleOrder(page)).toEqual(["ada-demo", "bea-demo"]);

  await sort.selectOption("opened");
  await page.locator("[data-person-row='bea-demo']").click();
  await expect.poll(() => peopleOrder(page)).toEqual(["bea-demo", "ada-demo"]);
  await page.locator("[data-person-row='ada-demo']").click();
  await expect.poll(() => peopleOrder(page)).toEqual(["ada-demo", "bea-demo"]);

  await page.locator("[data-people-pane-toggle]").click();
  await expect(page.locator("[data-people-pane]")).toHaveAttribute("data-people-pane-collapsed", "true");
  await page.locator("[data-people-sort-toggle]").click();
  await expect(sort).toBeVisible();
  await sort.selectOption("name-za");
  await expect.poll(() => peopleOrder(page)).toEqual(["bea-demo", "ada-demo"]);

  const afterSort = await diskSnapshot(page);
  expect(afterSort.settings ?? "").toContain('"peopleSort":"name-za"');
  expect(afterSort.settings ?? "").toContain("peopleLastOpened");
  expect(afterSort.settings ?? "").not.toMatch(/token|secret|password|api[_-]?key|authorization|bearer/i);
  expect(afterSort.files ?? "").not.toMatch(/peopleSort|peopleLastOpened/);

  await page.addInitScript(
    ({ files, blobs, settings, filesKey, blobsKey, settingsKey }) => {
      if (files) localStorage.setItem(filesKey, files);
      if (blobs) localStorage.setItem(blobsKey, blobs);
      if (settings) localStorage.setItem(settingsKey, settings);
    },
    {
      ...afterSort,
      filesKey: BUNDLE_KEY,
      blobsKey: BLOBS_KEY,
      settingsKey: SETTINGS_KEY,
    },
  );
  await page.reload();
  await expect(page.locator("[data-people-pane]")).toBeVisible();
  await expect(page.locator("[data-people-sort-wrap]")).toHaveAttribute("data-people-sort-method", "name-za");
  await expect.poll(() => peopleOrder(page)).toEqual(["bea-demo", "ada-demo"]);
  expect(await settingsSort(page)).toBe("name-za");
});
