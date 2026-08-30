import { createAdaDemo, expect, openDemo, test } from "../helpers/app";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("after diorama is set, control is gone; removing that photo brings it back", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);

  await expect(page.getByText("No photos yet.")).toBeVisible();
  await expect(page.locator("[data-diorama-action]")).toHaveCount(0);

  await page.locator("#skuffen-profile-file").setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.locator("[data-profile-image] [data-diorama-action]")).toBeVisible();

  await page.locator("[data-profile-preview]").click();
  await expect(page.locator("[data-image-preview] [data-diorama-action]")).toBeVisible();
  await page.locator("[data-preview-close]").click();

  await page.locator("[data-profile-image] [data-diorama-action]").click();
  await expect(page.getByRole("heading", { name: "3D clay diorama" })).toBeVisible();
  await expect(page.locator("[data-photo-profile]")).toContainText("3D clay diorama");
  await expect(page.locator("[data-profile-image] [data-diorama-action]")).toHaveCount(0);

  await page.locator("[data-profile-preview]").click();
  await expect(page.locator("[data-image-preview]")).toBeVisible();
  await expect(page.locator("[data-image-preview] [data-diorama-action]")).toHaveCount(0);
  await page.locator("[data-preview-close]").click();

  await page.locator("#skuffen-profile-file").setInputFiles({
    name: "other.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.getByRole("heading", { name: "other.png" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change profile image" })).toBeVisible();
  await expect(page.locator("[data-photo-profile]")).toContainText("other.png");
  await expect(page.locator("[data-photos] article").filter({ hasText: "3D clay diorama" })).toBeVisible();
  await expect(page.locator("[data-profile-image] [data-diorama-action]")).toHaveCount(0);

  await page.locator("[data-person-row='ada-demo']").click({ button: "right" });
  await expect(page.locator("[data-person-menu]")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "3D clay diorama" })).toHaveCount(0);
  await expect(page.locator("[data-diorama-menu]")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page
    .locator("[data-photos] article")
    .filter({ hasText: "3D clay diorama" })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.locator("[data-photos] article").filter({ hasText: "3D clay diorama" })).toHaveCount(0);
  await expect(page.locator("[data-profile-image] [data-diorama-action]")).toBeVisible();

  await page.locator("[data-profile-preview]").click();
  await expect(page.locator("[data-image-preview] [data-diorama-action]")).toBeVisible();
  await page.locator("[data-preview-close]").click();
});
