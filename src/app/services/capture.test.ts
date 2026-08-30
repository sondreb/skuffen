import assert from "node:assert/strict";
import { test } from "node:test";
import { RESEARCH_SYSTEM, assertNoAutoSend, assertNoAutoWrite, proposeOnly } from "./research.ts";
import {
  CAPTURE_NEEDS_PROVIDER,
  CAPTURE_SYSTEM,
  DEMO_CAPTURE_NOTE,
  assertCapturePromptIsCaptureOnly,
  assertDemoCaptureNeedsNoNetwork,
  assertNoAudioPersist,
  assertNoThirdPartyStt,
  buildCapturePrompt,
  captureItemsAsSuggestions,
  captureProposeWrites,
  checkedCaptureItems,
  deleteCaptureItem,
  demoCaptureItems,
  demoCapturePrompt,
  dismissCaptureProposal,
  dropCaptureAudio,
  geminiCaptureGenerate,
  grokCaptureRequest,
  liveCaptureRequests,
  parseCaptureItems,
  planAcceptedCapture,
  proposeCapture,
  resolveCaptureNoteSlug,
  setAllCaptureChecked,
  setCaptureChecked,
  showCaptureEmptyState,
  speechRecognitionAvailable,
  transcriptFromSpeechResults,
  writesForAcceptedCapture,
} from "./capture.ts";

const NOTE = DEMO_CAPTURE_NOTE;

test("capture prompt includes only this note and never the people-graph", () => {
  const prompt = buildCapturePrompt(NOTE);
  assert.match(prompt, /Met Ada Demo at Golden Gate Park Tuesday/);
  assert.match(prompt, /Use only the capture below/);
  assert.match(prompt, /Do not send messages/);
  assert.match(prompt, /Do not upload or request the full graph/);
  assert.doesNotMatch(prompt, /Existing notes|Existing social|Given name:|Family name:/);
  assert.doesNotMatch(prompt, /Bob Example|reconnect shuffle|meeting brief/i);
  assert.doesNotMatch(prompt, /people\//);
  assertCapturePromptIsCaptureOnly(prompt);
  assertCapturePromptIsCaptureOnly(prompt, "bob-example");
});

test("propose-only leaves the OKF bundle untouched", () => {
  const writes: unknown[] = [];
  const sends: unknown[] = [];
  const items = demoCaptureItems(NOTE);
  assert.ok(items.some((item) => item.kind === "person" && item.title === "Ada Demo"));
  assert.ok(items.some((item) => item.kind === "date"));
  assert.ok(items.some((item) => item.kind === "follow-up" && /land-plot/.test(item.title)));
  assert.ok(items.some((item) => item.kind === "note" && item.body === NOTE));
  assert.deepEqual(captureProposeWrites(), []);
  assert.deepEqual(proposeOnly(captureItemsAsSuggestions(items)), []);
  assertNoAutoWrite(writes);
  assertNoAutoSend(sends);
});

test("Accept is the only path that yields OKF write intents for people, dates, and follow-ups", () => {
  const writes: unknown[] = [];
  const items = demoCaptureItems(NOTE);
  const proposal = proposeCapture(NOTE, items);
  assert.deepEqual(captureProposeWrites(), []);
  assertNoAutoWrite(writes);

  const plan = planAcceptedCapture(proposal);
  assert.ok(plan);
  assert.equal(plan.people[0]?.title, "Ada Demo");
  assert.ok(plan.notes.some((note) => /^Date —/.test(note.title)));
  assert.ok(plan.notes.some((note) => /^Follow-up —/.test(note.title)));
  assert.ok(plan.notes.some((note) => note.title.includes("Voice note")));

  const intents = writesForAcceptedCapture(plan);
  assert.ok(intents.some((item) => item.type === "person" && item.title === "Ada Demo"));
  assert.ok(intents.some((item) => item.type === "note" && /land-plot/.test(item.title)));
  assert.ok(intents.every((item) => item.type !== "person" || item.title !== "Bob Example"));
});

test("unchecked and deleted capture items are not written", () => {
  const proposal = proposeCapture(NOTE, demoCaptureItems(NOTE));
  const person = proposal.items.find((entry) => entry.item.kind === "person")!;
  const follow = proposal.items.find((entry) => entry.item.kind === "follow-up")!;
  const next = deleteCaptureItem(setCaptureChecked(proposal, follow.id, false), person.id);
  const plan = planAcceptedCapture(next, "Ada Demo");
  assert.ok(plan);
  assert.equal(
    plan.notes.some((note) => /land-plot/.test(note.title)),
    false,
  );
  assert.ok(plan.people.some((item) => item.title === "Ada Demo"));
  assert.deepEqual(
    checkedCaptureItems(next).map((item) => item.kind).sort(),
    ["date", "note"],
  );
});

test("dismissing a capture proposal writes nothing", () => {
  const writes: unknown[] = [];
  const proposal = proposeCapture(NOTE, demoCaptureItems(NOTE));
  const dismissed = dismissCaptureProposal();
  assert.equal(dismissed, null);
  assert.equal(planAcceptedCapture(setAllCaptureChecked(proposal, false)), null);
  assert.deepEqual(captureProposeWrites(), []);
  assertNoAutoWrite(writes);
});

test("live capture path wires CAPTURE_SYSTEM — not RESEARCH_SYSTEM, no search tools, no audio", () => {
  const prompt = buildCapturePrompt(NOTE);
  const live = liveCaptureRequests({ grokModel: "grok-4-latest", prompt });

  assert.equal(live.grok.url, "https://api.x.ai/v1/chat/completions");
  assert.deepEqual(live.grok.body, grokCaptureRequest("grok-4-latest", prompt));
  assert.deepEqual(live.gemini, geminiCaptureGenerate(prompt));

  const grokJson = JSON.stringify(live.grok.body);
  assert.equal(grokJson.includes(CAPTURE_SYSTEM), true);
  assert.equal(grokJson.includes(RESEARCH_SYSTEM), false);
  assert.doesNotMatch(grokJson, /Search public web sources/);
  assert.equal("tools" in live.grok.body, false);
  assert.doesNotMatch(grokJson, /web_search|googleSearch/);
  assert.doesNotMatch(grokJson, /audio|blob|wav|webm|mpeg/i);

  const geminiJson = JSON.stringify(live.gemini);
  assert.equal(live.gemini.config.systemInstruction, CAPTURE_SYSTEM);
  assert.equal(live.gemini.contents, prompt);
  assert.equal(geminiJson.includes(RESEARCH_SYSTEM), false);
  assert.doesNotMatch(geminiJson, /Search public web sources|googleSearch|web_search/);
  assert.doesNotMatch(geminiJson, /tools/);
  assertNoThirdPartyStt(`${prompt}\n${grokJson}\n${geminiJson}`);
});

test("demo capture never calls live AI hosts and never uploads the graph", () => {
  const items = demoCaptureItems(NOTE);
  const prompt = demoCapturePrompt(NOTE);
  const payload = [prompt, JSON.stringify(items)].join("\n");
  assertDemoCaptureNeedsNoNetwork(payload);
  assertCapturePromptIsCaptureOnly(payload);
  assertNoThirdPartyStt(payload);
  assert.doesNotMatch(payload, /api\.x\.ai|generativelanguage|auth\.x\.ai/);
  assert.doesNotMatch(payload, /Bob Example|people\/bob/);
});

test("audio and raw transcript are dropped — never persisted, never a new STT vendor", () => {
  const store: { audio?: Uint8Array; blobs: unknown[] } = {
    audio: new Uint8Array([1, 2, 3]),
    blobs: [new Uint8Array([9])],
  };
  assert.throws(() => assertNoAudioPersist(store), /must not persist audio/);
  store.audio = undefined;
  store.blobs = [];
  assertNoAudioPersist(store);

  const session = {
    stopped: false,
    aborted: false,
    tracks: 1,
    stop() {
      this.stopped = true;
    },
    abort() {
      this.aborted = true;
    },
    stream: {
      getTracks: () => [
        {
          stop: () => {
            session.tracks = 0;
          },
        },
      ],
    },
  };
  assert.equal(dropCaptureAudio(session), null);
  assert.equal(session.stopped, true);
  assert.equal(session.tracks, 0);
  assert.equal(speechRecognitionAvailable({}), false);
  assert.equal(speechRecognitionAvailable({ webkitSpeechRecognition: function Speech() {} }), true);
  assert.equal(
    transcriptFromSpeechResults([[{ transcript: "Met Ada Demo" }]]),
    "Met Ada Demo",
  );
  assertNoThirdPartyStt("https://api.x.ai/v1/chat/completions");
  assert.throws(() => assertNoThirdPartyStt("https://api.deepgram.com/v1/listen"), /third-party STT/);
});

test("parseCaptureItems reads compact JSON and always offers the capture as a checkable note", () => {
  const parsed = parseCaptureItems(
    JSON.stringify({
      people: [{ name: "Ada Demo", description: "Synthetic", email: "ada.demo@example.invalid" }],
      dates: [{ when: "Tuesday", what: "Golden Gate Park", person: "Ada Demo" }],
      followUps: [{ title: "land-plot", body: "Bring the slip", person: "Ada Demo" }],
    }),
    NOTE,
    42,
  );
  assert.equal(parsed.filter((item) => item.kind === "person")[0]?.email, "ada.demo@example.invalid");
  assert.equal(parsed.some((item) => item.kind === "date" && item.when === "Tuesday"), true);
  assert.equal(parsed.some((item) => item.kind === "follow-up" && /land-plot/.test(item.title)), true);
  assert.equal(parsed.some((item) => item.kind === "note" && item.body === NOTE), true);
  assert.deepEqual(parseCaptureItems("not json", ""), []);
});

test("matching an existing card attaches notes without inventing a second person", () => {
  const proposal = proposeCapture(NOTE, demoCaptureItems(NOTE));
  const plan = planAcceptedCapture(proposal);
  assert.ok(plan);
  const slug = resolveCaptureNoteSlug("Ada Demo", [
    { slug: "ada-demo", title: "Ada Demo" },
    { slug: "bob-example", title: "Bob Example" },
  ]);
  assert.equal(slug, "ada-demo");
  assert.equal(resolveCaptureNoteSlug("Nobody", [{ slug: "ada-demo", title: "Ada Demo" }]), undefined);
  assert.equal(
    plan.notes.every((note) => note.personTitle === "Ada Demo"),
    true,
  );
});

test("capture empty state is only after a request without a provider", () => {
  assert.equal(
    showCaptureEmptyState({
      requested: true,
      demoMode: false,
      hasProvider: false,
      busy: false,
      proposalCount: 0,
    }),
    true,
  );
  assert.equal(
    showCaptureEmptyState({
      requested: true,
      demoMode: true,
      hasProvider: false,
      busy: false,
      proposalCount: 0,
    }),
    false,
  );
  assert.match(CAPTURE_NEEDS_PROVIDER, /Connect Grok or Gemini in Menu/);
  assert.match(CAPTURE_NEEDS_PROVIDER, /no Skuffen cloud account/);
});

test("Latch extra care: Accept-only write, no graph upload, no auto-send, no vendor audio copy", () => {
  const writes: unknown[] = [];
  const sends: unknown[] = [];
  const audioStore: { audio?: unknown; blobs: unknown[] } = { blobs: [] };
  const items = demoCaptureItems(NOTE);
  const proposal = proposeCapture(NOTE, items);
  const prompt = buildCapturePrompt(NOTE);
  const live = liveCaptureRequests({ grokModel: "grok-4-latest", prompt });
  const liveJson = `${prompt}\n${JSON.stringify(live.grok.body)}\n${JSON.stringify(live.gemini)}`;

  assertCapturePromptIsCaptureOnly(liveJson, "Bob Example");
  assertCapturePromptIsCaptureOnly(liveJson, "bob-example");
  assertNoThirdPartyStt(liveJson);
  assertDemoCaptureNeedsNoNetwork(demoCapturePrompt(NOTE));
  assertNoAudioPersist(audioStore);
  assert.deepEqual(captureProposeWrites(), []);
  assertNoAutoWrite(writes);
  assertNoAutoSend(sends);
  assert.match(prompt, /Do not send messages/);
  assert.match(prompt, /Do not upload or request the full graph/);
  assert.doesNotMatch(liveJson, /gmail|imap|smtp|calendar\.google/i);
  assert.doesNotMatch(JSON.stringify(proposal), /xai-|AIza|access_token|localStorage/);

  const dismissed = dismissCaptureProposal();
  assert.equal(dismissed, null);
  const plan = planAcceptedCapture(proposal);
  assert.ok(plan);
  assert.equal(writesForAcceptedCapture(plan)[0]?.type, "person");
});
