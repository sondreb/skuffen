import assert from "node:assert/strict";
import { test } from "node:test";
import { settingsWithoutSecrets } from "./research.ts";
import {
  NARROW_PEOPLE_PANE_MAX,
  collapsedFromSettings,
  defaultCollapsedForWidth,
  resolvePeoplePaneCollapsed,
} from "./people-pane.ts";

test("collapsedFromSettings reads a boolean and treats junk as unset", () => {
  assert.equal(collapsedFromSettings({}), null);
  assert.equal(collapsedFromSettings({ peoplePaneCollapsed: null }), null);
  assert.equal(collapsedFromSettings({ peoplePaneCollapsed: true }), true);
  assert.equal(collapsedFromSettings({ peoplePaneCollapsed: false }), false);
  assert.equal(collapsedFromSettings({ peoplePaneCollapsed: "true" as unknown as boolean }), null);
});

test("narrow windows default collapsed until the user pins a choice", () => {
  assert.equal(defaultCollapsedForWidth(0), false);
  assert.equal(defaultCollapsedForWidth(Number.NaN), false);
  assert.equal(defaultCollapsedForWidth(NARROW_PEOPLE_PANE_MAX - 1), true);
  assert.equal(defaultCollapsedForWidth(NARROW_PEOPLE_PANE_MAX), false);
  assert.equal(defaultCollapsedForWidth(1280), false);
  assert.equal(resolvePeoplePaneCollapsed(null, 900), true);
  assert.equal(resolvePeoplePaneCollapsed(null, 1280), false);
  assert.equal(resolvePeoplePaneCollapsed(false, 900), false);
  assert.equal(resolvePeoplePaneCollapsed(true, 1600), true);
});

test("people pane collapse persists in settings — never provider tokens, never OKF", () => {
  const persisted = settingsWithoutSecrets({
    bundleRoot: "/tmp/people-graph",
    selfSlug: "ada-demo",
    theme: "light",
    peoplePaneCollapsed: true,
    grok_api_key: "xai-leaked",
    access_token: "oauth-leaked",
    apiKey: "AIza-leaked",
  });
  const json = JSON.stringify(persisted);
  assert.equal(persisted.peoplePaneCollapsed, true);
  assert.match(json, /"peoplePaneCollapsed":true/);
  assert.doesNotMatch(json, /xai-leaked|oauth-leaked|AIza-leaked|grok_api_key|access_token|apiKey/);
  assert.doesNotMatch(json, /localStorage/);
  assert.doesNotMatch(json, /people-graph upload|analytics/i);
});
