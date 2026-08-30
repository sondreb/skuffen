import assert from "node:assert/strict";
import { test } from "node:test";
import type { FactSuggestion, FollowRecord, PersonView } from "../models.ts";
import {
  assertNoAutoSend,
  assertNoAutoWrite,
  buildNameResearchPrompt,
  buildResearchPrompt,
  checkedSuggestions,
  deleteProposedFact,
  dismissNameProposal,
  dueFollows,
  extractModelText,
  geminiResearchConfig,
  grokResearchRequest,
  isPublicHttpUrl,
  keepFetchedPhoto,
  mergeFollow,
  nameAcceptErrorMessage,
  nextRunAt,
  parseSuggestions,
  photoFileNameFromUrl,
  photoPreviewUrl,
  planAcceptedNameProposal,
  proposalsForSlug,
  proposeNameResearch,
  proposeOnly,
  readPublicPhotoBytes,
  recordFollowRun,
  removeSuggestion,
  RESEARCH_NEEDS_PROVIDER,
  setAllFactsChecked,
  setFactChecked,
  settingsWithoutSecrets,
  showResearchEmptyState,
  skippedPhotosNotice,
  attachStoredProposalSlug,
  unfollow,
  upsertProposal,
  writesForAcceptedSuggestion,
} from "./research.ts";

function person(overrides: Partial<PersonView> = {}): PersonView {
  return {
    id: "people/ada-lovelace/person",
    slug: "ada-lovelace",
    path: "people/ada-lovelace/person.md",
    title: "Ada Lovelace",
    description: "Mathematician",
    givenName: "Ada",
    familyName: "Lovelace",
    body: "Notes stay on this machine.",
    notes: [{ id: "n1", path: "people/ada-lovelace/notes/engine.md", title: "Engine", body: "Analytical Engine." }],
    social: [
      {
        id: "s1",
        path: "people/ada-lovelace/social/wikipedia.md",
        title: "Wikipedia",
        network: "wikipedia",
        handle: "Ada_Lovelace",
        url: "https://en.wikipedia.org/wiki/Ada_Lovelace",
      },
    ],
    photos: [],
    ...overrides,
  };
}

const suggestion: FactSuggestion = {
  id: "research-1",
  source: "research",
  kind: "note",
  title: "First algorithm",
  body: "Wrote notes on the Analytical Engine.",
};

test("research prompt includes only that person and never the full graph", () => {
  const prompt = buildResearchPrompt(person());
  assert.match(prompt, /Ada Lovelace/);
  assert.match(prompt, /this one person/);
  assert.match(prompt, /Do not invent people/);
  assert.match(prompt, /Do not send messages/);
  assert.doesNotMatch(prompt, /full people-graph/);
  assert.doesNotMatch(prompt, /Bob Example|reconnect shuffle|meeting brief/i);
  assert.doesNotMatch(prompt, /people\/(?!ada-lovelace)/);
});

test("research and follow propose only — no OKF write without Accept", () => {
  const okfWrites: unknown[] = [];
  const parsed = parseSuggestions(
    JSON.stringify({
      suggestions: [
        { kind: "note", title: "Public talk", body: "Spoke in 1843." },
        { kind: "social", title: "Wiki", network: "wikipedia", url: "https://en.wikipedia.org/wiki/Ada_Lovelace" },
      ],
    }),
    "research",
  );
  assert.equal(parsed.length, 2);
  const writes = proposeOnly(parsed);
  assert.deepEqual(writes, []);
  assertNoAutoWrite(okfWrites);
});

test("explicit Accept is the only path that yields an OKF write intent", () => {
  const intent = writesForAcceptedSuggestion("ada-lovelace", suggestion);
  assert.deepEqual(intent, {
    type: "note",
    slug: "ada-lovelace",
    title: "First algorithm",
    body: "Wrote notes on the Analytical Engine.",
  });
});

test("follow due list skips unknown slugs so it never invents people", () => {
  const now = new Date("2026-08-29T21:00:00Z");
  const follows: FollowRecord[] = [
    { slug: "ada-lovelace", interval: "weekly", enabled: true, nextRunAt: "2026-08-01T00:00:00Z" },
    { slug: "invented-stranger", interval: "weekly", enabled: true, nextRunAt: "2026-08-01T00:00:00Z" },
    { slug: "not-yet", interval: "weekly", enabled: true, nextRunAt: "2026-09-10T00:00:00Z" },
  ];
  const due = dueFollows(follows, now, new Set(["ada-lovelace"]));
  assert.deepEqual(
    due.map((item) => item.slug),
    ["ada-lovelace"],
  );
});

test("follow tick records proposals and never writes OKF or sends messages", () => {
  const okfWrites: unknown[] = [];
  const sends: unknown[] = [];
  const uploads: unknown[] = [];
  const now = new Date("2026-08-29T21:00:00Z");
  const follow: FollowRecord = {
    slug: "ada-lovelace",
    interval: "weekly",
    enabled: true,
    nextRunAt: "2026-08-01T00:00:00Z",
  };
  const proposal = {
    id: "follow-ada-1",
    slug: "ada-lovelace",
    source: "follow" as const,
    createdAt: now.toISOString(),
    suggestions: [suggestion],
  };
  const nextFollow = recordFollowRun(follow, now, true);
  const proposals = upsertProposal([], proposal);

  assertNoAutoWrite(okfWrites);
  assertNoAutoSend(sends);
  assert.equal(uploads.length, 0);
  assert.equal(proposals[0]?.source, "follow");
  assert.equal(proposeOnly(proposals[0]!.suggestions).length, 0);
  assert.equal(nextFollow.lastRunAt, now.toISOString());
  assert.equal(nextFollow.nextRunAt, nextRunAt("weekly", now));
});

test("Grok research request uses web_search and never dumps the graph or tokens", () => {
  const prompt = buildResearchPrompt(person());
  const body = grokResearchRequest("grok-4-latest", prompt);
  assert.deepEqual(body.tools, [{ type: "web_search" }]);
  assert.equal("search_parameters" in body, false);
  const json = JSON.stringify(body);
  assert.match(json, /Never request the full people-graph/);
  assert.doesNotMatch(json, /grok_api_key|access_token|localStorage/);
  assert.doesNotMatch(json, /Bob Example|reconnect shuffle|meeting brief/i);
});

test("Gemini research uses Google Search grounding, not Grok routing", () => {
  assert.deepEqual(geminiResearchConfig(), { tools: [{ googleSearch: {} }] });
});

test("follow settings persist schedule only — never provider tokens", () => {
  const now = new Date("2026-08-29T21:00:00Z");
  const follows = mergeFollow([], "ada-lovelace", "weekly", now);
  const persisted = settingsWithoutSecrets({
    bundleRoot: "/tmp/people-graph",
    preferredProvider: "grok",
    follows,
    grok_api_key: "xai-leaked",
    access_token: "oauth-leaked",
  });
  const json = JSON.stringify(persisted);
  assert.match(json, /ada-lovelace/);
  assert.doesNotMatch(json, /xai-leaked|oauth-leaked|grok_api_key|access_token/);
  assert.deepEqual(unfollow(follows, "ada-lovelace"), []);
});

test("rejecting a follow proposal drops it without an OKF write", () => {
  const writes: unknown[] = [];
  const stored = upsertProposal([], {
    id: "p1",
    slug: "ada-lovelace",
    source: "follow",
    createdAt: "2026-08-29T21:00:00Z",
    suggestions: [suggestion],
  });
  const after = removeSuggestion(stored, suggestion.id);
  assert.equal(after.length, 0);
  assert.equal(proposalsForSlug(after, "ada-lovelace").length, 0);
  assertNoAutoWrite(writes);
});

test("name research prompt includes only the typed name and never the graph", () => {
  const prompt = buildNameResearchPrompt("Ada Lovelace");
  assert.match(prompt, /Name: Ada Lovelace/);
  assert.match(prompt, /The only identifier you have is the name the user typed/);
  assert.match(prompt, /public profile photo/);
  assert.doesNotMatch(prompt, /Existing notes|Existing social|Given name:|Family name:|Description:/);
  assert.doesNotMatch(prompt, /Bob Example|reconnect shuffle|meeting brief/i);
  assert.doesNotMatch(prompt, /people\//);
});

test("research-from-name proposes and writes only checked fields on Accept", () => {
  const writes: unknown[] = [];
  const parsed = parseSuggestions(
    JSON.stringify({
      suggestions: [
        { kind: "field", field: "title", title: "Name", value: "Ada Lovelace" },
        { kind: "field", field: "email", title: "Email", value: "ada@example.com" },
        { kind: "field", field: "phone", title: "Phone", value: "+44 20 0000" },
        { kind: "field", field: "body", title: "About", value: "Mathematician and writer." },
        {
          kind: "social",
          title: "Wikipedia",
          network: "wikipedia",
          url: "https://en.wikipedia.org/wiki/Ada_Lovelace",
        },
        {
          kind: "photo",
          title: "Portrait",
          url: "https://upload.wikimedia.org/wikipedia/commons/ada.jpg",
        },
      ],
    }),
    "research",
  );
  assert.equal(proposeOnly(parsed).length, 0);
  assertNoAutoWrite(writes);

  const proposal = proposeNameResearch("Ada Lovelace", parsed);
  const email = proposal.facts.find((fact) => fact.suggestion.field === "email")!;
  const phone = proposal.facts.find((fact) => fact.suggestion.field === "phone")!;
  const about = proposal.facts.find((fact) => fact.suggestion.field === "body")!;
  let next = setFactChecked(proposal, email.id, true);
  next = setFactChecked(next, phone.id, false);
  next = deleteProposedFact(next, about.id);

  const plan = planAcceptedNameProposal(next);
  assert.ok(plan);
  assert.equal(plan.person.title, "Ada Lovelace");
  assert.equal(plan.person.email, "ada@example.com");
  assert.equal(plan.person.phone, undefined);
  assert.equal(plan.person.body, undefined);
  assert.deepEqual(
    plan.extras.map((item) => item.kind).sort(),
    ["photo", "social"],
  );
  const intents = plan.extras.map((item) => writesForAcceptedSuggestion("ada-lovelace", item));
  assert.ok(intents.some((item) => item.type === "social"));
  assert.ok(intents.some((item) => item.type === "photo"));
  assert.ok(!intents.some((item) => item.type === "field"));
});

test("unchecked and deleted name-research fields are not written", () => {
  const parsed = parseSuggestions(
    JSON.stringify({
      suggestions: [
        { kind: "field", field: "email", title: "Email", value: "wrong@example.com" },
        { kind: "field", field: "phone", title: "Phone", value: "+00" },
        { kind: "note", title: "Rumor", body: "Skip this." },
      ],
    }),
    "research",
  );
  const proposal = proposeNameResearch("Ada Lovelace", parsed);
  const email = proposal.facts.find((fact) => fact.suggestion.field === "email")!;
  const rumor = proposal.facts.find((fact) => fact.suggestion.title === "Rumor")!;
  const next = deleteProposedFact(setFactChecked(proposal, email.id, false), rumor.id);
  const plan = planAcceptedNameProposal(next);
  assert.ok(plan);
  assert.equal(plan.person.email, undefined);
  assert.equal(
    plan.extras.some((item) => item.title === "Rumor"),
    false,
  );
  assert.deepEqual(
    checkedSuggestions(next).map((item) => item.field ?? item.kind),
    ["title", "phone"],
  );
});

test("dismissing a name research proposal writes nothing", () => {
  const writes: unknown[] = [];
  const proposal = proposeNameResearch("Ada Lovelace", [
    { id: "n1", kind: "field", field: "email", title: "Email", value: "ada@example.com" },
  ]);
  const dismissed = dismissNameProposal();
  assert.equal(dismissed, null);
  assert.equal(planAcceptedNameProposal(setAllFactsChecked(proposal, false)), null);
  assert.deepEqual(proposeOnly(proposal.facts.map((fact) => fact.suggestion)), []);
  assertNoAutoWrite(writes);
});

test("photo bytes stay off disk until Accept, and a failed fetch is skipped", () => {
  const suggestion: FactSuggestion = {
    id: "photo-1",
    kind: "photo",
    title: "Portrait",
    url: "https://example.com/ada.jpg",
  };
  const intent = writesForAcceptedSuggestion("ada-lovelace", suggestion);
  assert.deepEqual(intent, {
    type: "photo",
    slug: "ada-lovelace",
    url: "https://example.com/ada.jpg",
    title: "Portrait",
  });
  if (intent.type !== "photo") throw new Error("expected photo write");
  assert.equal(keepFetchedPhoto(intent, null), null);
  const stored = keepFetchedPhoto(intent, new Uint8Array([1, 2, 3]));
  assert.equal(stored?.bytes.byteLength, 3);
  assert.equal(isPublicHttpUrl("javascript:alert(1)"), false);
  assert.equal(photoFileNameFromUrl("https://cdn.example/pic.PNG", "research-1"), "research-1.png");
});

test("photo proposal previews only public http(s) image URLs", () => {
  assert.equal(
    photoPreviewUrl({ kind: "photo", url: "https://upload.example/ada.jpg" }),
    "https://upload.example/ada.jpg",
  );
  assert.equal(photoPreviewUrl({ kind: "photo", url: "http://cdn.example/ada.jpg" }), "http://cdn.example/ada.jpg");
  assert.equal(photoPreviewUrl({ kind: "photo", url: "javascript:alert(1)" }), null);
  assert.equal(photoPreviewUrl({ kind: "photo", url: "data:image/png;base64,aa" }), null);
  assert.equal(photoPreviewUrl({ kind: "note", url: "https://example.com/ada.jpg" }), null);
  assert.equal(photoPreviewUrl({ kind: "photo" }), null);
});

test("photo fetch throws or returns empty bytes are skipped, not thrown", async () => {
  assert.equal(await readPublicPhotoBytes("javascript:alert(1)", async () => new Uint8Array([1])), null);
  assert.equal(
    await readPublicPhotoBytes("https://example.com/ada.jpg", async () => {
      throw new Error("network down");
    }),
    null,
  );
  assert.equal(await readPublicPhotoBytes("https://example.com/ada.jpg", async () => new Uint8Array()), null);
  const bytes = await readPublicPhotoBytes("https://example.com/ada.jpg", async () => new Uint8Array([9, 8]));
  assert.deepEqual(bytes, new Uint8Array([9, 8]));
});

test("Accept failures surface a message and skipped photos become a notice", () => {
  assert.equal(nameAcceptErrorMessage(new Error("Person not found")), "Person not found");
  assert.equal(nameAcceptErrorMessage(""), "Could not save the proposed card.");
  assert.equal(skippedPhotosNotice(0), null);
  assert.equal(skippedPhotosNotice(1), "1 photo could not be fetched. The rest of the card was saved.");
  assert.equal(skippedPhotosNotice(2), "2 photos could not be fetched. The rest of the card was saved.");
});

test("name research attaches the created slug only on Accept", () => {
  const writes: unknown[] = [];
  const stored = [
    {
      id: "research-Ada Lovelace-1",
      slug: "",
      query: "Ada Lovelace",
      source: "research" as const,
      createdAt: "2026-08-30T09:00:00Z",
      suggestions: [suggestion],
    },
    {
      id: "capture-note-1",
      slug: "",
      query: "Ada Lovelace",
      source: "capture" as const,
      createdAt: "2026-08-30T09:00:00Z",
      suggestions: [suggestion],
    },
  ];
  const attached = attachStoredProposalSlug(stored, "Ada Lovelace", "ada-lovelace");
  assert.equal(attached[0]?.slug, "ada-lovelace");
  assert.equal(attached[1]?.slug, "");
  assert.deepEqual(proposeOnly(stored[0]!.suggestions), []);
  assertNoAutoWrite(writes);
});

test("research empty state is only after a request without a provider", () => {
  assert.equal(
    showResearchEmptyState({
      requested: true,
      demoMode: false,
      hasProvider: false,
      busy: false,
      proposalCount: 0,
    }),
    true,
  );
  assert.equal(
    showResearchEmptyState({
      requested: false,
      demoMode: false,
      hasProvider: false,
      busy: false,
      proposalCount: 0,
    }),
    false,
  );
  assert.equal(
    showResearchEmptyState({
      requested: true,
      demoMode: true,
      hasProvider: false,
      busy: false,
      proposalCount: 0,
    }),
    false,
  );
  assert.equal(
    showResearchEmptyState({
      requested: true,
      demoMode: false,
      hasProvider: true,
      busy: false,
      proposalCount: 0,
    }),
    false,
  );
  assert.equal(
    showResearchEmptyState({
      requested: true,
      demoMode: false,
      hasProvider: false,
      busy: true,
      proposalCount: 0,
    }),
    false,
  );
  assert.equal(
    showResearchEmptyState({
      requested: true,
      demoMode: false,
      hasProvider: false,
      busy: false,
      proposalCount: 1,
    }),
    false,
  );
});

test("research empty copy tells the visitor to connect a provider in Menu", () => {
  assert.match(RESEARCH_NEEDS_PROVIDER, /Connect Grok or Gemini in Menu/);
  assert.match(RESEARCH_NEEDS_PROVIDER, /no Skuffen cloud account/);
  assert.doesNotMatch(RESEARCH_NEEDS_PROVIDER, /No proposals yet/);
  assert.doesNotMatch(RESEARCH_NEEDS_PROVIDER, /voice|shuffle|brief/i);
});

test("extractModelText reads Responses API and chat completions", () => {
  assert.equal(extractModelText({ output_text: '{"suggestions":[]}' }), '{"suggestions":[]}');
  assert.equal(
    extractModelText({ choices: [{ message: { content: '{"suggestions":[{"title":"A"}]}' } }] }),
    '{"suggestions":[{"title":"A"}]}',
  );
  assert.equal(
    extractModelText({
      output: [{ type: "message", content: [{ type: "output_text", text: '{"suggestions":[]}' }] }],
    }),
    '{"suggestions":[]}',
  );
});
