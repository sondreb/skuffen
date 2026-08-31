import assert from "node:assert/strict";
import { test } from "node:test";
import type { FactSuggestion, FollowRecord, PersonView, StoredProposal } from "../models.ts";
import { makeStoredProposal } from "./memory.ts";
import { RESEARCH_SYSTEM, assertNoAutoSend, assertNoAutoWrite, proposeOnly } from "./research.ts";
import {
  BRIEF_SYSTEM,
  applyPolishedTalkingPoints,
  assertLocalBriefNeedsNoNetwork,
  assertNoMailIngest,
  assertOneCardOnly,
  briefProposeWrites,
  buildLocalBrief,
  buildPolishPrompt,
  demoPolishTalkingPoints,
  geminiPolishGenerate,
  grokPolishRequest,
  livePolishRequests,
  parseEventPaste,
  parsePolishedPoints,
  writesForAcceptedBrief,
} from "./brief.ts";

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
        path: "people/ada-demo/notes/coffee.md",
        title: "Last coffee",
        body: "Asked about the park pin and the land-plot slip.",
      },
    ],
    social: [
      {
        id: "s1",
        path: "people/ada-demo/social/wikipedia.md",
        title: "Wikipedia",
        network: "wikipedia",
        handle: "Ada_Demo",
        url: "https://example.invalid/ada-demo",
      },
    ],
    photos: [],
    location: {
      path: "people/ada-demo/place.md",
      title: "Golden Gate Park",
      address: "Golden Gate Park, San Francisco, California, United States (demo)",
      latitude: 37.7694,
      longitude: -122.4862,
      source: "search",
    },
    documents: [],
    relations: [],
    places: [],
    tags: [],
    ...overrides,
  };
}

const pendingSuggestion: FactSuggestion = {
  id: "research-1",
  source: "research",
  kind: "note",
  title: "Public park mention (demo)",
  body: "Synthetic Grok proposal for Ada Demo. Not a real contact.",
};

function pendingProposal(): StoredProposal {
  return makeStoredProposal({
    id: "p1",
    slug: "ada-demo",
    source: "research",
    createdAt: "2026-08-30T10:00:00Z",
    suggestions: [pendingSuggestion],
  });
}

function follow(): FollowRecord {
  return {
    slug: "ada-demo",
    interval: "weekly",
    enabled: true,
    lastRunAt: null,
    nextRunAt: "2026-09-06T10:00:00Z",
  };
}

test("brief is generated from local OKF facts and pending proposals", () => {
  const event = parseEventPaste("Coffee with Ada Demo\nTuesday 10:00\nGolden Gate Park\nBring the land-plot notes");
  const brief = buildLocalBrief({
    person: person(),
    proposals: [pendingProposal()],
    follow: follow(),
    event,
  });

  assert.equal(brief.source, "local");
  assert.equal(brief.networkUsed, false);
  assert.equal(brief.slug, "ada-demo");
  assert.match(brief.who, /Ada Demo/);
  assert.match(brief.who, /ada\.demo@example\.invalid/);
  assert.equal(brief.lastNotes[0]?.title, "Last coffee");
  assert.match(brief.lastNotes[0]?.body ?? "", /park pin/);
  assert.ok(brief.followUps.some((item) => /Public park mention/.test(item.title)));
  assert.ok(brief.followUps.some((item) => /weekly/.test(item.body)));
  assert.match(brief.place?.body ?? "", /Golden Gate Park/);
  assert.ok(brief.social.some((item) => /wikipedia/.test(item.body)));
  assert.ok(brief.talkingPoints.some((item) => /Ask about:/.test(item.body)));
  assert.ok(brief.talkingPoints.some((item) => /Review before the meeting/.test(item.body)));
  assert.match(brief.markdown, /## Who/);
  assert.match(brief.markdown, /## Last notes/);
  assert.match(brief.markdown, /## Open follow-ups/);
  assert.match(brief.markdown, /## Talking points/);
  assert.match(brief.markdown, /Coffee with Ada Demo/);
  assert.doesNotMatch(brief.markdown, /Bob Example|full people-graph/i);
});

test("local brief path never writes OKF and never needs the network", () => {
  const okfWrites: unknown[] = [];
  const sends: unknown[] = [];
  const brief = buildLocalBrief({
    person: person(),
    proposals: [pendingProposal()],
    follow: follow(),
  });

  assert.deepEqual(briefProposeWrites(), []);
  assert.deepEqual(proposeOnly([pendingSuggestion]), []);
  assertNoAutoWrite(okfWrites);
  assertNoAutoSend(sends);
  assertLocalBriefNeedsNoNetwork(brief);
  assert.equal(brief.networkUsed, false);
  assert.doesNotMatch(brief.markdown, /api\.x\.ai|generativelanguage|auth\.x\.ai/);
});

test("Accept is the only path that yields an OKF write intent for the brief", () => {
  const writes: unknown[] = [];
  const brief = buildLocalBrief({
    person: person(),
    event: { title: "Coffee" },
  });
  assert.deepEqual(briefProposeWrites(), []);
  assertNoAutoWrite(writes);

  const intent = writesForAcceptedBrief(brief);
  assert.equal(intent.type, "note");
  assert.equal(intent.slug, "ada-demo");
  assert.equal(intent.title, "Pre-meeting brief — Coffee");
  assert.match(intent.body, /Ada Demo/);
  assert.match(intent.body, /Last coffee/);
});

test("dismiss / propose-only leaves the bundle untouched", () => {
  const writes: unknown[] = [];
  buildLocalBrief({ person: person(), proposals: [pendingProposal()] });
  assert.deepEqual(briefProposeWrites(), []);
  assertNoAutoWrite(writes);
});

test("optional polish rewrites talking points and still never auto-sends", () => {
  const sends: unknown[] = [];
  const brief = buildLocalBrief({ person: person(), proposals: [pendingProposal()] });
  const polished = applyPolishedTalkingPoints(brief, demoPolishTalkingPoints(brief), false);
  assert.equal(polished.source, "polished");
  assert.equal(polished.networkUsed, false);
  assert.ok(polished.talkingPoints.every((item) => item.body.startsWith("Polish:")));
  assertNoAutoSend(sends);
  assert.deepEqual(briefProposeWrites(), []);
});

test("polish prompt includes only that person and never the graph or tokens", () => {
  const brief = buildLocalBrief({ person: person() });
  const prompt = buildPolishPrompt(brief);
  assert.match(prompt, /Ada Demo/);
  assert.match(prompt, /this one person/);
  assert.match(prompt, /Do not send messages/);
  assert.doesNotMatch(prompt, /full people-graph/);
  assert.doesNotMatch(prompt, /Bob Example|reconnect shuffle/i);
  assert.doesNotMatch(prompt, /people\/(?!ada-demo)/);
  assert.doesNotMatch(prompt, /grok_api_key|access_token|localStorage/);

  const body = grokPolishRequest("grok-4-latest", prompt);
  assert.equal("tools" in body, false);
  const json = JSON.stringify(body);
  assert.match(json, /Never request the full people-graph/);
  assert.doesNotMatch(json, /web_search|googleSearch/);
  assert.doesNotMatch(json, /grok_api_key|access_token/);
});

test("live polish path wires BRIEF_SYSTEM for Grok and Gemini — not RESEARCH_SYSTEM, no search tools", () => {
  const brief = buildLocalBrief({ person: person() });
  const prompt = buildPolishPrompt(brief);
  const live = livePolishRequests({ grokModel: "grok-4-latest", prompt });

  assert.equal(live.grok.url, "https://api.x.ai/v1/chat/completions");
  assert.deepEqual(live.grok.body, grokPolishRequest("grok-4-latest", prompt));
  assert.deepEqual(live.gemini, geminiPolishGenerate(prompt));

  const grokJson = JSON.stringify(live.grok.body);
  assert.equal(grokJson.includes(BRIEF_SYSTEM), true);
  assert.equal(grokJson.includes(RESEARCH_SYSTEM), false);
  assert.doesNotMatch(grokJson, /Search public web sources/);
  assert.equal("tools" in live.grok.body, false);
  assert.doesNotMatch(grokJson, /web_search|googleSearch/);

  const geminiJson = JSON.stringify(live.gemini);
  assert.equal(live.gemini.config.systemInstruction, BRIEF_SYSTEM);
  assert.equal(live.gemini.contents, prompt);
  assert.equal(geminiJson.includes(RESEARCH_SYSTEM), false);
  assert.doesNotMatch(geminiJson, /Search public web sources|googleSearch|web_search/);
  assert.doesNotMatch(geminiJson, /tools/);
});

test("parsePolishedPoints reads compact JSON and ignores junk", () => {
  assert.deepEqual(parsePolishedPoints('{"talkingPoints":["Ask about the park","Confirm the pin"]}'), [
    "Ask about the park",
    "Confirm the pin",
  ]);
  assert.deepEqual(parsePolishedPoints("not json"), []);
});

test("event paste fills title, when, and where without leaving the machine", () => {
  const event = parseEventPaste("When: Tuesday 10:00\nWhere: Cafe Nero\nTitle: Catch-up");
  assert.equal(event.title, "Catch-up");
  assert.equal(event.when, "Tuesday 10:00");
  assert.equal(event.where, "Cafe Nero");
  const brief = buildLocalBrief({ person: person({ notes: [], social: [], location: undefined }), event });
  assert.match(brief.markdown, /Catch-up/);
  assert.match(brief.markdown, /Tuesday 10:00/);
  assert.equal(brief.networkUsed, false);
});

test("Latch extra care: one OKF card, Accept-only write, no graph upload, no mail ingest, no auto-send", () => {
  const writes: unknown[] = [];
  const sends: unknown[] = [];
  const siblingProposal = makeStoredProposal({
    id: "p-bob",
    slug: "bob-example",
    source: "research",
    createdAt: "2026-08-30T10:00:00Z",
    suggestions: [
      {
        id: "bob-note",
        source: "research",
        kind: "note",
        title: "Bob only",
        body: "Sibling card — must never enter Ada's brief.",
      },
    ],
  });
  const event = parseEventPaste("Coffee with Ada Demo\nTuesday 10:00\nGolden Gate Park");
  const brief = buildLocalBrief({
    person: person(),
    proposals: [pendingProposal(), siblingProposal],
    follow: follow(),
    event,
  });
  const payload = [brief.markdown, brief.who, ...brief.followUps.map((item) => item.body)].join("\n");

  assert.equal(brief.source, "local");
  assert.equal(brief.networkUsed, false);
  assertLocalBriefNeedsNoNetwork(brief);
  assertNoMailIngest(payload);
  assertNoMailIngest(JSON.stringify(event));
  assertOneCardOnly(payload, "Bob Example");
  assertOneCardOnly(payload, "bob-example");
  assertOneCardOnly(payload, "Sibling card");
  assert.match(brief.markdown, /Ada Demo/);
  assert.match(brief.markdown, /Last coffee/);
  assert.deepEqual(briefProposeWrites(), []);
  assertNoAutoWrite(writes);
  assertNoAutoSend(sends);

  const prompt = buildPolishPrompt(brief);
  const live = livePolishRequests({ grokModel: "grok-4-latest", prompt });
  const liveJson = `${prompt}\n${JSON.stringify(live.grok.body)}\n${JSON.stringify(live.gemini)}`;
  assertOneCardOnly(liveJson, "bob-example");
  assertOneCardOnly(liveJson, "Sibling card");
  assertNoMailIngest(liveJson);
  assert.match(prompt, /Do not send messages/);
  assert.match(prompt, /Do not upload or request the full graph/);
  assert.doesNotMatch(liveJson, /gmail|imap|smtp|calendar\.google/i);

  const intent = writesForAcceptedBrief(brief);
  assert.equal(intent.type, "note");
  assert.equal(intent.slug, "ada-demo");
});
