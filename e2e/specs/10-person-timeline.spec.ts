import { DEMO } from "../helpers/demo-data";
import { createAdaDemo, expect, openDemo, openPersonTab, test } from "../helpers/app";

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

test("empty card shows empty timeline copy; opening Timeline writes nothing", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);

  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();
  await openPersonTab(page, "Timeline");
  await expect(page.locator("[data-timeline]")).toBeVisible();
  await expect(page.getByText("No timeline yet.")).toBeVisible();
  await expect(page.locator("[data-timeline-kind]")).toHaveCount(0);

  const before = await diskSnapshot(page);
  await page.locator("[data-demo='timeline']").click();
  await expect(page.locator("[data-timeline-surface]")).toBeVisible();
  await expect(page.getByText("Nothing is written by opening Timeline.")).toBeVisible();
  await expect(page.getByText("No timeline yet.")).toBeVisible();
  const afterOpen = await diskSnapshot(page);
  expect(afterOpen).toEqual(before);
});

test("Accept of a note adds a timeline row; demo Ada tape has more than one kind", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);
  await openPersonTab(page, "Timeline");
  await expect(page.getByText("No timeline yet.")).toBeVisible();

  await page.locator("[data-demo='suggest']").click();
  await page.locator("[data-demo='research']").click();
  await expect(page.getByText("Public park mention (demo)")).toBeVisible();
  await expect(page.locator("[data-timeline-kind]")).toHaveCount(0);
  await expect(page.getByText("No timeline yet.")).toBeVisible();

  await page.locator("[data-demo='accept']").click();
  await expect(page.locator("[data-timeline] [data-timeline-kind='note']")).toBeVisible();
  await expect(page.locator("[data-timeline] [data-timeline-kind='note']")).toContainText("Public park mention (demo)");
  await expect(page.getByText("No timeline yet.")).toHaveCount(0);

  await page.locator("[data-demo='pin']").click();
  await page.locator('input[name="person-address"]').fill(DEMO.park.query);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: DEMO.park.label }).click();
  await page.locator("[data-demo='save-pin']").click();
  await expect(page.getByText(DEMO.park.label)).toBeVisible();

  await expect(page.locator("[data-timeline] [data-timeline-kind='note']")).toBeVisible();
  await expect(page.locator("[data-timeline] [data-timeline-kind='place']")).toBeVisible();
  await expect(page.locator("[data-timeline] [data-timeline-kind='place']")).toContainText("Place pin");

  const beforeClick = await diskSnapshot(page);
  await page.locator("[data-demo='timeline']").click();
  await page.locator("[data-timeline] [data-timeline-kind='note']").click();
  await expect(page.locator("[data-okf-path]").filter({ hasText: "Public park mention (demo)" })).toBeVisible();
  const afterClick = await diskSnapshot(page);
  expect(afterClick).toEqual(beforeClick);
});
