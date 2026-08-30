import { createAdaDemo, expect, openDemo, test } from "../helpers/app";

test("new Ada Demo card shows empty Notes, Photos, Files, and Suggest copy", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);

  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(page.getByText("No timeline yet.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(page.getByText("No notes yet.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Threads" })).toBeVisible();
  await expect(page.getByText("No threads yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a thread" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Photos" })).toBeVisible();
  await expect(page.getByText("No photos yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Set profile image" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add photo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
  await expect(page.getByText("No files yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add file" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add land-plot document" })).toHaveCount(0);

  await page.locator("[data-demo='suggest']").click();
  await expect(page.getByText("No proposals yet.")).toBeVisible();
  await expect(page.getByText("Nothing is written until you accept.")).toHaveCount(0);

  await page.getByRole("button", { name: "Note" }).click();
  await page.locator('textarea[name="quick-note"]').fill("A slip about Ada Demo.");
  await page.getByRole("button", { name: "Pin note" }).click();
  await expect(page.getByRole("heading", { name: "A slip about Ada Demo." })).toBeVisible();
  await expect(page.getByText("No notes yet.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(page.getByText("No photos yet.")).toBeVisible();
});
