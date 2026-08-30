import assert from "node:assert/strict";
import { test } from "node:test";
import type { FactSuggestion, FollowRecord, StoredProposal } from "../models.ts";
import {
  assertNoAutoWrite,
  attachStoredProposalSlug,
  proposeOnly,
  removeSuggestion,
  settingsWithoutSecrets,
  upsertProposal,
  writesForAcceptedSuggestion,
} from "./research.ts";
import {
  appendMemoryTurn,
  clearMemoryLog,
  deleteMemoryTurn,
  followRows,
  forgetMemoryForSlug,
  groupPendingFacts,
  inspectableMemory,
  makeStoredProposal,
  memoryProposeWrites,
  pendingFacts,
  recordMemoryTurn,
  removeProposal,
  toldRows,
  trustForSource,
} from "./memory.ts";

const suggestion: FactSuggestion = {
  id: "research-1",
  source: "research",
  kind: "note",
  title: "First algorithm",
  body: "Wrote notes on the Analytical Engine.",
};

const people = [{ slug: "ada-lovelace", title: "Ada Lovelace" }];

function proposal(overrides: Partial<StoredProposal> = {}): StoredProposal {
  return makeStoredProposal({
    id: "p1",
    slug: "ada-lovelace",
    source: "research",
    createdAt: "2026-08-30T09:00:00Z",
    prompt: "Search the public web for this one person.\nName: Ada Lovelace",
    suggestions: [suggestion],
    ...overrides,
  });
}

test("propose records inspectable memory and does not write OKF", () => {
  const okfWrites: unknown[] = [];
  const stored = upsertProposal([], proposal());
  const turn = recordMemoryTurn({
    id: "told-1",
    now: new Date("2026-08-30T09:00:00Z"),
    slug: "ada-lovelace",
    source: "research",
    prompt: stored[0]!.prompt ?? "",
    suggestions: stored[0]!.suggestions,
  });
  const log = appendMemoryTurn([], turn);
  const rows = inspectableMemory({
    proposals: stored,
    follows: [],
    people,
    memoryLog: log,
  });

  assert.equal(proposeOnly(stored[0]!.suggestions).length, 0);
  assert.deepEqual(memoryProposeWrites(), []);
  assertNoAutoWrite(okfWrites);
  assert.equal(pendingFacts(rows).length, 1);
  assert.equal(pendingFacts(rows)[0]?.wantedSummary, suggestion.body);
  assert.equal(pendingFacts(rows)[0]?.trust, "hostile-web");
  assert.match(toldRows(rows)[0]?.prompt ?? "", /Ada Lovelace/);
  assert.match(toldRows(rows)[0]?.prompt ?? "", /this one person/);
});

test("Accept is the only path that yields an OKF write intent", () => {
  const intent = writesForAcceptedSuggestion("ada-lovelace", suggestion);
  assert.deepEqual(intent, {
    type: "note",
    slug: "ada-lovelace",
    title: "First algorithm",
    body: "Wrote notes on the Analytical Engine.",
  });
});

test("dismiss drops the proposal without an OKF write", () => {
  const writes: unknown[] = [];
  const stored = upsertProposal([], proposal());
  const afterFact = removeSuggestion(stored, suggestion.id);
  const afterGroup = removeProposal(stored, "p1");
  assert.equal(afterFact.length, 0);
  assert.equal(afterGroup.length, 0);
  assert.equal(pendingFacts(inspectableMemory({ proposals: afterFact, follows: [], people })).length, 0);
  assertNoAutoWrite(writes);
});

test("UI lists pending memory: research facts, follow schedules, told log", () => {
  const follows: FollowRecord[] = [
    {
      slug: "ada-lovelace",
      interval: "weekly",
      enabled: true,
      lastRunAt: null,
      nextRunAt: "2026-09-06T09:00:00Z",
    },
  ];
  const stored = [proposal()];
  const log = [
    recordMemoryTurn({
      id: "told-1",
      now: new Date("2026-08-30T09:00:00Z"),
      slug: "ada-lovelace",
      source: "research",
      prompt: "Name: Ada Lovelace\nDo not invent people.",
      suggestions: [suggestion],
    }),
  ];
  const rows = inspectableMemory({ proposals: stored, follows, people, memoryLog: log });
  const groups = groupPendingFacts(pendingFacts(rows));

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.personLabel, "Ada Lovelace");
  assert.equal(groups[0]?.facts[0]?.suggestion.title, "First algorithm");
  assert.equal(followRows(rows).length, 1);
  assert.equal(followRows(rows)[0]?.interval, "weekly");
  assert.equal(toldRows(rows).length, 1);
  assert.match(toldRows(rows)[0]?.wantedSummaries[0] ?? "", /Analytical Engine/);
  assert.equal(trustForSource("research"), "hostile-web");
  assert.equal(trustForSource("follow"), "hostile-web");
  assert.equal(trustForSource("ask"), "local");
  assert.equal(trustForSource("capture"), "local");
});

test("forgetting a deleted person drops told-log rows for that slug only", () => {
  const writes: unknown[] = [];
  const ada = recordMemoryTurn({
    id: "told-ada",
    slug: "ada-lovelace",
    source: "follow",
    prompt: "Name: Ada Lovelace",
    suggestions: [suggestion],
  });
  const bea = recordMemoryTurn({
    id: "told-bea",
    slug: "bea-demo",
    query: "Bea Demo",
    source: "research",
    prompt: "Name: Bea Demo",
    suggestions: [suggestion],
  });
  const after = forgetMemoryForSlug(appendMemoryTurn(appendMemoryTurn([], ada), bea), "ada-lovelace");
  assert.equal(after.length, 1);
  assert.equal(after[0]?.slug, "bea-demo");
  assert.equal(
    inspectableMemory({ proposals: [], follows: [], people, memoryLog: after }).filter((row) =>
      row.personLabel.includes("Ada"),
    ).length,
    0,
  );
  assertNoAutoWrite(writes);
});

test("deleting the told log leaves OKF untouched and can drop history", () => {
  const writes: unknown[] = [];
  const log = appendMemoryTurn(
    [],
    recordMemoryTurn({
      id: "told-1",
      slug: "ada-lovelace",
      source: "follow",
      prompt: "Name: Ada Lovelace",
      suggestions: [suggestion],
    }),
  );
  const afterOne = deleteMemoryTurn(log, "told-1");
  const afterClear = clearMemoryLog();
  assert.equal(afterOne.length, 0);
  assert.equal(afterClear.length, 0);
  assertNoAutoWrite(writes);
});

test("memory settings persist proposals and the told log — never provider tokens", () => {
  const persisted = settingsWithoutSecrets({
    bundleRoot: "/tmp/people-graph",
    proposals: [proposal()],
    memoryLog: [
      recordMemoryTurn({
        slug: "ada-lovelace",
        source: "research",
        prompt: "Name: Ada Lovelace",
        suggestions: [suggestion],
      }),
    ],
    grok_api_key: "xai-leaked",
    access_token: "oauth-leaked",
  });
  const json = JSON.stringify(persisted);
  assert.match(json, /First algorithm/);
  assert.match(json, /Ada Lovelace/);
  assert.doesNotMatch(json, /xai-leaked|oauth-leaked|grok_api_key|access_token/);
});

test("name-research pending memory has no slug and stays off the bundle until Accept", () => {
  const writes: unknown[] = [];
  const stored = [
    makeStoredProposal({
      query: "Ada Lovelace",
      source: "research",
      prompt: "The only identifier you have is the name the user typed.\nName: Ada Lovelace",
      suggestions: [
        {
          id: "email-1",
          source: "research",
          kind: "field",
          field: "email",
          title: "Email",
          value: "ada@example.com",
        },
      ],
    }),
  ];
  const rows = inspectableMemory({ proposals: stored, follows: [], people: [] });
  const pending = pendingFacts(rows);
  assert.equal(pending[0]?.slug, undefined);
  assert.equal(pending[0]?.query, "Ada Lovelace");
  assert.equal(pending[0]?.personLabel, "Ada Lovelace");
  assert.equal(proposeOnly(stored[0]!.suggestions).length, 0);
  assertNoAutoWrite(writes);

  const attached = attachStoredProposalSlug(stored, "Ada Lovelace", "ada-lovelace");
  const afterAccept = inspectableMemory({ proposals: attached, follows: [], people });
  assert.equal(pendingFacts(afterAccept)[0]?.slug, "ada-lovelace");
  assert.equal(proposeOnly(attached[0]!.suggestions).length, 0);
});
