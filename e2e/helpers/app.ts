import { expect, test as base, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DEMO } from "./demo-data";

export { expect };

const ARTIFACTS = path.join(process.cwd(), "artifacts", "demos");

const TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export const test = base.extend<{ demoPage: Page }>({
  demoPage: async ({ page }, use, testInfo) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await stubNetwork(page);
    await use(page);
    if (!process.env.DEMO_RECORD) return;
    await mkdir(ARTIFACTS, { recursive: true });
    const video = page.video();
    const slug = testInfo.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    await page.close();
    if (video) {
      await video.saveAs(path.join(ARTIFACTS, `${slug}.webm`));
    }
  },
});

export async function stubNetwork(page: Page): Promise<void> {
  await page.route("https://nominatim.openstreetmap.org/**", async (route) => {
    const hit = {
      lat: String(DEMO.park.latitude),
      lon: String(DEMO.park.longitude),
      display_name: DEMO.park.label,
    };
    const url = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json",
      },
      body: JSON.stringify(url.includes("/reverse") ? hit : [hit]),
    });
  });

  if (!process.env.DEMO_RECORD) {
    await page.route("https://tile.openstreetmap.org/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "image/png", body: TILE_PNG });
    });
  }

  await page.route("https://api.x.ai/**", (route) => route.abort());
  await page.route("https://generativelanguage.googleapis.com/**", (route) => route.abort());
  await page.route("https://api.github.com/**", (route) => route.abort());
}

export async function openDemo(page: Page): Promise<void> {
  await page.goto("/?demo=1");
  await expect(page.getByRole("heading", { name: "The drawer is empty" })).toBeVisible({
    timeout: 30_000,
  });
}

export async function createAdaDemo(page: Page): Promise<void> {
  await page.locator("[data-demo='put-someone-in']").first().click();
  await expect(page.getByRole("heading", { name: "Who?" })).toBeVisible();
  await page.locator('input[name="person-name"]').fill(DEMO.person.title);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByLabel("How you know them").fill(DEMO.person.description);
  await page.locator("[data-demo='save-person']").click();
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();
}
