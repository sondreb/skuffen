import { createAdaDemo, createBeaDemo, expect, openDemo, test } from "../helpers/app";
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

  await page.locator(".person-card", { hasText: DEMO.person.title }).click();
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();
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
  const beaRow = page.locator("[data-relation-row='ada-demo']");
  await expect(beaRow).toBeVisible();
  await expect(beaRow.getByText("Family · Sibling")).toBeVisible();
  await expect(beaRow.getByText(DEMO.person.title)).toBeVisible();

  await page.getByRole("button", { name: "People" }).click();
  await page.locator("[data-relation-filter='family']").click();
  await expect(page.locator(".sidebar .person-card", { hasText: DEMO.person.title })).toBeVisible();
  await expect(page.locator(".sidebar .person-card", { hasText: DEMO.bea.title })).toBeVisible();
  await page.locator("[data-relation-filter='business']").click();
  await expect(page.locator(".sidebar .person-card")).toHaveCount(0);
  await page.locator("[data-relation-filter='all']").click();
  await expect(page.locator(".sidebar .person-card")).toHaveCount(2);

  await page.locator(".person-card", { hasText: DEMO.person.title }).click();
  await page.locator("[data-delete-person]").click();
  await page.locator("[data-delete-confirm-write]").click();
  await expect(page.locator(".person-card b").filter({ hasText: /^Ada Demo$/ })).toHaveCount(0);

  await page.locator(".person-card", { hasText: DEMO.bea.title }).click();
  await expect(page.locator("[data-relations-empty]")).toBeVisible();
  await expect(page.locator("[data-relation-row]")).toHaveCount(0);
  const afterDelete = await bundleFiles(page);
  expect(Object.keys(afterDelete).some((path) => path.startsWith("people/ada-demo/"))).toBe(false);
  expect(afterDelete["people/bea-demo/relations.md"]).toBeUndefined();
});

test("uncheck and reject a proposed relation write nothing", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);
  await createBeaDemo(page);

  await page.locator(".person-card", { hasText: DEMO.person.title }).click();
  await page.locator("[data-demo='suggest']").click();
  await page.locator("[data-demo='research']").click();
  await expect(page.getByText("Sibling of Bea Demo (demo)")).toBeVisible();
  await expect(page.getByText("Nothing is written until you accept.")).toBeVisible();

  const siblingOffer = page.locator(".fact-offer").filter({ hasText: "Sibling of Bea Demo (demo)" });
  await siblingOffer.getByRole("checkbox").uncheck();
  await page.locator("[data-demo='accept']").click();
  await expect(page.locator("[data-relations-empty]")).toBeVisible();
  await expect(page.locator("[data-relation-row]")).toHaveCount(0);
  const afterUncheck = await bundleFiles(page);
  expect(afterUncheck["people/ada-demo/relations.md"]).toBeUndefined();
  expect(afterUncheck["people/bea-demo/relations.md"]).toBeUndefined();

  await page.locator("[data-demo='research']").click();
  await expect(page.getByText("Sibling of Bea Demo (demo)")).toBeVisible();
  await page.locator(".fact-offer").filter({ hasText: "Sibling of Bea Demo (demo)" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Sibling of Bea Demo (demo)")).toHaveCount(0);
  await page.locator("[data-demo='accept']").click();
  await expect(page.locator("[data-relation-row]")).toHaveCount(0);
  const afterReject = await bundleFiles(page);
  expect(afterReject["people/ada-demo/relations.md"]).toBeUndefined();
  expect(afterReject["people/bea-demo/relations.md"]).toBeUndefined();
});
