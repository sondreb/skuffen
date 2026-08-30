import { expect, test as base, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DEMO } from "./demo-data";

export { expect };

const ARTIFACTS = path.join(process.cwd(), "artifacts", "demos");
const README_MEDIA = path.join(process.cwd(), "docs", "media");

const TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Live AI hosts. E2E/demo must never call these. */
const LIVE_AI_PREFIXES = [
  "https://api.x.ai/",
  "https://generativelanguage.googleapis.com/",
  "https://generativelanguage.google.com/",
];

const BLOCKED_HOST_PREFIXES = [
  ...LIVE_AI_PREFIXES,
  "https://auth.x.ai/",
];

type PageWithHits = Page & { __skuffenAiHits?: string[] };

export const test = base.extend<{ demoPage: Page }>({
  demoPage: async ({ page }, use, testInfo) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await stubNetwork(page);
    await use(page);
    assertNoLiveAi(page);
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
  const hits: string[] = [];
  (page as PageWithHits).__skuffenAiHits = hits;
  page.on("request", (request) => {
    const url = request.url();
    if (LIVE_AI_PREFIXES.some((prefix) => url.startsWith(prefix))) {
      hits.push(url);
    }
  });

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

  for (const prefix of BLOCKED_HOST_PREFIXES) {
    await page.route(`${prefix}**`, (route) => route.abort());
  }
  await page.route("https://api.github.com/**", (route) => route.abort());
}

export function assertNoLiveAi(page: Page): void {
  const hits = (page as PageWithHits).__skuffenAiHits ?? [];
  expect(hits, `live AI calls are forbidden in e2e/demo: ${hits.join(", ")}`).toEqual([]);
}

/** 1280×720 still for the README. Only written during `demo:record`. */
export async function captureReadmeStill(page: Page, filename: string): Promise<void> {
  if (!process.env.DEMO_RECORD) return;
  await mkdir(README_MEDIA, { recursive: true });
  await mkdir(ARTIFACTS, { recursive: true });
  const dest = path.join(README_MEDIA, filename);
  await page.screenshot({ path: dest, type: "png" });
  await page.screenshot({ path: path.join(ARTIFACTS, filename), type: "png" });
}

export async function openDemo(page: Page): Promise<void> {
  await page.goto("/?demo=1");
  await expect(page.getByRole("heading", { name: "The drawer is empty" })).toBeVisible({
    timeout: 30_000,
  });
}

export async function fillAdaDemoForm(page: Page): Promise<void> {
  await page.locator("[data-demo='put-someone-in']").first().click();
  await expect(page.getByRole("heading", { name: "Who?" })).toBeVisible();
  await page.locator('input[name="person-name"]').fill(DEMO.person.title);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByLabel("How you know them").fill(DEMO.person.description);
  await page.getByLabel("Email").fill(DEMO.person.email);
}

export async function createAdaDemo(page: Page): Promise<void> {
  await fillAdaDemoForm(page);
  await page.locator("[data-demo='save-person']").click();
  await expect(page.getByRole("heading", { name: "Ada Demo" })).toBeVisible();
}

export async function seedDemoMergePair(page: Page): Promise<void> {
  await page.locator("[data-demo='put-matching-card']").first().click();
  await expect(page.locator("[data-merge-proposal]")).toBeVisible();
  await expect(page.getByText("Proposed merge — nothing happens until you Accept")).toBeVisible();
}
