import { createAdaDemo, createBeaDemo, expect, openDemo, openMapFromMenu, openPersonTab, pinPersonPlace, test } from "../helpers/app";
import { DEMO } from "../helpers/demo-data";

test("empty graph map is a local empty state — no network people", async ({ demoPage: page }) => {
  await openDemo(page);
  await expect(page.locator("[data-person-row]")).toHaveCount(0);

  await openMapFromMenu(page);
  await expect(page.locator("[data-map-empty]")).toBeVisible();
  await expect(page.getByText("No places yet")).toBeVisible();
  await expect(page.locator("[data-map-empty]")).toContainText("does not fetch people from the network");
  await expect(page.locator("[data-map-pin]")).toHaveCount(0);
  await expect(page.locator("[data-map-edge]")).toHaveCount(0);
  await expect(page.locator("[data-person-row]")).toHaveCount(0);
});

test("map shows located people, relation lines, and a pin opens that person", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);
  await pinPersonPlace(page, DEMO.park);
  await createBeaDemo(page);
  await pinPersonPlace(page, DEMO.field);

  await page.locator("[data-person-row='ada-demo']").click();
  await openPersonTab(page, "Relations");
  await page.locator("[data-add-relation-open]").click();
  await page.locator("[data-relation-target]").selectOption({ label: DEMO.bea.title });
  await page.locator("[data-relation-kind]").selectOption("family");
  await page.locator("[data-relation-role]").selectOption("sibling");
  await page.locator("[data-relation-save]").click();
  await expect(page.locator("[data-relation-row='bea-demo']")).toBeVisible();

  await page.locator("[data-people-pane-toggle]").click();
  await expect(page.locator("[data-people-pane]")).toHaveAttribute("data-people-pane-collapsed", "true");

  await openMapFromMenu(page);
  await expect(page.locator("[data-map-empty]")).toHaveCount(0);
  await expect(page.locator('[data-map-pin="ada-demo"]')).toBeVisible();
  await expect(page.locator('[data-map-pin="bea-demo"]')).toBeVisible();
  const edge = page.locator('[data-map-edge="ada-demo|bea-demo:family"]');
  await expect(edge).toHaveCount(1);
  await expect(edge).toHaveAttribute("data-map-kind", "family");
  await expect(page.locator("[data-map-legend-kind='family']")).toBeVisible();

  const stage = page.locator("[data-people-map] .map-stage");
  const box = await stage.boundingBox();
  expect(box, "map fills the content area").toBeTruthy();
  expect(box!.height).toBeGreaterThan(360);
  expect(box!.width).toBeGreaterThan(700);

  await page.locator('[data-map-pin="ada-demo"]').click();
  await expect(page.getByRole("heading", { name: DEMO.person.title })).toBeVisible();
  await expect(page.locator("[data-people-map]")).toHaveCount(0);
});
