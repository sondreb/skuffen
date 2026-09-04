import { createAdaDemo, createBeaDemo, expect, leavePersonCard, openDemo, test } from "../helpers/app";
import { DEMO } from "../helpers/demo-data";

test("toolbar brand is a single-line Material treatment", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);
  await leavePersonCard(page);

  const brand = page.locator("[data-open-menu]");
  await expect(brand).toContainText("Skuffen");
  await expect(brand).toContainText("1 person");
  const box = await brand.boundingBox();
  expect(box, "Menu brand should be laid out").toBeTruthy();
  expect(box!.width).toBeGreaterThan(box!.height);
  expect(box!.height).toBeLessThanOrEqual(56);
});

test("left-rail Find and Sort are full-width; relation chips sit in an even grid", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);
  await createBeaDemo(page);
  await leavePersonCard(page);

  const sidebar = page.locator("[data-people-pane]");
  const find = sidebar.locator("[data-people-filter]");
  const sort = sidebar.locator("[data-people-sort]");
  await expect(find).toBeVisible();
  await expect(sort).toBeVisible();
  await expect(sidebar.getByText("Fin…")).toHaveCount(0);
  await expect(sidebar.getByLabel("Find")).toBeVisible();

  const findBox = await find.boundingBox();
  const sortBox = await sort.boundingBox();
  expect(findBox, "Find field should be laid out").toBeTruthy();
  expect(sortBox, "Sort field should be laid out").toBeTruthy();
  expect(findBox!.width).toBeGreaterThan(140);
  expect(sortBox!.width).toBeGreaterThan(180);
  expect(sortBox!.y).toBeGreaterThan(findBox!.y + findBox!.height - 8);

  const allBox = await sidebar.locator("[data-relation-filter='all']").boundingBox();
  const familyBox = await sidebar.locator("[data-relation-filter='family']").boundingBox();
  const businessBox = await sidebar.locator("[data-relation-filter='business']").boundingBox();
  const otherBox = await sidebar.locator("[data-relation-filter='other']").boundingBox();
  expect(allBox && familyBox && businessBox && otherBox, "relation chips should be laid out").toBeTruthy();
  expect(Math.abs(allBox!.y - familyBox!.y)).toBeLessThan(8);
  expect(Math.abs(businessBox!.y - otherBox!.y)).toBeLessThan(8);
  expect(businessBox!.y).toBeGreaterThan(allBox!.y + 8);
  expect(familyBox!.x).toBeGreaterThan(allBox!.x + 8);
  expect(otherBox!.x).toBeGreaterThan(businessBox!.x + 8);

  await sidebar.locator("[data-relation-filter='family']").click();
  await expect(sidebar.locator("[data-person-row]")).toHaveCount(0);
  await sidebar.locator("[data-relation-filter='all']").click();
  await expect(sidebar.locator("[data-person-row]")).toHaveCount(2);
});

test("Me row is not selected unless the list selection is on that person", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);
  await page.locator("[data-self-toggle]").click();
  await leavePersonCard(page);
  await createBeaDemo(page);
  await leavePersonCard(page);

  const ada = page.locator("[data-self-card='ada-demo']");
  const bea = page.locator("[data-person-row='bea-demo']");
  await expect(ada).toContainText("This is me");
  await expect(page.locator("[data-people-gallery]")).toBeVisible();
  await expect(ada).not.toHaveClass(/\bon\b/);
  await expect(bea).not.toHaveClass(/\bon\b/);

  await bea.click();
  await expect(page.getByRole("heading", { name: DEMO.bea.title })).toBeVisible();
  await expect(bea).toHaveClass(/\bon\b/);
  await expect(ada).not.toHaveClass(/\bon\b/);
});
