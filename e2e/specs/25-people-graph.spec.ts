import { createAdaDemo, createBeaDemo, expect, openDemo, openGraphFromMenu, openPersonTab, test } from "../helpers/app";
import { DEMO } from "../helpers/demo-data";

test("empty graph is a local empty state — no network people", async ({ demoPage: page }) => {
  await openDemo(page);
  await expect(page.locator("[data-person-row]")).toHaveCount(0);

  await openGraphFromMenu(page);
  await expect(page.locator("[data-graph-empty]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who knows who" })).toBeVisible();
  await expect(page.getByText("No people in this local graph")).toBeVisible();
  await expect(page.locator("[data-graph-empty]")).toContainText("does not fetch people from the network");
  await expect(page.locator("[data-graph-empty]")).toContainText("never scored");
  await expect(page.locator("[data-graph-node]")).toHaveCount(0);
  await expect(page.locator("[data-graph-edge]")).toHaveCount(0);
  await expect(page.locator("[data-person-row]")).toHaveCount(0);
  await expect(page.locator("[data-people-graph]")).not.toContainText(/friend-heat|closeness score/i);
  await expect(page.locator("[data-graph-score], [data-friend-heat], [data-closeness]")).toHaveCount(0);
});

test("two related people show as nodes with a typed edge; click opens that person", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);
  await createBeaDemo(page);

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

  await openGraphFromMenu(page);
  await expect(page.locator("[data-graph-empty]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Who knows who" })).toBeVisible();
  await expect(page.locator('[data-graph-node="ada-demo"]')).toBeVisible();
  await expect(page.locator('[data-graph-node="bea-demo"]')).toBeVisible();
  const edge = page.locator('[data-graph-edge="ada-demo|bea-demo:family"]');
  await expect(edge).toHaveCount(1);
  await expect(edge).toHaveAttribute("data-graph-kind", "family");
  await expect(page.locator("[data-graph-legend-kind='family']")).toBeVisible();
  await expect(page.locator("[data-people-graph]")).not.toContainText(/friend-heat|closeness score/i);
  await expect(page.locator("[data-graph-score], [data-friend-heat], [data-closeness]")).toHaveCount(0);

  const stage = page.locator("[data-people-graph] .graph-stage");
  const box = await stage.boundingBox();
  expect(box, "graph fills the content area").toBeTruthy();
  expect(box!.height).toBeGreaterThan(360);
  expect(box!.width).toBeGreaterThan(700);

  await page.locator('[data-graph-node="ada-demo"]').click();
  await expect(page.getByRole("heading", { name: DEMO.person.title })).toBeVisible();
  await expect(page.locator("[data-people-graph]")).toHaveCount(0);
});
