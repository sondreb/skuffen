import {
  createAdaDemo,
  createParkPlace,
  expect,
  openDemo,
  openMapFromMenu,
  openPersonTab,
  openPlacesFromMenu,
  pinPersonPlace,
  test,
} from "../helpers/app";
import { DEMO } from "../helpers/demo-data";

const BUNDLE_KEY = "skuffen.bundle.files";

async function bundleFiles(page: import("@playwright/test").Page): Promise<Record<string, string>> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), BUNDLE_KEY);
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, string>;
}

test("empty Places is a local empty state — no network places", async ({ demoPage: page }) => {
  await openDemo(page);
  await openPlacesFromMenu(page);
  await expect(page.locator("[data-places-empty]")).toBeVisible();
  await expect(page.getByText("No places yet")).toBeVisible();
  await expect(page.locator("[data-places-empty]")).toContainText("does not fetch places from the network");
  await expect(page.locator("[data-place-row]")).toHaveCount(0);
  await expect(page.locator("[data-places]")).not.toContainText(/skuffen\.cloud|land-plot/i);
});

test("create a Place locally and link a person; map prefers that Place pin", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await openPlacesFromMenu(page);
  await createParkPlace(page);
  const afterCreate = await bundleFiles(page);
  expect(afterCreate["places/golden-gate-park/place.md"]).toMatch(/type: Place/);
  expect(afterCreate["places/golden-gate-park/place.md"]).toMatch(/Golden Gate Park/);
  expect(afterCreate["places/golden-gate-park/place.md"]).not.toMatch(/token|secret|land-plot|skuffen\.cloud/i);

  await page.locator("[data-open-places]").first().click();
  await expect(page.locator("[data-place-row='golden-gate-park']")).toBeVisible();

  await createAdaDemo(page);
  await openPersonTab(page, "Places");
  await expect(page.locator("[data-person-places-empty]")).toBeVisible();
  await page.locator("[data-add-place-link-open]").click();
  await page.locator("[data-place-link-target]").selectOption({ label: DEMO.place.title });
  await page.locator("[data-place-link-role]").selectOption("lives");
  await page.locator("[data-place-link-save]").click();
  await expect(page.locator("[data-place-link='golden-gate-park']")).toBeVisible();
  await expect(page.locator("[data-place-link='golden-gate-park']")).toContainText("Lives");

  const afterLink = await bundleFiles(page);
  expect(afterLink["people/ada-demo/place-links.md"]).toMatch(/type: PlaceLinks/);
  expect(afterLink["people/ada-demo/place-links.md"]).toMatch(/places\/golden-gate-park\/place\.md/);
  expect(afterLink["people/ada-demo/place-links.md"]).toMatch(/lives/);

  await openMapFromMenu(page);
  await expect(page.locator("[data-map-empty]")).toHaveCount(0);
  await expect(page.locator('[data-map-pin="golden-gate-park"]')).toBeVisible();
  await expect(page.locator('[data-map-pin-kind="place"]')).toBeVisible();
  await expect(page.locator('[data-map-pin="ada-demo"]')).toHaveCount(0);

  await page.locator('[data-map-pin="golden-gate-park"]').click();
  await expect(page.locator("[data-place-card]")).toBeVisible();
  await expect(page.getByRole("heading", { name: DEMO.place.title })).toBeVisible();
});

test("people without a Place still show from people/{slug}/place.md", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);
  await pinPersonPlace(page, DEMO.park);
  await openMapFromMenu(page);
  await expect(page.locator('[data-map-pin="ada-demo"]')).toBeVisible();
  await expect(page.locator('[data-map-pin-kind="place"]')).toHaveCount(0);
});

test("Accept is required for a model-proposed Place; uncheck writes nothing", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);
  await page.getByRole("button", { name: "Suggest", exact: true }).click();
  await page.locator("[data-demo='suggest-facts']").click();
  await page.locator("[data-demo='research']").click();
  const placeOffer = page.locator("[data-suggestion-kind='place']");
  await expect(placeOffer).toHaveCount(1);
  await expect(placeOffer.getByText("Golden Gate Park (demo)")).toBeVisible();
  await expect(page.getByText("Nothing is written until you accept.")).toBeVisible();

  await placeOffer.getByRole("checkbox").uncheck();
  await page.locator("[data-demo='accept']").click();
  const afterUncheck = await bundleFiles(page);
  expect(Object.keys(afterUncheck).some((path) => path.startsWith("places/"))).toBe(false);
  expect(afterUncheck["people/ada-demo/place-links.md"]).toBeUndefined();

  await page.locator("[data-demo='suggest-facts']").click();
  await page.locator("[data-demo='research']").click();
  const again = page.locator("[data-suggestion-kind='place']");
  await expect(again).toBeVisible();
  await again.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("[data-suggestion-kind='place']")).toHaveCount(0);
  await page.locator("[data-demo='accept']").click();
  const afterReject = await bundleFiles(page);
  expect(Object.keys(afterReject).some((path) => path.startsWith("places/"))).toBe(false);

  await page.locator("[data-demo='suggest-facts']").click();
  await page.locator("[data-demo='research']").click();
  await expect(page.locator("[data-suggestion-kind='place']")).toBeVisible();
  await page.locator("[data-demo='accept']").click();
  const afterAccept = await bundleFiles(page);
  expect(afterAccept["places/golden-gate-park/place.md"]).toMatch(/type: Place/);
  expect(afterAccept["people/ada-demo/place-links.md"]).toMatch(/met-at/);
  await openPersonTab(page, "Places");
  await expect(page.locator("[data-place-link='golden-gate-park']")).toBeVisible();
});
