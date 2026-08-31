import {
  createAdaDemo,
  createBeaDemo,
  expect,
  leavePersonCard,
  openDemo,
  openPeopleFromNav,
  test,
} from "../helpers/app";
import { DEMO } from "../helpers/demo-data";

const BUNDLE_KEY = "skuffen.bundle.files";

test("People is a primary nav destination; profile People returns to the gallery, not Home", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);
  await createBeaDemo(page);

  await expect(page.locator("[data-open-people='chrome']")).toBeVisible();
  await expect(page.locator(".chrome [data-open-people='chrome']")).toHaveText("People");

  await openPeopleFromNav(page);
  await expect(page.locator("[data-people-gallery]")).toBeVisible();
  await expect(page.locator('[data-people-gallery-thumb="ada-demo"]')).toBeVisible();
  await expect(page.getByText("Select someone from the list.")).toHaveCount(0);

  await page.locator('[data-people-gallery-thumb="ada-demo"]').click();
  await expect(page.getByRole("heading", { name: DEMO.person.title })).toBeVisible();
  await expect(page.locator("[data-people-gallery]")).toHaveCount(0);

  await leavePersonCard(page);
  await expect(page.locator("[data-people-gallery]")).toBeVisible();
  await expect(page.locator('[data-people-gallery-thumb="ada-demo"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: DEMO.person.title })).toHaveCount(0);
  await expect(page.getByText("Select someone from the list.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No people yet" })).toHaveCount(0);
});

test("chrome back/forward walk in-app history; logo opens Menu; filter does not cover thumbs", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await expect(page.locator("[data-nav-back]")).toBeDisabled();
  await expect(page.locator("[data-nav-forward]")).toBeDisabled();

  await page.locator("[data-open-menu]").click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await expect(page.locator("[data-open-people='menu']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Providers" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
  await expect(page.locator(".chrome .menu-btn")).toHaveCount(0);

  await createAdaDemo(page);
  await createBeaDemo(page);
  await openPeopleFromNav(page);

  const header = page.locator("[data-people-gallery] .map-chrome");
  const thumb = page.locator('[data-people-gallery-thumb="ada-demo"]');
  await expect(header).toBeVisible();
  await expect(thumb).toBeVisible();
  const headerBox = await header.boundingBox();
  const thumbBox = await thumb.boundingBox();
  expect(headerBox, "filter header is on screen").toBeTruthy();
  expect(thumbBox, "gallery thumb is on screen").toBeTruthy();
  expect(thumbBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);

  const beforeOpen = await page.evaluate((key) => localStorage.getItem(key), BUNDLE_KEY);
  await page.locator('[data-people-gallery-thumb="ada-demo"]').click();
  await expect(page.getByRole("heading", { name: DEMO.person.title })).toBeVisible();
  await expect(page.locator("[data-nav-back]")).toBeEnabled();
  await expect(page.locator("[data-nav-forward]")).toBeDisabled();

  await page.locator("[data-nav-back]").click();
  await expect(page.locator("[data-people-gallery]")).toBeVisible();
  await expect(page.getByRole("heading", { name: DEMO.person.title })).toHaveCount(0);
  await expect(page.getByText("Select someone from the list.")).toHaveCount(0);
  await expect(page.locator("[data-nav-forward]")).toBeEnabled();

  await page.locator("[data-nav-forward]").click();
  await expect(page.getByRole("heading", { name: DEMO.person.title })).toBeVisible();
  await expect(page.locator("[data-people-gallery]")).toHaveCount(0);

  const afterNav = await page.evaluate((key) => localStorage.getItem(key), BUNDLE_KEY);
  expect(afterNav).toBe(beforeOpen);
});
