import { expect, openDemo, test } from "../helpers/app";
import { hold } from "../helpers/labels";

test("name search Accept selected creates the card and shows a photo preview", async ({
  demoPage: page,
}) => {
  await openDemo(page);

  await page.getByPlaceholder("Find someone").fill("Ada Lovelace");
  await page.getByRole("button", { name: "Research" }).click();

  const sheet = page.locator("[data-name-proposal]");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Proposed card — not saved yet")).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
  await expect(sheet.getByText("Public park mention (demo)")).toBeVisible();
  await expect(sheet.locator(".fact-offer", { hasText: "ada.lovelace@example.invalid" })).toBeVisible();
  await expect(sheet.locator(".fact-offer", { hasText: "+1 555 0143" })).toBeVisible();
  await expect(sheet.getByText("field · email")).toBeVisible();
  await expect(sheet.getByText("field · phone")).toBeVisible();
  await expect(sheet.getByText("Public portrait (demo)")).toBeVisible();

  const preview = sheet.locator("[data-photo-preview]");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /\/assets\/skuffen-icon\.png$/);
  await expect(sheet.locator(".fact-offer p", { hasText: /https?:\/\// })).toHaveCount(0);

  await sheet.getByRole("button", { name: "Accept selected" }).click();

  await expect(page.locator("[data-name-proposal]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
  await expect(page.getByText("ada.lovelace@example.invalid")).toBeVisible();
  await expect(page.getByText("+1 555 0143")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Public park mention (demo)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Public portrait (demo)" })).toBeVisible();
  await expect(page.getByText("No photos yet.")).toHaveCount(0);
  await hold(page);
});
