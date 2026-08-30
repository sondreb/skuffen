import assert from "node:assert/strict";
import { test } from "node:test";
import { settingsWithoutSecrets } from "./research.ts";
import {
  forgetSelf,
  isSelf,
  markSelf,
  normalizeSelfSlug,
  retargetSelf,
  selfSlugFromSettings,
  unmarkSelf,
} from "./self.ts";

test("normalizeSelfSlug trims and treats blank as unset", () => {
  assert.equal(normalizeSelfSlug("ada-demo"), "ada-demo");
  assert.equal(normalizeSelfSlug("  ada-demo  "), "ada-demo");
  assert.equal(normalizeSelfSlug(""), null);
  assert.equal(normalizeSelfSlug("   "), null);
  assert.equal(normalizeSelfSlug(null), null);
  assert.equal(normalizeSelfSlug(undefined), null);
  assert.equal(normalizeSelfSlug(12), null);
});

test("markSelf keeps only one owner and moves the mark", () => {
  assert.equal(markSelf(null, "ada-demo"), "ada-demo");
  assert.equal(markSelf("ada-demo", "bea-demo"), "bea-demo");
  assert.equal(markSelf("bea-demo", "  "), null);
});

test("unmarkSelf clears the local owner", () => {
  assert.equal(unmarkSelf(), null);
  assert.equal(isSelf("ada-demo", "ada-demo"), true);
  assert.equal(isSelf("ada-demo", "bea-demo"), false);
  assert.equal(isSelf(null, "ada-demo"), false);
  assert.equal(isSelf("  ", "ada-demo"), false);
});

test("later features can read selfSlug from settings without a cloud identity", () => {
  assert.equal(selfSlugFromSettings({}), null);
  assert.equal(selfSlugFromSettings({ selfSlug: null }), null);
  assert.equal(selfSlugFromSettings({ selfSlug: "ada-demo" }), "ada-demo");
});

test("merge retargets the owner slug; forget drops a deleted card", () => {
  assert.equal(retargetSelf("ada-demo-twin", "ada-demo-twin", "ada-demo"), "ada-demo");
  assert.equal(retargetSelf("ada-demo", "ada-demo-twin", "ada-demo"), "ada-demo");
  assert.equal(retargetSelf(null, "ada-demo-twin", "ada-demo"), null);
  assert.equal(forgetSelf("ada-demo", "ada-demo"), null);
  assert.equal(forgetSelf("ada-demo", "bea-demo"), "ada-demo");
});

test("selfSlug persists in settings — never provider tokens, never localStorage as a key", () => {
  const persisted = settingsWithoutSecrets({
    bundleRoot: "/tmp/people-graph",
    selfSlug: "ada-demo",
    grok_api_key: "xai-leaked",
    access_token: "oauth-leaked",
    apiKey: "AIza-leaked",
  });
  const json = JSON.stringify(persisted);
  assert.equal(persisted.selfSlug, "ada-demo");
  assert.match(json, /ada-demo/);
  assert.doesNotMatch(json, /xai-leaked|oauth-leaked|AIza-leaked|grok_api_key|access_token|apiKey/);
  assert.doesNotMatch(json, /localStorage/);
});
