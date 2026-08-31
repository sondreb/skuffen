import { createAdaDemo, expect, openDemo, openPersonTab, test } from "../helpers/app";

const BUNDLE_KEY = "skuffen.bundle.files";
const BLOBS_KEY = "skuffen.bundle.blobs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function diskSnapshot(page: import("@playwright/test").Page) {
  return page.evaluate(
    ({ filesKey, blobsKey }) => ({
      files: localStorage.getItem(filesKey),
      blobs: localStorage.getItem(blobsKey),
    }),
    { filesKey: BUNDLE_KEY, blobsKey: BLOBS_KEY },
  );
}

test("no profile photo hides diorama; people-list context menu has no diorama", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);

  await openPersonTab(page, "Photos");
  await expect(page.getByText("No photos yet.")).toBeVisible();
  await expect(page.locator("[data-diorama-action]")).toHaveCount(0);
  await expect(page.locator("[data-image-preview]")).toHaveCount(0);

  await page.locator("[data-person-row='ada-demo']").click({ button: "right" });
  await expect(page.locator("[data-person-menu]")).toBeVisible();
  await expect(page.locator("[data-delete-person-menu]")).toBeVisible();
  await expect(page.locator("[data-diorama-action]")).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "3D clay diorama" })).toHaveCount(0);
  await expect(page.locator("[data-diorama-menu]")).toHaveCount(0);
});

test("click profile photo opens preview; close writes nothing", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);

  await page.locator("#skuffen-profile-file").setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.locator("[data-profile-image] img")).toHaveAttribute("src", /^data:image\//);
  await expect(page.locator("[data-profile-image] [data-diorama-action]")).toBeVisible();

  const before = await diskSnapshot(page);

  await page.locator("[data-profile-preview]").click();
  await expect(page.locator("[data-image-preview]")).toBeVisible();
  await expect(page.locator("[data-image-preview-photo]")).toHaveAttribute("src", /^data:image\//);
  await expect(page.locator("[data-image-preview-photo]")).not.toHaveAttribute("src", /^https?:/);
  await expect(page.locator("[data-image-preview] [data-diorama-action]")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator("[data-image-preview]")).toHaveCount(0);
  await expect(await diskSnapshot(page)).toEqual(before);

  await page.locator("[data-profile-preview]").click();
  await expect(page.locator("[data-image-preview]")).toBeVisible();
  await page.locator("[data-preview-close]").click();
  await expect(page.locator("[data-image-preview]")).toHaveCount(0);
  await expect(await diskSnapshot(page)).toEqual(before);

  await page.locator("[data-profile-preview]").click();
  await page.locator("[data-image-preview]").click({ position: { x: 16, y: 200 } });
  await expect(page.locator("[data-image-preview]")).toHaveCount(0);
  await expect(await diskSnapshot(page)).toEqual(before);
});

test("click a gallery photo opens a local preview", async ({ demoPage: page }) => {
  await openDemo(page);
  await createAdaDemo(page);

  await page.locator("#skuffen-profile-file").setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await page.locator("#skuffen-photo-file").setInputFiles({
    name: "park.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.locator("[data-photos] article")).toHaveCount(2);

  const park = page.locator("[data-photos] article").filter({ hasText: "park.png" });
  await park.locator("[data-photo-open]").click();
  await expect(page.locator("[data-image-preview]")).toBeVisible();
  await expect(page.locator("[data-image-preview]")).toContainText("park.png");
  await expect(page.locator("[data-image-preview-photo]")).toHaveAttribute("src", /^data:image\//);
  await expect(page.locator("[data-image-preview-photo]")).not.toHaveAttribute("src", /^https?:/);
  await expect(page.locator("[data-image-preview] [data-diorama-action]")).toHaveCount(0);

  await page.locator("[data-preview-zoom-in]").click();
  await page.locator("[data-preview-close]").click();
  await expect(page.locator("[data-image-preview]")).toHaveCount(0);
});
