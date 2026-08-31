import assert from "node:assert/strict";
import { test } from "node:test";
import type { PersonView } from "../models.ts";
import {
  assertNoAutoMerge,
  deleteMergeField,
  dismissMergeProposal,
  findDuplicateCandidates,
  identityOverlaps,
  mergeWritesWithoutAccept,
  pairKey,
  planAcceptedMerge,
  proposeMerge,
  rememberDismissedPair,
  setAllMergeFieldsKept,
  setMergeFieldKept,
} from "./merge.ts";

function person(overrides: Partial<PersonView> = {}): PersonView {
  const slug = overrides.slug ?? "ada-demo";
  return {
    id: `people/${slug}/person`,
    slug,
    path: `people/${slug}/person.md`,
    title: "Ada Demo",
    description: "Synthetic demo card — not a real person",
    body: "# About\n\nNotes and social links for Ada Demo live beside this document.",
    notes: [],
    social: [],
    photos: [],
    documents: [],
    relations: [],
    places: [],
    ...overrides,
  };
}

const twin = () =>
  person({
    slug: "ada-demo-twin",
    title: "Ada Demo Twin",
    description: "Second synthetic card — email overlap only",
    email: "ada.demo@example.invalid",
    notes: [
      {
        id: "n-twin",
        path: "people/ada-demo-twin/notes/engine.md",
        title: "Engine (demo)",
        body: "Synthetic note from the twin card.",
      },
    ],
  });

test("name string alone never proposes a merge", () => {
  const writes: unknown[] = [];
  const a = person({ slug: "ada-one", title: "Ada Demo" });
  const b = person({ slug: "ada-two", title: "Ada Demo" });
  assert.deepEqual(identityOverlaps(a, b), []);
  assert.deepEqual(findDuplicateCandidates([a, b]), []);
  assert.deepEqual(mergeWritesWithoutAccept(null), []);
  assertNoAutoMerge(writes);
});

test("proposal appears when email overlaps — nothing merges until Accept", () => {
  const writes: unknown[] = [];
  const a = person({ slug: "ada-demo", email: "ada.demo@example.invalid" });
  const b = twin();
  const candidates = findDuplicateCandidates([a, b]);
  assert.equal(candidates.length, 1);
  assert.deepEqual(
    candidates[0]!.overlaps.map((item) => item.kind),
    ["email"],
  );
  const slugs = [candidates[0]!.keeper.slug, candidates[0]!.incoming.slug].sort();
  assert.deepEqual(slugs, ["ada-demo", "ada-demo-twin"]);
  const proposal = proposeMerge(a, b, candidates[0]!.overlaps);
  assert.equal(proposal.keeperSlug, "ada-demo");
  assert.equal(proposal.incomingSlug, "ada-demo-twin");
  assert.ok(proposal.fields.some((field) => field.kind === "note" && field.keep));
  assert.deepEqual(mergeWritesWithoutAccept(proposal), []);
  assertNoAutoMerge(writes);
});

test("social URL or handle overlap proposes; mismatched social does not", () => {
  const wiki = {
    id: "s1",
    path: "people/ada-demo/social/wikipedia.md",
    title: "Wikipedia",
    network: "wikipedia",
    handle: "Ada_Demo",
    url: "https://en.wikipedia.org/wiki/Ada_Demo",
  };
  const a = person({ slug: "ada-demo", social: [wiki] });
  const b = person({
    slug: "ada-other",
    title: "Other Ada",
    social: [{ ...wiki, id: "s2", path: "people/ada-other/social/wikipedia.md" }],
  });
  assert.ok(identityOverlaps(a, b).some((item) => item.kind === "social"));
  const c = person({
    slug: "ada-stranger",
    title: "Ada Demo",
    social: [
      {
        id: "s3",
        path: "people/ada-stranger/social/web.md",
        title: "Other site",
        network: "web",
        handle: "someone-else",
        url: "https://example.invalid/someone-else",
      },
    ],
  });
  assert.deepEqual(identityOverlaps(a, c), []);
});

test("Accept plan merges kept fields into one keeper and drops the incoming slug", () => {
  const a = person({
    slug: "ada-demo",
    email: "ada.demo@example.invalid",
    phone: "+1 555 0100",
  });
  const b = person({
    slug: "ada-demo-twin",
    title: "Ada Demo Twin",
    email: "ada.demo@example.invalid",
    phone: "+1 555 0199",
    description: "Keep this how-you-know-them",
    notes: [
      {
        id: "n1",
        path: "people/ada-demo-twin/notes/park.md",
        title: "Park mention",
        body: "Synthetic park note.",
      },
    ],
    social: [
      {
        id: "s1",
        path: "people/ada-demo-twin/social/web.md",
        title: "Demo site",
        network: "web",
        handle: "ada-demo",
        url: "https://example.invalid/ada-demo",
      },
    ],
  });
  const proposal = proposeMerge(a, b, identityOverlaps(a, b));
  const phone = proposal.fields.find((field) => field.field === "phone")!;
  const description = proposal.fields.find((field) => field.field === "description")!;
  const rumor = proposal.fields.find((field) => field.kind === "note")!;
  let next = setMergeFieldKept(proposal, phone.id, false);
  next = setMergeFieldKept(next, description.id, true);
  next = deleteMergeField(next, rumor.id);
  const plan = planAcceptedMerge(next);
  assert.equal(plan.keeperSlug, "ada-demo");
  assert.equal(plan.incomingSlug, "ada-demo-twin");
  assert.equal(plan.fields.phone, undefined);
  assert.equal(plan.fields.description, "Keep this how-you-know-them");
  assert.equal(plan.notes.length, 0);
  assert.equal(plan.social.length, 1);
  assert.equal(plan.social[0]?.url, "https://example.invalid/ada-demo");
});

test("dismiss leaves both people and writes nothing", () => {
  const writes: unknown[] = [];
  const a = person({ slug: "ada-demo", email: "ada.demo@example.invalid" });
  const b = twin();
  const proposal = proposeMerge(a, b, identityOverlaps(a, b));
  assert.equal(dismissMergeProposal(), null);
  assert.deepEqual(mergeWritesWithoutAccept(proposal), []);
  assertNoAutoMerge(writes);
  const remembered = rememberDismissedPair([], a.slug, b.slug);
  assert.equal(remembered[0], pairKey(a.slug, b.slug));
  assert.deepEqual(findDuplicateCandidates([a, b], remembered), []);
  assert.equal(a.slug, "ada-demo");
  assert.equal(b.slug, "ada-demo-twin");
});

test("unchecked incoming fields are not applied on Accept", () => {
  const a = person({ slug: "ada-demo", email: "ada.demo@example.invalid" });
  const b = person({
    slug: "ada-demo-twin",
    title: "Ada Demo Twin",
    email: "ada.demo@example.invalid",
    description: "Drop this",
    phone: "+1 555 0100",
  });
  const proposal = setAllMergeFieldsKept(proposeMerge(a, b, identityOverlaps(a, b)), false);
  const plan = planAcceptedMerge(proposal);
  assert.deepEqual(plan.fields, {});
  assert.deepEqual(plan.notes, []);
  assert.equal(plan.incomingSlug, "ada-demo-twin");
});

test("detecting a pair never yields an OKF write — no silent merge", () => {
  const writes: unknown[] = [];
  const a = person({ slug: "ada-demo", email: "ADA.DEMO@example.invalid" });
  const b = twin();
  const candidates = findDuplicateCandidates([a, b]);
  assert.equal(candidates.length, 1);
  const proposal = proposeMerge(candidates[0]!.keeper, candidates[0]!.incoming, candidates[0]!.overlaps);
  assert.deepEqual(mergeWritesWithoutAccept(proposal), []);
  assertNoAutoMerge(writes);
  assert.notEqual(a.slug, b.slug);
});
