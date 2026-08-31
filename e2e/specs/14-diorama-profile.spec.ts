import { createAdaDemo, expect, openDemo, openPersonTab, test } from "../helpers/app";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("without Grok, 3D clay diorama opens Menu → Providers and writes nothing", async ({
  demoPage: page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "No people yet" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "Add person" }).first().click();
  await expect(page.getByRole("heading", { name: "Who?" })).toBeVisible();
  await page.locator('input[name="person-name"]').fill("Ada Demo");
  await page.locator("[data-create-form] button.brass").click();
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();
  await openPersonTab(page, "Photos");
  await expect(page.getByText("No photos yet.")).toBeVisible();
  await expect(page.locator("[data-diorama-action]")).toHaveCount(0);

  await page.locator("#skuffen-profile-file").setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.locator("[data-profile-image] [data-diorama-action]")).toBeVisible();
  await page.locator("[data-profile-image] [data-diorama-action]").click();

  await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible();
  await expect(page.getByText("Connect Grok in Menu → Providers first.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "3D clay diorama" })).toHaveCount(0);
});

test("demo diorama becomes the local profile and keeps the previous photo", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);

  await expect(page.locator("[data-diorama-action]")).toHaveCount(0);
  await openPersonTab(page, "Photos");
  await expect(page.getByText("No photos yet.")).toBeVisible();

  await page.locator("#skuffen-profile-file").setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.getByRole("button", { name: "Change profile image" })).toBeVisible();
  await expect(page.locator("[data-profile-image] img")).toBeVisible();
  await expect(page.locator("[data-profile-image] img")).toHaveAttribute("src", /^data:image\//);
  await expect(page.locator("[data-person-row='ada-demo'] img")).toHaveAttribute("src", /^data:image\//);
  await expect(page.getByRole("heading", { name: "portrait.png" })).toBeVisible();

  await expect(page.locator("[data-profile-image] [data-diorama-action]")).toBeVisible();
  await page.locator("[data-profile-image] [data-diorama-action]").click();

  await expect(page.getByText("Making 3D clay diorama…")).toBeVisible();
  await expect(page.getByRole("heading", { name: "3D clay diorama" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "portrait.png" })).toBeVisible();
  await expect(page.locator("[data-photo-profile]")).toContainText("3D clay diorama");
  await expect(page.locator("[data-photo-profile]")).not.toContainText("portrait.png");
  await expect(page.getByText("No photos yet.")).toHaveCount(0);
  await expect(page.locator("[data-photos] article")).toHaveCount(2);

  const profileSrc = page.locator("[data-profile-image] img");
  const listSrc = page.locator("[data-person-row='ada-demo'] img");
  await expect(profileSrc).toHaveAttribute("src", /^data:image\//);
  await expect(listSrc).toHaveAttribute("src", /^data:image\//);
  await expect(profileSrc).not.toHaveAttribute("src", /^https?:/);
  await expect(listSrc).not.toHaveAttribute("src", /^https?:/);
});
