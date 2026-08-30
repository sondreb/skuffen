import assert from "node:assert/strict";
import { test } from "node:test";
import type { FollowRecord, PersonView } from "../models.ts";
import { RESEARCH_SYSTEM, assertNoAutoSend, assertNoAutoWrite, proposeOnly } from "./research.ts";
import {
  DAILY_RECONNECT_LIMIT,
  RECONNECT_SYSTEM,
  applyPolishedReconnectDraft,
  assertLocalShuffleNeedsNoNetwork,
  assertNoGraphUpload,
  assertNotAFriendRanker,
  assertOnePersonOnly,
  assertReconnectNeverSends,
  buildDailyShuffle,
  buildLocalReconnectDraft,
  buildReconnectDraftPrompt,
  demoPolishReconnectDraft,
  dismissShuffleWrites,
  geminiReconnectDraftGenerate,
  grokReconnectDraftRequest,
  lastTouchMs,
  liveReconnectDraftRequests,
  parseReconnectDraft,
  shuffleProposeWrites,
  skipShuffleWrites,
  timestampFromNotePath,
  writesForAcceptedDraft,
} from "./shuffle.ts";

function person(overrides: Partial<PersonView> = {}): PersonView {
  return {
    id: "people/ada-demo/person",
    slug: "ada-demo",
    path: "people/ada-demo/person.md",
    title: "Ada Demo",
    description: "Synthetic demo card — not a real person",
    email: "ada.demo@example.invalid",
    body: "Notes stay on this machine.",
    notes: [
      {
        id: "n1",
        path: "people/ada-demo/notes/last-coffee-lmgh0g00.md",
        title: "Last coffee",
        body: "Asked about the park pin and the land-plot slip.",
      },
    ],
    social: [],
    photos: [],
    documents: [],
    ...overrides,
  };
}

function bea(overrides: Partial<PersonView> = {}): PersonView {
  return person({
    id: "people/bea-demo/person",
    slug: "bea-demo",
    path: "people/bea-demo/person.md",
    title: "Bea Demo",
    description: "Second synthetic card — reconnect demo only",
    email: "bea.demo@example.invalid",
    notes: [
      {
        id: "n2",
        path: "people/bea-demo/notes/studio-visit-lmgh0g01.md",
        title: "Studio visit",
        body: "Talked about the land-plot slip.",
      },
    ],
    ...overrides,
  });
}

function follow(): FollowRecord {
  return {
    slug: "ada-demo",
    interval: "weekly",
    enabled: true,
    lastRunAt: "2026-08-01T10:00:00Z",
    nextRunAt: "2026-09-06T10:00:00Z",
  };
}

test("daily suggestions come from local OKF notes, last-touch, follow, and recency", () => {
  const now = new Date("2026-08-30T12:00:00Z");
  const shuffle = buildDailyShuffle({
    people: [
      { person: person(), follow: follow(), lastAcceptedAt: "2026-08-10T10:00:00Z" },
      { person: bea() },
    ],
    now,
  });

  assert.equal(shuffle.day, "2026-08-30");
  assert.equal(shuffle.suggestions.length, 2);
  assert.equal(DAILY_RECONNECT_LIMIT, 2);
  const ada = shuffle.suggestions.find((item) => item.slug === "ada-demo");
  const other = shuffle.suggestions.find((item) => item.slug === "bea-demo");
  assert.ok(ada);
  assert.ok(other);
  assert.equal(ada.lastNoteTitle, "Last coffee");
  assert.match(ada.lastNoteBody ?? "", /park pin/);
  assert.ok(ada.reasons.some((item) => item.kind === "last-note" && /Last coffee/.test(item.body)));
  assert.ok(ada.reasons.some((item) => item.kind === "last-accept" && /2026-08-10/.test(item.body)));
  assert.ok(ada.reasons.some((item) => item.kind === "follow" && /weekly/.test(item.body)));
  assert.ok(ada.reasons.some((item) => item.kind === "recency"));
  assert.equal(ada.followInterval, "weekly");
  assert.doesNotMatch(JSON.stringify(shuffle), /Bob Example|full people-graph/i);
  assertNotAFriendRanker(shuffle);
});

test("local shuffle never writes OKF, never sends, never uploads the graph, never ranks in the cloud", () => {
  const writes: unknown[] = [];
  const sends: unknown[] = [];
  const shuffle = buildDailyShuffle({
    people: [{ person: person() }, { person: bea() }],
  });
  const payload = JSON.stringify(shuffle);

  assert.deepEqual(shuffleProposeWrites(), []);
  assert.deepEqual(skipShuffleWrites(), []);
  assert.deepEqual(dismissShuffleWrites(), []);
  assert.deepEqual(proposeOnly([]), []);
  assertNoAutoWrite(writes);
  assertNoAutoSend(sends);
  assertReconnectNeverSends(sends);
  assertLocalShuffleNeedsNoNetwork(shuffle);
  assertNoGraphUpload(payload);
  assertNotAFriendRanker(shuffle);
  assert.doesNotMatch(payload, /api\.x\.ai|generativelanguage|auth\.x\.ai/);
  assert.doesNotMatch(payload, /score|rank|friend-rank|who matters/i);
});

test("user pick builds an optional local draft; nothing is sent", () => {
  const sends: unknown[] = [];
  const shuffle = buildDailyShuffle({
    people: [{ person: person() }, { person: bea() }],
  });
  const ada = shuffle.suggestions.find((item) => item.slug === "ada-demo")!;
  const draft = buildLocalReconnectDraft(ada);

  assert.equal(draft.source, "local");
  assert.equal(draft.networkUsed, false);
  assert.equal(draft.slug, "ada-demo");
  assert.match(draft.body, /Ada Demo/);
  assert.match(draft.body, /Last coffee|park pin/);
  assert.match(draft.body, /Nothing was sent/);
  assert.doesNotMatch(draft.body, /Bea Demo|Studio visit|Bob Example/);
  assert.doesNotMatch(draft.body, /mailto:|sms:|auto-send|sendMessage/i);
  assertReconnectNeverSends(sends);
  assertOnePersonOnly(draft.body, "Bea Demo");
  assertOnePersonOnly(draft.body, "bea-demo");
  assert.deepEqual(shuffleProposeWrites(), []);
});

test("Accept is the only path that yields an OKF write intent, and only if a draft is saved", () => {
  const writes: unknown[] = [];
  const shuffle = buildDailyShuffle({ people: [{ person: person() }] });
  const draft = buildLocalReconnectDraft(shuffle.suggestions[0]!);
  assert.deepEqual(shuffleProposeWrites(), []);
  assertNoAutoWrite(writes);

  const empty = writesForAcceptedDraft({ ...draft, body: "   " });
  assert.equal(empty, null);

  const intent = writesForAcceptedDraft(draft);
  assert.ok(intent);
  assert.equal(intent.type, "note");
  assert.equal(intent.slug, "ada-demo");
  assert.equal(intent.title, "Reconnect draft — Ada Demo");
  assert.match(intent.body, /Ada Demo/);
  assert.match(intent.body, /Last coffee|park pin/);
});

test("skip and dismiss write nothing", () => {
  const writes: unknown[] = [];
  const first = buildDailyShuffle({
    people: [{ person: person() }, { person: bea() }],
  });
  const skipped = buildDailyShuffle({
    people: [{ person: person() }, { person: bea() }],
    skipSlugs: new Set(["ada-demo"]),
  });
  assert.deepEqual(skipShuffleWrites(), []);
  assert.deepEqual(dismissShuffleWrites(), []);
  assert.deepEqual(shuffleProposeWrites(), []);
  assertNoAutoWrite(writes);
  assert.equal(first.suggestions.length, 2);
  assert.deepEqual(
    skipped.suggestions.map((item) => item.slug),
    ["bea-demo"],
  );
});

test("daily deck stays at two and prefers older last-touch — not a friend-ranker", () => {
  const older = person({
    notes: [
      {
        id: "old",
        path: "people/ada-demo/notes/old-lmg00000.md",
        title: "Old coffee",
        body: "Years ago in the park.",
      },
    ],
  });
  const newer = bea({
    notes: [
      {
        id: "new",
        path: "people/bea-demo/notes/new-lmghzzzz.md",
        title: "Yesterday",
        body: "Just saw Bea.",
      },
    ],
  });
  const third = person({
    id: "people/cam-demo/person",
    slug: "cam-demo",
    path: "people/cam-demo/person.md",
    title: "Cam Demo",
    email: "cam.demo@example.invalid",
    notes: [],
  });
  const shuffle = buildDailyShuffle({
    people: [{ person: newer }, { person: older }, { person: third }],
  });
  assert.equal(shuffle.suggestions.length, 2);
  assert.equal(shuffle.suggestions[0]?.slug, "cam-demo");
  assert.equal(shuffle.suggestions[1]?.slug, "ada-demo");
  assert.ok(!shuffle.suggestions.some((item) => item.slug === "bea-demo"));
  assertNotAFriendRanker(shuffle);
});

test("optional polish rewrites the one picked draft and still never auto-sends", () => {
  const sends: unknown[] = [];
  const shuffle = buildDailyShuffle({ people: [{ person: person() }, { person: bea() }] });
  const ada = shuffle.suggestions.find((item) => item.slug === "ada-demo")!;
  const draft = buildLocalReconnectDraft(ada);
  const polished = applyPolishedReconnectDraft(draft, demoPolishReconnectDraft(draft), false);
  assert.equal(polished.source, "polished");
  assert.equal(polished.networkUsed, false);
  assert.ok(polished.body.startsWith("Polish:"));
  assertReconnectNeverSends(sends);
  assert.deepEqual(shuffleProposeWrites(), []);
  assertOnePersonOnly(polished.body, "Bea Demo");
});

test("draft prompt includes only the picked person and never the graph or tokens", () => {
  const shuffle = buildDailyShuffle({
    people: [{ person: person(), follow: follow() }, { person: bea() }],
  });
  const ada = shuffle.suggestions.find((item) => item.slug === "ada-demo")!;
  const prompt = buildReconnectDraftPrompt(ada);
  assert.match(prompt, /Ada Demo/);
  assert.match(prompt, /this one person/);
  assert.match(prompt, /Do not send messages/);
  assert.match(prompt, /Do not include sibling cards/);
  assert.doesNotMatch(prompt, /Bea Demo|bea-demo|Bob Example/);
  assert.doesNotMatch(prompt, /full people-graph/);
  assert.doesNotMatch(prompt, /grok_api_key|access_token|localStorage/);

  const body = grokReconnectDraftRequest("grok-4-latest", prompt);
  assert.equal("tools" in body, false);
  const json = JSON.stringify(body);
  assert.match(json, /Never request the full people-graph/);
  assert.doesNotMatch(json, /web_search|googleSearch/);
  assert.doesNotMatch(json, /grok_api_key|access_token/);
  assertOnePersonOnly(`${prompt}\n${json}`, "Bea Demo");
  assertOnePersonOnly(`${prompt}\n${json}`, "bea-demo");
  assertNoGraphUpload(prompt);
});

test("live reconnect draft wires RECONNECT_SYSTEM for Grok and Gemini — not RESEARCH_SYSTEM, no search tools", () => {
  const shuffle = buildDailyShuffle({ people: [{ person: person() }] });
  const prompt = buildReconnectDraftPrompt(shuffle.suggestions[0]!);
  const live = liveReconnectDraftRequests({ grokModel: "grok-4-latest", prompt });

  assert.equal(live.grok.url, "https://api.x.ai/v1/chat/completions");
  assert.deepEqual(live.grok.body, grokReconnectDraftRequest("grok-4-latest", prompt));
  assert.deepEqual(live.gemini, geminiReconnectDraftGenerate(prompt));

  const grokJson = JSON.stringify(live.grok.body);
  assert.equal(grokJson.includes(RECONNECT_SYSTEM), true);
  assert.equal(grokJson.includes(RESEARCH_SYSTEM), false);
  assert.doesNotMatch(grokJson, /Search public web sources/);
  assert.equal("tools" in live.grok.body, false);
  assert.doesNotMatch(grokJson, /web_search|googleSearch/);

  const geminiJson = JSON.stringify(live.gemini);
  assert.equal(live.gemini.config.systemInstruction, RECONNECT_SYSTEM);
  assert.equal(live.gemini.contents, prompt);
  assert.equal(geminiJson.includes(RESEARCH_SYSTEM), false);
  assert.doesNotMatch(geminiJson, /Search public web sources|googleSearch|web_search/);
  assert.doesNotMatch(geminiJson, /tools/);
});

test("parseReconnectDraft reads compact JSON and ignores junk", () => {
  assert.equal(parseReconnectDraft('{"draft":"Hi Ada — coffee soon?"}'), "Hi Ada — coffee soon?");
  assert.equal(parseReconnectDraft("not json"), "");
});

test("note path timestamps stay local recency hints", () => {
  const ms = timestampFromNotePath("people/ada-demo/notes/last-coffee-lmgh0g00.md");
  assert.ok(ms && ms > 1_000_000_000_000);
  assert.equal(timestampFromNotePath("people/ada-demo/notes/plain.md"), null);
  const touch = lastTouchMs({
    person: person(),
    lastAcceptedAt: "2026-08-20T00:00:00Z",
    follow: follow(),
  });
  assert.ok(touch && touch > 0);
});

test("Latch extra care: one picked card, Accept-only write, no graph upload, no auto-send, no friend-ranker", () => {
  const writes: unknown[] = [];
  const sends: unknown[] = [];
  const shuffle = buildDailyShuffle({
    people: [{ person: person(), follow: follow(), lastAcceptedAt: "2026-08-10T10:00:00Z" }, { person: bea() }],
  });
  const ada = shuffle.suggestions.find((item) => item.slug === "ada-demo")!;
  const draft = buildLocalReconnectDraft(ada);
  const payload = [JSON.stringify(shuffle), draft.body].join("\n");

  assertLocalShuffleNeedsNoNetwork(shuffle);
  assertNotAFriendRanker(shuffle);
  assertNoGraphUpload(payload);
  assertOnePersonOnly(draft.body, "Bea Demo");
  assertOnePersonOnly(draft.body, "Studio visit");
  assert.deepEqual(shuffleProposeWrites(), []);
  assert.deepEqual(skipShuffleWrites(), []);
  assert.deepEqual(dismissShuffleWrites(), []);
  assertNoAutoWrite(writes);
  assertReconnectNeverSends(sends);
  assert.match(draft.body, /Ada Demo/);
  assert.match(draft.body, /Nothing was sent/);

  const prompt = buildReconnectDraftPrompt(ada);
  const live = liveReconnectDraftRequests({ grokModel: "grok-4-latest", prompt });
  const liveJson = `${prompt}\n${JSON.stringify(live.grok.body)}\n${JSON.stringify(live.gemini)}`;
  assertOnePersonOnly(liveJson, "bea-demo");
  assertOnePersonOnly(liveJson, "Studio visit");
  assert.match(prompt, /Do not send messages/);
  assert.match(prompt, /Do not upload or request the full graph/);
  assert.doesNotMatch(liveJson, /mailto:|sms:|auto-dm|auto-email/i);

  const intent = writesForAcceptedDraft(draft);
  assert.equal(intent?.type, "note");
  assert.equal(intent?.slug, "ada-demo");
});
