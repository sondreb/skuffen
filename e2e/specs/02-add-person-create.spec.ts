import { expect, openDemo, test } from "../helpers/app";

test("empty state and chrome Add person open Who? and save into the list", async ({ demoPage: page }) => {
  await openDemo(page);

  await page.locator("[data-add-person='empty']").click();
  await expect(page.locator("[data-create-form]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who?" })).toBeVisible();
  await expect(page.locator('input[name="person-name"]')).toBeFocused();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "No people yet" })).toBeVisible();

  await page.locator("[data-add-person='chrome']").click();
  await expect(page.locator("[data-create-form]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who?" })).toBeVisible();
  await expect(page.locator('input[name="person-name"]')).toBeFocused();
  await page.locator('input[name="person-name"]').fill("Ada Demo");
  await page.locator("[data-create-form]").getByRole("button", { name: "Add person" }).click();

  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();
  await expect(page.locator(".sidebar .person-card", { hasText: "Ada Demo" })).toBeVisible();
  await expect(page.locator(".file h1")).toHaveText("Ada Demo");

  await expect(page.locator("[data-add-person='list']")).toHaveCount(0);
  await expect(page.locator(".sidebar").getByRole("button", { name: "Add person" })).toHaveCount(0);
  await page.locator("[data-add-person='chrome']").click();
  await expect(page.locator("[data-create-form]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who?" })).toBeVisible();
  await expect(page.locator('input[name="person-name"]')).toBeFocused();
});
