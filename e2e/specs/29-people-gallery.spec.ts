import {
  createAdaDemo,
  createBeaDemo,
  expect,
  leavePersonCard,
  openDemo,
  openPeopleFromMenu,
  test,
} from "../helpers/app";
import { DEMO } from "../helpers/demo-data";

test("empty graph People view is a local empty state — no network people", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await expect(page.locator("[data-person-row]")).toHaveCount(0);

  await openPeopleFromMenu(page);
  await expect(page.locator("[data-people-gallery-empty]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
  await expect(page.getByText("No people yet")).toBeVisible();
  await expect(page.locator("[data-people-gallery-empty]")).toContainText(
    "does not fetch people from the network",
  );
  await expect(page.locator("[data-people-gallery-empty]")).toContainText("data:");
  await expect(page.locator("[data-people-gallery-thumb]")).toHaveCount(0);
  await expect(page.locator("[data-person-row]")).toHaveCount(0);
  await expect(page.locator("[data-people-gallery]")).not.toContainText(/friend-heat|closeness score/i);
  await expect(page.locator("[data-graph-score], [data-friend-heat], [data-closeness]")).toHaveCount(0);
});

test("Menu People shows large thumbs; filter hides others; click opens the card; dense mode exists", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);
  await createBeaDemo(page);

  await page.locator("[data-people-pane-toggle]").click();
  await expect(page.locator("[data-people-pane]")).toHaveAttribute("data-people-pane-collapsed", "true");

  await openPeopleFromMenu(page);
  await expect(page.locator("[data-people-gallery-empty]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
  await expect(page.locator("[data-people-gallery-stage]")).toHaveAttribute(
    "data-people-gallery-layout",
    "large",
  );
  await expect(page.locator('[data-people-gallery-thumb="ada-demo"]')).toBeVisible();
  await expect(page.locator('[data-people-gallery-thumb="bea-demo"]')).toBeVisible();
  await expect(page.locator("[data-people-gallery-thumb='ada-demo'] .gallery-caption")).toHaveText(
    DEMO.person.title,
  );
  await expect(page.locator("[data-people-gallery-thumb]")).toHaveCount(2);

  const stage = page.locator("[data-people-gallery-stage]");
  const box = await stage.boundingBox();
  expect(box, "People gallery fills the content area").toBeTruthy();
  expect(box!.height).toBeGreaterThan(360);
  expect(box!.width).toBeGreaterThan(700);

  await page.locator("[data-people-gallery-mode='dense']").click();
  await expect(page.locator("[data-people-gallery-stage]")).toHaveAttribute(
    "data-people-gallery-layout",
    "dense",
  );
  await expect(page.locator('[data-people-gallery-thumb="ada-demo"]')).toBeVisible();
  await expect(page.locator('[data-people-gallery-thumb="bea-demo"]')).toBeVisible();

  await page.locator("[data-people-gallery-filter]").fill("Ada");
  await expect(page.locator('[data-people-gallery-thumb="bea-demo"]')).toHaveCount(0);
  await expect(page.locator('[data-people-gallery-thumb="ada-demo"]')).toBeVisible();
  await expect(page.locator("[data-people-gallery]")).toBeVisible();
  await expect(page.locator("[data-people-gallery-filter]")).toBeVisible();

  await page.locator('[data-people-gallery-thumb="ada-demo"]').click();
  await expect(page.getByRole("heading", { name: DEMO.person.title })).toBeVisible();
  await expect(page.locator("[data-people-gallery]")).toHaveCount(0);
});

test("Menu People #tag filter uses person.tags and leaves others with the view still open", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);
  await createBeaDemo(page);
  await page.locator("[data-person-row='ada-demo']").click();
  await page.locator("[data-person-tag-input]").fill("family");
  await page.locator("[data-person-tag-input]").press("Enter");
  await expect(page.locator("[data-person-tag='family']")).toBeVisible();
  await leavePersonCard(page);

  await openPeopleFromMenu(page);
  await expect(page.locator('[data-people-gallery-thumb="ada-demo"]')).toBeVisible();
  await expect(page.locator('[data-people-gallery-thumb="bea-demo"]')).toBeVisible();

  await page.locator("[data-people-gallery-filter]").fill("#family");
  await expect(page.locator('[data-people-gallery-thumb="bea-demo"]')).toHaveCount(0);
  await expect(page.locator('[data-people-gallery-thumb="ada-demo"]')).toBeVisible();
  await expect(page.locator("[data-people-gallery]")).toBeVisible();

  await page.locator("[data-people-gallery-filter]").fill("# family");
  await expect(page.locator('[data-people-gallery-thumb="bea-demo"]')).toHaveCount(0);
  await expect(page.locator('[data-people-gallery-thumb="ada-demo"]')).toBeVisible();
  await expect(page.locator("[data-people-gallery]")).toBeVisible();
});
