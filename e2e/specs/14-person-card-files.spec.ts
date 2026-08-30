import { createAdaDemo, expect, openDemo, test } from "../helpers/app";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("person card can set a local profile image, add gallery photos, and attach a file", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);

  await page.getByRole("button", { name: "Drop" }).click();
  await expect(page.getByRole("button", { name: "Add land-plot document" })).toHaveCount(0);
  await expect(page.getByLabel("Kind")).toHaveCount(0);
  await expect(page.getByText("Land plot")).toHaveCount(0);

  await page.locator("#skuffen-profile-file").setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.getByRole("button", { name: "Change profile image" })).toBeVisible();
  await expect(page.locator("[data-profile-image] img")).toHaveAttribute("src", /^data:image\//);
  await expect(page.locator(".person-card img")).toHaveAttribute("src", /^data:image\//);
  await expect(page.locator(".person-card img")).not.toHaveAttribute("src", /^https?:/);

  await page.locator("#skuffen-photo-file").setInputFiles({
    name: "park.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.locator("[data-photos] article")).toHaveCount(2);
  await expect(page.getByText("Profile image", { exact: true })).toBeVisible();

  await page.locator("[data-photos] article").filter({ hasText: "park.png" }).getByRole("button", { name: "Remove" }).click();
  await expect(page.locator("[data-photos] article")).toHaveCount(1);
  await expect(page.locator(".person-card img")).toHaveAttribute("src", /^data:image\//);

  await page.locator("#skuffen-document-file").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("local file, not uploaded"),
  });
  await expect(page.locator("[data-files] article")).toHaveCount(1);
  await expect(page.locator("[data-files]").getByRole("heading", { name: "notes", exact: true })).toBeVisible();
  await expect(page.getByText("No files yet.")).toHaveCount(0);
});
