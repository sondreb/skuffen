import { DEMO } from "../helpers/demo-data";
import { createAdaDemo, expect, openDemo, pinNote, test } from "../helpers/app";

const BUNDLE_KEY = "skuffen.bundle.files";
const SETTINGS_KEY = "skuffen.settings";

const PROMISE_NOTE = DEMO.commitments.first.sourceBody;

async function diskSnapshot(page: import("@playwright/test").Page) {
  return page.evaluate(
    ({ filesKey, settingsKey }) => ({
      files: localStorage.getItem(filesKey),
      settings: localStorage.getItem(settingsKey),
    }),
    { filesKey: BUNDLE_KEY, settingsKey: SETTINGS_KEY },
  );
}

test("empty list copy; opening Commitments writes nothing", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);

  await expect(page.locator("[data-commitments]")).toBeVisible();
  await expect(page.getByText("No commitments yet.")).toBeVisible();

  const before = await diskSnapshot(page);
  await page.getByRole("button", { name: "Latch" }).click();
  await page.locator("[data-demo='open-commitments']").click();
  await expect(page.getByRole("heading", { name: "Commitments" })).toBeVisible();
  await expect(page.locator("[data-demo='commitments-empty']")).toContainText("No commitments yet.");
  await expect(page.getByRole("button", { name: /^Send/i })).toHaveCount(0);
  const afterOpen = await diskSnapshot(page);
  expect(afterOpen).toEqual(before);
});

test("Accept of a promise adds a row; dismiss does not; marking done is explicit; nothing is sent", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);
  await pinNote(page, PROMISE_NOTE, DEMO.commitments.first.sourceTitle);

  await page.getByRole("button", { name: "Latch" }).click();
  await page.locator("[data-demo='open-commitments']").click();
  await expect(page.locator("[data-demo='commitments-empty']")).toContainText("No commitments yet.");
  await expect(page.locator("[data-demo='commitments-list']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Send/i })).toHaveCount(0);

  const beforeDismiss = await diskSnapshot(page);
  await page.locator("[data-demo='commitment-propose-notes']").click();
  await expect(page.locator("[data-demo='commitment-proposal']")).toContainText("Ada Demo");
  await expect(page.locator("[data-demo='commitment-proposal']")).toContainText("send the park slip");
  await expect(page.locator("[data-demo='commitment-proposal']")).toContainText("2026-09-06");

  await page.locator("[data-demo='commitment-dismiss']").click();
  await expect(page.locator("[data-demo='commitment-proposal']")).toHaveCount(0);
  await expect(page.locator("[data-demo='commitments-empty']")).toContainText("No commitments yet.");
  await expect(page.locator("[data-demo='commitments-list']")).toHaveCount(0);
  const afterDismiss = await diskSnapshot(page);
  expect(afterDismiss).toEqual(beforeDismiss);
  expect(afterDismiss.files ?? "").not.toContain("Commitment — send the park slip");

  await page.locator("[data-demo='commitment-propose-notes']").click();
  await expect(page.locator("[data-demo='commitment-proposal']")).toBeVisible();
  await page.locator("[data-demo='commitment-accept']").click();

  await expect(page.locator("[data-demo='commitments-list']")).toContainText("Ada Demo");
  await expect(page.locator("[data-demo='commitments-list']")).toContainText("send the park slip");
  await expect(page.locator("[data-demo='commitments-list']")).toContainText("2026-09-06");
  await expect(page.locator("[data-demo='commitments-empty']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Send/i })).toHaveCount(0);
  await expect(page.getByText(/Never auto-sends/)).toBeVisible();

  await page.locator("[data-demo='commitment-done-ada-demo']").click();
  await expect(page.locator("[data-demo='commitments-list']")).toHaveCount(0);
  await expect(page.locator("[data-demo='commitments-empty']")).toContainText("No commitments yet.");
  await expect(page.getByRole("button", { name: /^Send/i })).toHaveCount(0);

  await page.locator("[data-demo='commitments-back']").click();
  await expect(page.getByRole("heading", { name: "Commitment — send the park slip" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Done — send the park slip" })).toBeVisible();
  await expect(page.locator("[data-commitments]")).toContainText("No commitments yet.");
});

test("demo mode shows two synthetic Ada Demo commitments from local files; nothing is sent", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Latch" }).click();
  await page.locator("[data-demo='open-commitments']").click();
  await page.locator("[data-demo='commitments-seed']").click();

  await expect(page.locator("[data-demo='commitments-list']")).toContainText("Ada Demo");
  await expect(page.locator("[data-demo='commitments-list']")).toContainText("send the park slip");
  await expect(page.locator("[data-demo='commitments-list']")).toContainText("return the land-plot copy");
  await expect(page.locator("[data-demo='commitments-list']")).toContainText("2026-09-06");
  await expect(page.locator("[data-demo='commitments-list'] [data-commitment-slug='ada-demo']")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Send/i })).toHaveCount(0);
});
