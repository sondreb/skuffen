import { createAdaDemo, createBeaDemo, expect, openDemo, test } from "../helpers/app";
import { DEMO } from "../helpers/demo-data";

const BUNDLE_KEY = "skuffen.bundle.files";

async function bundleFiles(page: import("@playwright/test").Page): Promise<Record<string, string>> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), BUNDLE_KEY);
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, string>;
}

test("add a tag as a chip; #tag filter shows that person; name filter still works", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);
  await createBeaDemo(page);
  await page.locator("[data-person-row='ada-demo']").click();

  const input = page.locator("[data-person-tag-input]");
  await expect(input).toBeVisible();
  await input.fill("family");
  await input.press("Enter");
  await expect(page.locator("[data-person-tag='family']")).toBeVisible();
  await expect(page.locator("[data-person-list-tag='family']")).toBeVisible();

  const afterAdd = await bundleFiles(page);
  expect(afterAdd["people/ada-demo/person.md"]).toMatch(/tags:/);
  expect(afterAdd["people/ada-demo/person.md"]).toMatch(/family/);
  expect(afterAdd["people/ada-demo/person.md"]).not.toMatch(/token|secret|skuffen\.cloud/i);

  const sidebar = page.locator(".sidebar");
  await page.locator("[data-people-filter]").fill("#family");
  await expect(sidebar.locator(".person-card", { hasText: DEMO.person.title })).toBeVisible();
  await expect(sidebar.locator(".person-card", { hasText: DEMO.bea.title })).toHaveCount(0);

  await page.locator("[data-people-filter]").fill("# family");
  await expect(sidebar.locator(".person-card", { hasText: DEMO.person.title })).toBeVisible();
  await expect(sidebar.locator(".person-card", { hasText: DEMO.bea.title })).toHaveCount(0);

  await page.locator("[data-people-filter]").fill("Bea");
  await expect(sidebar.locator(".person-card", { hasText: DEMO.bea.title })).toBeVisible();
  await expect(sidebar.locator(".person-card", { hasText: DEMO.person.title })).toHaveCount(0);
});

async function proposeTagViaAskThenResearch(page: import("@playwright/test").Page) {
  await page.locator("[data-person-row='ada-demo']").click();
  await page.getByRole("button", { name: "Suggest", exact: true }).click();
  await page.locator("[data-demo='suggest-facts']").click();
  await page.locator("[data-demo='research']").click();
  const tagOffer = page.locator("[data-suggestion-kind='tag']");
  await expect(tagOffer).toHaveCount(1);
  await expect(tagOffer.getByText("family (demo)")).toBeVisible();
  return tagOffer;
}

test("uncheck a proposed tag writes nothing", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);
  const tagOffer = await proposeTagViaAskThenResearch(page);
  await expect(page.getByText("Nothing is written until you accept.")).toBeVisible();

  await tagOffer.getByRole("checkbox").uncheck();
  await page.locator("[data-demo='accept']").click();
  const afterUncheck = await bundleFiles(page);
  expect(afterUncheck["people/ada-demo/person.md"]).not.toMatch(/tags:/);
  expect(afterUncheck["people/ada-demo/person.md"]).not.toMatch(/\bfamily\b/);
});

test("reject a proposed tag writes nothing", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);
  const tagOffer = await proposeTagViaAskThenResearch(page);

  await tagOffer.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("[data-suggestion-kind='tag']")).toHaveCount(0);
  await page.locator("[data-demo='accept']").click();
  const afterReject = await bundleFiles(page);
  expect(afterReject["people/ada-demo/person.md"]).not.toMatch(/tags:/);
  expect(afterReject["people/ada-demo/person.md"]).not.toMatch(/\bfamily\b/);
});

test("Accept writes a model-proposed tag onto person.md", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);
  const tagOffer = await proposeTagViaAskThenResearch(page);
  await expect(tagOffer.getByRole("checkbox")).toBeChecked();
  await expect(page.getByText("Nothing is written until you accept.")).toBeVisible();

  await page.locator("[data-demo='accept']").click();
  await expect(page.locator("[data-demo='accept']")).toHaveCount(0);
  await expect(page.locator("[data-person-tag='family']")).toBeVisible();

  const afterAccept = await bundleFiles(page);
  expect(afterAccept["people/ada-demo/person.md"]).toMatch(/tags:/);
  expect(afterAccept["people/ada-demo/person.md"]).toMatch(/family/);
  expect(afterAccept["people/ada-demo/person.md"]).not.toMatch(/token|secret|skuffen\.cloud/i);
});
