import { createAdaDemo, createBeaDemo, expect, openDemo, openPersonTab, test } from "../helpers/app";
import { DEMO } from "../helpers/demo-data";

const BUNDLE_KEY = "skuffen.bundle.files";

async function bundleFiles(page: import("@playwright/test").Page): Promise<Record<string, string>> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), BUNDLE_KEY);
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, string>;
}

test("add sibling shows on both cards; filter by family; delete wipes edges", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);
  await createBeaDemo(page);

  await page.locator("[data-person-row='ada-demo']").click();
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();
  await openPersonTab(page, "Relations");
  await expect(page.locator("[data-relations-empty]")).toBeVisible();

  await page.locator("[data-add-relation-open]").click();
  await page.locator("[data-relation-target]").selectOption({ label: DEMO.bea.title });
  await page.locator("[data-relation-kind]").selectOption("family");
  await page.locator("[data-relation-role]").selectOption("sibling");
  await page.locator("[data-relation-save]").click();

  const adaRow = page.locator("[data-relation-row='bea-demo']");
  await expect(adaRow).toBeVisible();
  await expect(adaRow.getByText("Family · Sibling")).toBeVisible();
  await expect(adaRow.getByText(DEMO.bea.title)).toBeVisible();

  const afterAdd = await bundleFiles(page);
  expect(afterAdd["people/ada-demo/relations.md"]).toMatch(/type: Relations/);
  expect(afterAdd["people/ada-demo/relations.md"]).toMatch(/people\/bea-demo\/person\.md/);
  expect(afterAdd["people/bea-demo/relations.md"]).toMatch(/people\/ada-demo\/person\.md/);
  expect(afterAdd["people/ada-demo/relations.md"]).not.toMatch(/token|secret|password|api[_-]?key/i);

  await page.locator("[data-relation-row='bea-demo'] .relation-open").click();
  await expect(page.getByRole("heading", { name: DEMO.bea.title })).toBeVisible();
  await openPersonTab(page, "Relations");
  const beaRow = page.locator("[data-relation-row='ada-demo']");
  await expect(beaRow).toBeVisible();
  await expect(beaRow.getByText("Family · Sibling")).toBeVisible();
  await expect(beaRow.getByText(DEMO.person.title)).toBeVisible();

  await page.getByRole("button", { name: "People" }).click();
  await page.locator("[data-relation-filter='family']").click();
  await expect(page.locator("[data-person-row='ada-demo']")).toBeVisible();
  await expect(page.locator("[data-person-row='bea-demo']")).toBeVisible();
  await page.locator("[data-relation-filter='business']").click();
  await expect(page.locator(".sidebar [data-person-row]")).toHaveCount(0);
  await page.locator("[data-relation-filter='all']").click();
  await expect(page.locator(".sidebar [data-person-row]")).toHaveCount(2);

  await page.locator("[data-person-row='ada-demo']").click();
  await page.locator("[data-delete-person]").click();
  await page.locator("[data-delete-confirm-write]").click();
  await expect(page.locator(".person-card b").filter({ hasText: /^Ada Demo$/ })).toHaveCount(0);

  await page.locator("[data-person-row='bea-demo']").click();
  await openPersonTab(page, "Relations");
  await expect(page.locator("[data-relations-empty]")).toBeVisible();
  await expect(page.locator("[data-relation-row]")).toHaveCount(0);
  const afterDelete = await bundleFiles(page);
  expect(Object.keys(afterDelete).some((path) => path.startsWith("people/ada-demo/"))).toBe(false);
  expect(afterDelete["people/bea-demo/relations.md"]).toBeUndefined();
});

async function proposeSiblingViaAskThenResearch(page: import("@playwright/test").Page) {
  await page.locator("[data-person-row='ada-demo']").click();
  await page.getByRole("button", { name: "Suggest", exact: true }).click();
  await page.locator("[data-demo='suggest-facts']").click();
  await page.locator("[data-demo='research']").click();
  const siblingOffer = page.locator("[data-suggestion-kind='relation']");
  await expect(siblingOffer).toHaveCount(1);
  await expect(siblingOffer.getByText("Sibling of Bea Demo (demo)")).toBeVisible();
  return siblingOffer;
}

test("uncheck a proposed relation writes nothing", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);
  await createBeaDemo(page);

  const siblingOffer = await proposeSiblingViaAskThenResearch(page);
  await expect(page.getByText("Nothing is written until you accept.")).toBeVisible();

  await siblingOffer.getByRole("checkbox").uncheck();
  await page.locator("[data-demo='accept']").click();
  await openPersonTab(page, "Relations");
  await expect(page.locator("[data-relations-empty]")).toBeVisible();
  await expect(page.locator("[data-relation-row]")).toHaveCount(0);
  const afterUncheck = await bundleFiles(page);
  expect(afterUncheck["people/ada-demo/relations.md"]).toBeUndefined();
  expect(afterUncheck["people/bea-demo/relations.md"]).toBeUndefined();
});

test("reject a proposed relation writes nothing", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);
  await createBeaDemo(page);

  const siblingOffer = await proposeSiblingViaAskThenResearch(page);

  await siblingOffer.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("[data-suggestion-kind='relation']")).toHaveCount(0);
  await page.locator("[data-demo='accept']").click();
  await openPersonTab(page, "Relations");
  await expect(page.locator("[data-relation-row]")).toHaveCount(0);
  const afterReject = await bundleFiles(page);
  expect(afterReject["people/ada-demo/relations.md"]).toBeUndefined();
  expect(afterReject["people/bea-demo/relations.md"]).toBeUndefined();
});
