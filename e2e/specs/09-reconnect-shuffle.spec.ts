import { DEMO } from "../helpers/demo-data";
import { createAdaDemo, createBeaDemo, expect, openDemo, pinNote, test } from "../helpers/app";
import { hold, showDemoLabel } from "../helpers/labels";

test("local reconnect suggestions from notes; pick drafts; skip/dismiss write nothing; Accept saves; nothing is sent", async ({
  demoPage: page,
}) => {
  await openDemo(page);
  await createAdaDemo(page);
  await pinNote(page, "Asked about the park pin and the land-plot slip.", "Last coffee");
  await page.getByRole("button", { name: "Drawer" }).click();

  await createBeaDemo(page);
  await pinNote(page, DEMO.bea.noteBody, DEMO.bea.noteTitle);

  await showDemoLabel(page, "Two local reconnects — nothing sent");
  await page.getByRole("button", { name: "Latch" }).click();
  await page.locator("[data-demo='open-shuffle']").click();

  await expect(page.getByRole("heading", { name: "Reconnect Shuffle" })).toBeVisible();
  await expect(page.locator("[data-demo='shuffle-panel']")).toBeVisible();
  await expect(page.locator("[data-demo='shuffle-deck']")).toContainText("Ada Demo");
  await expect(page.locator("[data-demo='shuffle-deck']")).toContainText("Bea Demo");
  await expect(page.locator("[data-demo='shuffle-deck']")).toContainText("Last coffee");
  await expect(page.locator("[data-demo='shuffle-deck']")).toContainText("Studio visit");
  await expect(page.getByText(/Never auto-sends/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Send/i })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Reconnect draft — Ada Demo" })).toHaveCount(0);

  await page.locator("[data-demo='shuffle-pick-ada-demo']").click();
  await expect(page.locator("[data-demo='shuffle-draft']")).toBeVisible();
  await expect(page.locator("[data-demo='shuffle-draft']")).toContainText("Ada Demo");
  await expect(page.locator("[data-demo='shuffle-draft-text']")).toHaveValue(/Last coffee|park pin/);
  await expect(page.locator("[data-demo='shuffle-draft-text']")).not.toHaveValue(/Bea Demo|Studio visit/);
  await expect(page.getByText("Local draft — not sent")).toBeVisible();

  await showDemoLabel(page, "Dismiss writes nothing");
  await page.locator("[data-demo='shuffle-dismiss']").click();
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Last coffee" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reconnect draft — Ada Demo" })).toHaveCount(0);

  await page.getByRole("button", { name: "Latch" }).click();
  await page.locator("[data-demo='open-shuffle']").click();
  await page.locator("[data-demo='shuffle-pick-ada-demo']").click();
  await page.locator("[data-demo='shuffle-polish']").click();
  await expect(page.locator("[data-demo='shuffle-draft-text']")).toHaveValue(/^Polish:/);

  await showDemoLabel(page, "Skip writes nothing");
  await page.locator("[data-demo='shuffle-skip']").click();
  await expect(page.locator("[data-demo='shuffle-deck']")).toContainText("Bea Demo");
  await expect(page.locator("[data-demo='shuffle-deck']")).not.toContainText("Ada Demo");

  await page.locator("[data-demo='shuffle-dismiss']").click();
  await page.getByRole("button", { name: "Drawer" }).click();
  await page.locator(".person-card b").filter({ hasText: /^Ada Demo$/ }).click();
  await expect(page.getByRole("heading", { name: "Last coffee" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reconnect draft — Ada Demo" })).toHaveCount(0);

  await page.getByRole("button", { name: "Latch" }).click();
  await page.locator("[data-demo='open-shuffle']").click();
  await page.locator("[data-demo='shuffle-pick-bea-demo']").click();
  await expect(page.locator("[data-demo='shuffle-draft-text']")).toHaveValue(/Bea Demo|Studio visit|land-plot/);

  await showDemoLabel(page, "Accept saves the draft as a note");
  await page.locator("[data-demo='shuffle-accept']").click();
  await expect(page.getByRole("heading", { name: "Reconnect draft — Bea Demo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: DEMO.bea.noteTitle })).toBeVisible();
  await expect(page.getByText(/Drafted on this machine from the OKF card|Polish:/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Send/i })).toHaveCount(0);
  await hold(page);
});

test("demo mode can show two synthetic reconnect suggestions without live keys", async ({ demoPage: page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Latch" }).click();
  await page.locator("[data-demo='open-shuffle']").click();
  await page.locator("[data-demo='shuffle-seed']").click();

  await expect(page.locator("[data-demo='shuffle-deck']")).toContainText("Ada Demo");
  await expect(page.locator("[data-demo='shuffle-deck']")).toContainText("Bea Demo");
  await expect(page.locator("[data-demo='shuffle-deck']")).toContainText("Last coffee (demo)");
  await expect(page.locator("[data-demo='shuffle-deck']")).toContainText("Studio visit (demo)");
  await expect(page.getByRole("button", { name: /^Send/i })).toHaveCount(0);
  await hold(page);
});
