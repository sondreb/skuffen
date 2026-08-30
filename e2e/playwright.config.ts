import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const demoRecord = Boolean(process.env.DEMO_RECORD);
const useDist = Boolean(process.env.E2E_DIST);
const headed = demoRecord && process.env.DEMO_HEADED === "1";

export default defineConfig({
  testDir: path.join(__dirname, "specs"),
  fullyParallel: !demoRecord,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: demoRecord ? 1 : undefined,
  timeout: demoRecord ? 90_000 : 45_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(__dirname, "../artifacts/demos/playwright"),
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1280, height: 720 },
    colorScheme: "dark",
    headless: !headed,
    trace: "off",
    screenshot: "off",
    video: demoRecord ? { mode: "on", size: { width: 1280, height: 720 } } : "off",
    launchOptions: headed ? { slowMo: 180 } : undefined,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } },
    },
  ],
  webServer: {
    command: useDist
      ? "python3 -m http.server 1420 --directory dist/skuffen/browser --bind 127.0.0.1"
      : "npm start -- --host 127.0.0.1",
    cwd: path.join(__dirname, ".."),
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
