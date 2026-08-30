import assert from "node:assert/strict";
import { test } from "node:test";
import { settingsWithoutSecrets } from "./research.ts";
import {
  applyThemeToDocument,
  normalizeThemePreference,
  resolveTheme,
  systemPrefersDark,
  themeFromSettings,
} from "./theme.ts";

test("normalizeThemePreference accepts auto, light, dark and treats junk as auto", () => {
  assert.equal(normalizeThemePreference("auto"), "auto");
  assert.equal(normalizeThemePreference("light"), "light");
  assert.equal(normalizeThemePreference("dark"), "dark");
  assert.equal(normalizeThemePreference("  Dark  "), "dark");
  assert.equal(normalizeThemePreference("teal"), "auto");
  assert.equal(normalizeThemePreference(""), "auto");
  assert.equal(normalizeThemePreference(null), "auto");
  assert.equal(normalizeThemePreference(undefined), "auto");
  assert.equal(normalizeThemePreference(12), "auto");
});

test("themeFromSettings reads the preference without a cloud identity", () => {
  assert.equal(themeFromSettings({}), "auto");
  assert.equal(themeFromSettings({ theme: null }), "auto");
  assert.equal(themeFromSettings({ theme: "light" }), "light");
  assert.equal(themeFromSettings({ theme: "dark" }), "dark");
});

test("resolveTheme pins Light or Dark and otherwise follows the OS", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("light", false), "light");
  assert.equal(resolveTheme("dark", true), "dark");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("auto", true), "dark");
  assert.equal(resolveTheme("auto", false), "light");
});

test("systemPrefersDark reads matchMedia.matches only", () => {
  assert.equal(systemPrefersDark(null), false);
  assert.equal(systemPrefersDark(undefined), false);
  assert.equal(systemPrefersDark({ matches: true }), true);
  assert.equal(systemPrefersDark({ matches: false }), false);
});

test("applyThemeToDocument sets resolved theme, preference, and color-scheme", () => {
  const root = { dataset: {} as Record<string, string>, style: { colorScheme: "" } };
  applyThemeToDocument(root, "auto", "dark");
  assert.equal(root.dataset["theme"], "dark");
  assert.equal(root.dataset["themePreference"], "auto");
  assert.equal(root.style.colorScheme, "dark");
  applyThemeToDocument(root, "light", "light");
  assert.equal(root.dataset["theme"], "light");
  assert.equal(root.dataset["themePreference"], "light");
  assert.equal(root.style.colorScheme, "light");
});

test("theme persists in settings — never provider tokens, never OKF, never localStorage as a key", () => {
  const persisted = settingsWithoutSecrets({
    bundleRoot: "/tmp/people-graph",
    selfSlug: "ada-demo",
    theme: "light",
    grok_api_key: "xai-leaked",
    access_token: "oauth-leaked",
    apiKey: "AIza-leaked",
  });
  const json = JSON.stringify(persisted);
  assert.equal(persisted.theme, "light");
  assert.match(json, /"theme":"light"/);
  assert.doesNotMatch(json, /xai-leaked|oauth-leaked|AIza-leaked|grok_api_key|access_token|apiKey/);
  assert.doesNotMatch(json, /localStorage/);
  assert.doesNotMatch(json, /people-graph upload|analytics/i);
});
