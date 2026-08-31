import { DEMO } from "../helpers/demo-data";
import { expect, leavePersonCard, openDemo, seedDemoMergePair, test } from "../helpers/app";
import { hold, showDemoLabel } from "../helpers/labels";

test("duplicate cards propose a merge and do not merge silently", async ({ demoPage: page }) => {
  await openDemo(page);
  await showDemoLabel(page, "Two synthetic cards — merge is a proposal");
  await seedDemoMergePair(page);

  await expect(page.getByRole("heading", { name: `${DEMO.person.title} ← ${DEMO.twin.title}` })).toBeVisible();
  await expect(page.getByText(/same email ada\.demo@example\.invalid/)).toBeVisible();
  await expect(page.getByText("Nothing merges until you accept.")).toBeVisible();
  await expect(page.getByText(DEMO.twin.noteTitle)).toBeVisible();
  await expect(page.locator("[data-demo='merge-accept']")).toBeVisible();

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.locator(".person-card b").filter({ hasText: /^Ada Demo$/ })).toBeVisible();
  await expect(page.locator(".person-card b", { hasText: DEMO.twin.title })).toBeVisible();
  await expect(page.getByText("may be the same person")).toBeVisible();
  await hold(page);
});

test("dismiss leaves both people in the list", async ({ demoPage: page }) => {
  await openDemo(page);
  await seedDemoMergePair(page);
  await showDemoLabel(page, "Dismiss leaves both cards");
  await page.locator("[data-demo='merge-dismiss']").click();

  await expect(page.locator("[data-merge-proposal]")).toHaveCount(0);
  await expect(page.locator(".person-card b").filter({ hasText: /^Ada Demo$/ })).toBeVisible();
  await expect(page.locator(".person-card b", { hasText: DEMO.twin.title })).toBeVisible();
  await expect(page.getByText("may be the same person")).toHaveCount(0);
  await hold(page);
});

test("Accept merges into one OKF person", async ({ demoPage: page }) => {
  await openDemo(page);
  await seedDemoMergePair(page);
  await showDemoLabel(page, "Accept merge — only then one card");
  await page.locator("[data-demo='merge-accept']").click();

  await expect(page.locator("[data-merge-proposal]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: DEMO.person.title, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: DEMO.twin.noteTitle })).toBeVisible();
  await expect(page.getByText(DEMO.twin.noteBody)).toBeVisible();
  await leavePersonCard(page);
  await expect(page.locator(".person-card b").filter({ hasText: /^Ada Demo$/ })).toBeVisible();
  await expect(page.locator(".person-card b", { hasText: DEMO.twin.title })).toHaveCount(0);
  await expect(page.getByText("may be the same person")).toHaveCount(0);
  await hold(page);
});
