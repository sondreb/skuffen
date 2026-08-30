import { createAdaDemo, createBeaDemo, expect, openDemo, test } from "../helpers/app";
import { DEMO } from "../helpers/demo-data";

test("left pane filters local people; Add person owns research and More spacing", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);
  await createBeaDemo(page);

  const sidebar = page.locator(".sidebar");
  await expect(sidebar.locator(".person-card", { hasText: DEMO.person.title })).toBeVisible();
  await expect(sidebar.locator(".person-card", { hasText: DEMO.bea.title })).toBeVisible();

  await page.locator("[data-people-filter]").fill("Ada");
  await expect(sidebar.locator(".person-card", { hasText: DEMO.person.title })).toBeVisible();
  await expect(sidebar.locator(".person-card", { hasText: DEMO.bea.title })).toHaveCount(0);

  await expect(sidebar.getByRole("button", { name: "Research" })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "AI Powered Search" })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "Add person" })).toHaveCount(0);

  await page.locator("[data-people-filter]").fill("Nobody");
  await page.locator("[data-people-filter]").press("Enter");
  await expect(page.locator("[data-name-proposal]")).toHaveCount(0);
  await expect(sidebar.getByText("No one by that name in this graph.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Proposed card — not saved yet" })).toHaveCount(0);

  await page.locator("[data-add-person='chrome']").click();
  await expect(page.locator("[data-create-form]")).toBeVisible();
  await expect(page.getByRole("button", { name: "AI Powered Search" })).toBeVisible();

  const more = page.locator("[data-create-more]");
  const add = page.locator("[data-create-form] .create-actions").getByRole("button", { name: "Add person" });
  await expect(more).toBeVisible();
  const moreBox = await more.boundingBox();
  const addBox = await add.boundingBox();
  expect(moreBox, "More button should be laid out").toBeTruthy();
  expect(addBox, "Add person should be laid out").toBeTruthy();
  expect((addBox?.y ?? 0) - ((moreBox?.y ?? 0) + (moreBox?.height ?? 0))).toBeGreaterThanOrEqual(12);

  await page.locator('input[name="person-name"]').fill("Ada Lovelace");
  await page.getByRole("button", { name: "AI Powered Search" }).click();
  await expect(page.locator("[data-name-proposal]")).toBeVisible();
  await expect(page.getByText("Proposed card — not saved yet")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
});
