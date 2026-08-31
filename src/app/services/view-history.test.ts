import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ViewHistory, snapshotView, viewsEqual, type AppView } from "./view-history.ts";

const home = snapshotView({ panel: "none" });
const people = snapshotView({ panel: "people" });
const ada = snapshotView({ panel: "none", selectedSlug: "ada-demo" });
const map = snapshotView({ panel: "map" });
const place = snapshotView({ panel: "none", selectedPlaceSlug: "park-demo" });

test("viewsEqual is panel + selection only", () => {
  assert.equal(viewsEqual(home, snapshotView({ panel: "none" })), true);
  assert.equal(viewsEqual(ada, snapshotView({ panel: "none", selectedSlug: "ada-demo" })), true);
  assert.equal(viewsEqual(ada, home), false);
  assert.equal(viewsEqual(people, map), false);
  assert.equal(viewsEqual(place, snapshotView({ panel: "none", selectedPlaceSlug: "park-demo" })), true);
});

test("empty history: no back, no forward", () => {
  const nav = new ViewHistory();
  assert.equal(nav.current(), null);
  assert.equal(nav.canBack(), false);
  assert.equal(nav.canForward(), false);
  assert.equal(nav.back(), null);
  assert.equal(nav.forward(), null);
});

test("push records from → next; back restores prior destination, not a blank home invent", () => {
  const nav = new ViewHistory();
  nav.push(home, people);
  nav.push(people, ada);
  assert.deepEqual(nav.current(), ada);
  assert.equal(nav.canBack(), true);
  assert.equal(nav.canForward(), false);

  const prior = nav.back();
  assert.deepEqual(prior, people);
  assert.deepEqual(nav.current(), people);
  assert.equal(nav.canBack(), true);
  assert.equal(nav.canForward(), true);

  assert.deepEqual(nav.back(), home);
  assert.equal(nav.canBack(), false);
  assert.deepEqual(nav.forward(), people);
  assert.deepEqual(nav.forward(), ada);
  assert.equal(nav.canForward(), false);
});

test("same view is a no-op; branching drops forward entries", () => {
  const nav = new ViewHistory();
  nav.push(home, people);
  nav.push(people, people);
  assert.deepEqual(nav.current(), people);
  assert.equal(nav.canBack(), true);
  assert.equal(nav.canForward(), false);

  nav.push(people, ada);
  nav.back();
  nav.push(people, map);
  assert.deepEqual(nav.current(), map);
  assert.equal(nav.canForward(), false);
  assert.deepEqual(nav.back(), people);
  assert.deepEqual(nav.back(), home);
});

test("replaceTip keeps a completed sheet from becoming the back target", () => {
  const nav = new ViewHistory();
  const create = snapshotView({ panel: "create" });
  nav.push(home, create);
  nav.replaceTip(ada);
  assert.deepEqual(nav.current(), ada);
  assert.deepEqual(nav.back(), home);
});

test("history is in-memory only — source never writes the people-graph or encrypts", () => {
  const src = readFileSync(fileURLToPath(new URL("./view-history.ts", import.meta.url)), "utf8");
  assert.match(src, /Memory only/);
  assert.doesNotMatch(src, /people-graph upload|uploadGraph|localStorage|sessionStorage|encrypt|AES|cipher/i);
  assert.doesNotMatch(src, /io\.service|saveSettings|writeTextFile|invoke\(/i);

  const nav = new ViewHistory();
  nav.push(home, people);
  const dumped: AppView[] = [];
  let cursor = nav.current();
  while (cursor) {
    dumped.push(cursor);
    cursor = nav.canBack() ? nav.back() : null;
  }
  const json = JSON.stringify(dumped);
  assert.doesNotMatch(json, /people-graph upload|token|secret|password|api[_-]?key/i);
});
