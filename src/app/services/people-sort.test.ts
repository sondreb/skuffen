import assert from "node:assert/strict";
import { test } from "node:test";
import { settingsWithoutSecrets } from "./research.ts";
import {
  DEFAULT_PEOPLE_SORT,
  PEOPLE_SORT_LABELS,
  comparePeopleByName,
  forgetOpened,
  lastOpenedFromSettings,
  latestStamp,
  normalizePeopleSort,
  peopleSortFromSettings,
  retargetOpened,
  sortPeople,
  stampMs,
  stampOpened,
} from "./people-sort.ts";

test("normalizePeopleSort defaults to name A–Z and treats junk as unset", () => {
  assert.equal(normalizePeopleSort(undefined), DEFAULT_PEOPLE_SORT);
  assert.equal(normalizePeopleSort(null), "name-az");
  assert.equal(normalizePeopleSort(""), "name-az");
  assert.equal(normalizePeopleSort("teal"), "name-az");
  assert.equal(normalizePeopleSort("importance"), "name-az");
  assert.equal(normalizePeopleSort("heat"), "name-az");
  assert.equal(normalizePeopleSort("  Updated  "), "updated");
  assert.equal(normalizePeopleSort("name-za"), "name-za");
  assert.equal(normalizePeopleSort("added"), "added");
  assert.equal(normalizePeopleSort("opened"), "opened");
});

test("peopleSortFromSettings reads the choice without a cloud identity", () => {
  assert.equal(peopleSortFromSettings({}), "name-az");
  assert.equal(peopleSortFromSettings({ peopleSort: null }), "name-az");
  assert.equal(peopleSortFromSettings({ peopleSort: "opened" }), "opened");
});

test("lastOpenedFromSettings keeps ISO stamps and drops junk", () => {
  assert.deepEqual(lastOpenedFromSettings({}), {});
  assert.deepEqual(lastOpenedFromSettings({ peopleLastOpened: null }), {});
  assert.deepEqual(
    lastOpenedFromSettings({
      peopleLastOpened: {
        ada: "2026-08-31T10:00:00.000Z",
        bea: "not-a-date",
        "": "2026-08-31T10:00:00.000Z",
      },
    }),
    { ada: "2026-08-31T10:00:00.000Z" },
  );
});

test("stamp / forget / retarget last-opened without inventing a score", () => {
  const first = stampOpened({}, "ada", "2026-08-31T10:00:00.000Z");
  const second = stampOpened(first, "bea", "2026-08-31T11:00:00.000Z");
  assert.deepEqual(second, { ada: "2026-08-31T10:00:00.000Z", bea: "2026-08-31T11:00:00.000Z" });
  assert.deepEqual(forgetOpened(second, "ada"), { bea: "2026-08-31T11:00:00.000Z" });
  assert.deepEqual(retargetOpened(second, "bea", "ada"), { ada: "2026-08-31T11:00:00.000Z" });
  assert.deepEqual(retargetOpened(second, "ada", "bea"), {
    bea: "2026-08-31T11:00:00.000Z",
  });
  assert.equal(stampOpened({}, "", "2026-08-31T10:00:00.000Z")[""], undefined);
});

test("latestStamp is recency only — max ISO, never a ranked weight", () => {
  assert.equal(latestStamp(), undefined);
  assert.equal(latestStamp("nope", "2026-08-31T09:00:00Z", "2026-08-31T10:00:00Z"), "2026-08-31T10:00:00Z");
  assert.equal(stampMs("2026-08-31T10:00:00Z") > stampMs("2026-08-31T09:00:00Z"), true);
  assert.equal(stampMs(undefined), Number.NEGATIVE_INFINITY);
});

test("sortPeople: name A–Z default, Z–A reverse, recency newest first", () => {
  const ada = { slug: "ada-demo", title: "Ada Demo", addedAt: "2026-08-30T10:00:00Z", updatedAt: "2026-08-31T12:00:00Z" };
  const bea = { slug: "bea-demo", title: "Bea Demo", addedAt: "2026-08-31T09:00:00Z", updatedAt: "2026-08-31T09:30:00Z" };
  const cal = { slug: "cal-demo", title: "Cal Demo", addedAt: "2026-08-29T10:00:00Z" };

  assert.deepEqual(
    sortPeople([bea, cal, ada], "name-az").map((person) => person.slug),
    ["ada-demo", "bea-demo", "cal-demo"],
  );
  assert.deepEqual(
    sortPeople([ada, bea, cal], "name-za").map((person) => person.slug),
    ["cal-demo", "bea-demo", "ada-demo"],
  );
  assert.deepEqual(
    sortPeople([ada, bea, cal], "added").map((person) => person.slug),
    ["bea-demo", "ada-demo", "cal-demo"],
  );
  assert.deepEqual(
    sortPeople([ada, bea, cal], "updated").map((person) => person.slug),
    ["ada-demo", "bea-demo", "cal-demo"],
  );
  assert.deepEqual(
    sortPeople([ada, bea, cal], "opened", {
      "cal-demo": "2026-08-31T14:00:00Z",
      "ada-demo": "2026-08-31T13:00:00Z",
    }).map((person) => person.slug),
    ["cal-demo", "ada-demo", "bea-demo"],
  );
  assert.equal(comparePeopleByName(ada, bea) < 0, true);
});

test("sort labels are list order, never friend-heat or importance", () => {
  const labels = Object.values(PEOPLE_SORT_LABELS).join(" ");
  assert.match(labels, /Name A–Z/);
  assert.match(labels, /Recently opened/);
  assert.doesNotMatch(labels, /heat|score|closeness|importance|rank/i);
});

test("people sort persists in settings — never provider tokens, never OKF", () => {
  const persisted = settingsWithoutSecrets({
    bundleRoot: "/tmp/people-graph",
    selfSlug: "ada-demo",
    theme: "light",
    peoplePaneCollapsed: false,
    peopleSort: "opened",
    peopleLastOpened: { "ada-demo": "2026-08-31T10:00:00.000Z" },
    grok_api_key: "xai-leaked",
    access_token: "oauth-leaked",
    apiKey: "AIza-leaked",
  });
  const json = JSON.stringify(persisted);
  assert.equal(persisted.peopleSort, "opened");
  assert.deepEqual(persisted.peopleLastOpened, { "ada-demo": "2026-08-31T10:00:00.000Z" });
  assert.match(json, /"peopleSort":"opened"/);
  assert.doesNotMatch(json, /xai-leaked|oauth-leaked|AIza-leaked|grok_api_key|access_token|apiKey/);
  assert.doesNotMatch(json, /localStorage/);
  assert.doesNotMatch(json, /people-graph upload|analytics|friend-heat|importance/i);
});
