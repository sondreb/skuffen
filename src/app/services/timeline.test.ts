import assert from "node:assert/strict";
import { test } from "node:test";
import type { FactSuggestion, FollowRecord, PersonView } from "../models.ts";
import { assertNoAutoWrite } from "./research.ts";
import {
  TIMELINE_EMPTY,
  assertNoPendingResearchOnTape,
  assertTimelineIsViewOnly,
  assertTimelineOneCardOnly,
  buildPersonTimeline,
  timelineOpenWrites,
} from "./timeline.ts";

function person(overrides: Partial<PersonView> = {}): PersonView {
  return {
    id: "people/ada-demo/person",
    slug: "ada-demo",
    path: "people/ada-demo/person.md",
    title: "Ada Demo",
    description: "Synthetic demo card — not a real person",
    email: "ada.demo@example.invalid",
    body: "Notes stay on this machine.",
    notes: [],
    social: [],
    photos: [],
    documents: [],
    ...overrides,
  };
}

function follow(overrides: Partial<FollowRecord> = {}): FollowRecord {
  return {
    slug: "ada-demo",
    interval: "weekly",
    enabled: true,
    lastRunAt: "2026-08-20T10:00:00Z",
    nextRunAt: "2026-08-27T10:00:00Z",
    ...overrides,
  };
}

const pending: FactSuggestion = {
  id: "demo-research-ada-note",
  source: "research",
  kind: "note",
  title: "Public park mention (demo)",
  body: "Synthetic Grok proposal for Ada Demo. Not a real contact.",
};

test("empty card has no tape rows", () => {
  const events = buildPersonTimeline({ person: person() });
  assert.equal(events.length, 0);
  assert.equal(TIMELINE_EMPTY, "No timeline yet.");
});

test("accepted note is a tape row; pending research is not", () => {
  const empty = buildPersonTimeline({
    person: person(),
    pendingSuggestions: [pending],
  });
  assert.equal(empty.length, 0);
  assertNoPendingResearchOnTape(empty, [pending]);

  const afterAccept = buildPersonTimeline({
    person: person({
      notes: [
        {
          id: "n1",
          path: "people/ada-demo/notes/public-park-mention-demo-lmgh0zzz.md",
          title: "Public park mention (demo)",
          body: "Synthetic Grok proposal for Ada Demo. Not a real contact.",
          at: "2026-08-30T12:00:00Z",
        },
      ],
    }),
    pendingSuggestions: [],
  });
  assert.equal(afterAccept.length, 1);
  assert.equal(afterAccept[0]?.kind, "note");
  assert.equal(afterAccept[0]?.label, "Public park mention (demo)");
  assert.equal(afterAccept[0]?.path, "people/ada-demo/notes/public-park-mention-demo-lmgh0zzz.md");
  assert.equal(afterAccept[0]?.id, afterAccept[0]?.path);
  assert.equal(afterAccept[0]?.dateLabel, "2026-08-30");
  assertNoPendingResearchOnTape(afterAccept, [pending]);
});

test("opening Timeline writes nothing", () => {
  const writes = timelineOpenWrites();
  assert.deepEqual(writes, []);
  assertTimelineIsViewOnly(writes);
  assertNoAutoWrite(writes);
});

test("demo Ada tape has more than one kind from local files", () => {
  const events = buildPersonTimeline({
    person: person({
      notes: [
        {
          id: "n1",
          path: "people/ada-demo/notes/last-coffee-lmgh0g00.md",
          title: "Last coffee (demo)",
          body: "Asked about the park pin. Synthetic last-touch — not a real contact.",
          at: "2026-08-29T15:00:00Z",
        },
      ],
      photos: [
        {
          id: "p1",
          path: "people/ada-demo/photos/park.md",
          title: "Park photo (demo)",
          resource: "/people/ada-demo/photos/park.jpg",
          at: "2026-08-28T11:00:00Z",
        },
      ],
      location: {
        path: "people/ada-demo/place.md",
        title: "Golden Gate Park",
        address: "Golden Gate Park, San Francisco, California, United States (demo)",
        latitude: 37.7694,
        longitude: -122.4862,
        source: "search",
        at: "2026-08-27T09:00:00Z",
      },
      documents: [
        {
          id: "d1",
          slug: "park-slip",
          path: "documents/park-slip/document.md",
          title: "Park slip (demo)",
          kind: "document",
          subjects: ["people/ada-demo/person.md"],
          at: "2026-08-26T08:00:00Z",
        },
      ],
    }),
    follow: follow(),
  });

  const kinds = new Set(events.map((item) => item.kind));
  assert.ok(kinds.has("note"));
  assert.ok(kinds.has("photo"));
  assert.ok(kinds.has("document"));
  assert.ok(kinds.has("place"));
  assert.ok(kinds.has("follow"));
  assert.ok(kinds.size > 1);
  assert.equal(events[0]?.kind, "note");
  assert.equal(events[0]?.dateLabel, "2026-08-29");
  assert.equal(events.find((item) => item.kind === "place")?.label, "Place pin");
  assert.equal(events.find((item) => item.kind === "follow")?.label, "Follow");
  assertTimelineOneCardOnly(events, "ada-demo");
});

test("place pin without a date is omitted; follow without last-touch is omitted", () => {
  const events = buildPersonTimeline({
    person: person({
      location: {
        path: "people/ada-demo/place.md",
        title: "Golden Gate Park",
        latitude: 37.7694,
        longitude: -122.4862,
      },
    }),
    follow: follow({ lastRunAt: null }),
  });
  assert.equal(events.length, 0);
});

test("tape is newest first and uses the file path as identity", () => {
  const events = buildPersonTimeline({
    person: person({
      notes: [
        {
          id: "older",
          path: "people/ada-demo/notes/older.md",
          title: "Older slip",
          body: "Earlier.",
          at: "2026-08-01T10:00:00Z",
        },
        {
          id: "newer",
          path: "people/ada-demo/notes/newer.md",
          title: "Newer slip",
          body: "Later.",
          at: "2026-08-30T10:00:00Z",
        },
      ],
    }),
  });
  assert.deepEqual(
    events.map((item) => item.path),
    ["people/ada-demo/notes/newer.md", "people/ada-demo/notes/older.md"],
  );
  assert.equal(events[0]?.id, "people/ada-demo/notes/newer.md");
});

test("timeline never invents a second store or uploads the graph", () => {
  const card = person({
    notes: [
      {
        id: "n1",
        path: "people/ada-demo/notes/coffee.md",
        title: "Last coffee (demo)",
        body: "Asked about the park pin.",
        at: "2026-08-29T15:00:00Z",
      },
    ],
  });
  const before = JSON.stringify(card);
  const events = buildPersonTimeline({ person: card, pendingSuggestions: [pending] });
  assert.equal(JSON.stringify(card), before);
  const payload = JSON.stringify(events);
  assert.doesNotMatch(payload, /api\.x\.ai|generativelanguage|people-graph upload/i);
  assert.doesNotMatch(payload, /bea-demo|people\/bea/);
  assert.equal(events.length, 1);
});
