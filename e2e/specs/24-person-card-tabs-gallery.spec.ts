import { createAdaDemo, expect, openDemo, openPersonTab, test } from "../helpers/app";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("person card tabs switch sections; photos and files are local galleries", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);

  const tabs = page.locator("[data-card-tabs]");
  await expect(tabs.getByRole("tab")).toHaveCount(7);
  await expect(tabs.getByRole("tab", { name: "About" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-card-panel='about']")).toBeVisible();
  await expect(page.locator("[data-card-panel='photos']")).toBeHidden();
  await expect(page.getByText("No notes yet.")).toBeVisible();

  await tabs.getByRole("tab", { name: "About" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Photos" })).toBeFocused();
  await expect(tabs.getByRole("tab", { name: "Photos" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-card-panel='photos']")).toBeVisible();
  await expect(page.locator("[data-card-panel='about']")).toBeHidden();
  await expect(page.getByText("No photos yet.")).toBeVisible();

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
  const thumbs = page.locator("[data-photos] .photo-thumb");
  await expect(page.locator("[data-photos] article")).toHaveCount(2);
  await expect(thumbs).toHaveCount(2);
  await expect(thumbs.first()).toHaveAttribute("src", /^data:image\//);
  await expect(thumbs.nth(1)).toHaveAttribute("src", /^data:image\//);
  await expect(thumbs.first()).not.toHaveAttribute("src", /^https?:/);
  await expect(thumbs.nth(1)).not.toHaveAttribute("src", /^https?:/);
  await expect(page.getByText("Profile image", { exact: true })).toBeVisible();

  const park = page.locator("[data-photos] article").filter({ hasText: "park.png" });
  await park.locator("[data-photo-open]").click();
  await expect(page.locator("[data-image-preview]")).toBeVisible();
  await expect(page.locator("[data-image-preview]")).toContainText("park.png");
  await expect(page.locator("[data-image-preview-photo]")).toHaveAttribute("src", /^data:image\//);
  await expect(page.locator("[data-image-preview-photo]")).not.toHaveAttribute("src", /^https?:/);
  await page.locator("[data-preview-close]").click();
  await expect(page.locator("[data-image-preview]")).toHaveCount(0);

  await page.locator("#skuffen-document-file").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("local file, not uploaded"),
  });
  await expect(page.locator("[data-card-panel='files']")).toBeVisible();
  await expect(page.locator("[data-files] article")).toHaveCount(1);
  await expect(page.locator("[data-files]").getByRole("heading", { name: "notes", exact: true })).toBeVisible();
  await expect(page.getByText("Land plot")).toHaveCount(0);
  await expect(page.getByText(/Linked:/)).toHaveCount(0);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("[data-file-open]").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("notes.txt");
  await expect(page.locator("[data-file-opened]")).toBeVisible();

  await openPersonTab(page, "Timeline");
  await expect(page.locator("[data-timeline]")).toBeVisible();
  await expect(page.locator("[data-timeline] [data-timeline-kind='photo']")).toHaveCount(2);
  await expect(page.locator("[data-card-panel='photos']")).toBeHidden();
  await expect(page.locator("[data-card-panel='files']")).toBeHidden();
});

test("person card tabs become a scrollable strip on a narrow viewport", async ({
  demoPage: page,
}) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await openDemo(page);
  await createAdaDemo(page);

  const expand = page.getByRole("button", { name: "Expand to names" });
  if (await expand.isVisible()) await expand.click();

  const tabs = page.locator("[data-card-tabs]");
  await expect(tabs).toBeVisible();
  await expect(tabs).toHaveCSS("flex-wrap", "nowrap");
  await expect(tabs).toHaveCSS("overflow-x", "auto");

  const box = await tabs.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    wrap: getComputedStyle(el).flexWrap,
    overflowX: getComputedStyle(el).overflowX,
  }));
  expect(box.wrap).toBe("nowrap");
  expect(box.overflowX).toBe("auto");
  expect(box.scrollWidth).toBeGreaterThan(box.clientWidth);

  await tabs.getByRole("tab", { name: "Relations" }).click();
  await expect(tabs.getByRole("tab", { name: "Relations" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-relations-empty]")).toBeVisible();
});
