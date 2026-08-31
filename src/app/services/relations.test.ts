import assert from "node:assert/strict";
import { test } from "node:test";
import type { PersonView } from "../models.ts";
import {
  collapseEquivalentSuggestions,
  demoRelationSuggestion,
  dismissRelationProposal,
  equivalentSuggestionIds,
  filterPeopleByRelation,
  inverseWrite,
  peopleMatchingRelationKind,
  planAcceptedRelation,
  proposeRelation,
  relationOfferKey,
  relationWritesWithoutAccept,
  resolveRelationTitles,
  setRelationChecked,
  writesForAcceptedRelation,
} from "./relations.ts";

function person(overrides: Partial<PersonView> = {}): PersonView {
  const slug = overrides.slug ?? "ada-demo";
  return {
    id: `people/${slug}/person`,
    slug,
    path: `people/${slug}/person.md`,
    title: overrides.title ?? "Ada Demo",
    description: "Synthetic demo card — not a real person",
    body: "Notes stay on this machine.",
    notes: [],
    social: [],
    photos: [],
    documents: [],
    relations: [],
    ...overrides,
  };
}

test("accept sibling plans a write on this card; inverse is the other card", () => {
  const proposal = proposeRelation({
    slug: "ada-demo",
    relatedSlug: "bea-demo",
    relatedTitle: "Bea Demo",
    kind: "family",
    role: "sibling",
  });
  const write = planAcceptedRelation("ada-demo", proposal);
  assert.deepEqual(write, {
    slug: "ada-demo",
    relatedSlug: "bea-demo",
    kind: "family",
    role: "sibling",
  });
  assert.deepEqual(inverseWrite(write!), {
    slug: "bea-demo",
    relatedSlug: "ada-demo",
    kind: "family",
    role: "sibling",
  });
});

test("uncheck and reject write nothing", () => {
  const proposal = proposeRelation({
    slug: "ada-demo",
    relatedSlug: "bea-demo",
    relatedTitle: "Bea Demo",
    kind: "family",
    role: "sibling",
  });
  assert.equal(planAcceptedRelation("ada-demo", setRelationChecked(proposal, false)), null);
  assert.equal(dismissRelationProposal(), null);
  assert.deepEqual(relationWritesWithoutAccept(proposal), []);
  assert.deepEqual(relationWritesWithoutAccept(null), []);
  assert.equal(writesForAcceptedRelation("ada-demo", { ...proposal.suggestion, kind: "note" }), null);
});

test("filter people by relation kind", () => {
  const ada = person({
    slug: "ada-demo",
    title: "Ada Demo",
    relations: [
      {
        kind: "family",
        role: "sibling",
        slug: "bea-demo",
        path: "people/bea-demo/person.md",
        title: "Bea Demo",
      },
    ],
  });
  const bea = person({
    slug: "bea-demo",
    title: "Bea Demo",
    relations: [
      {
        kind: "family",
        role: "sibling",
        slug: "ada-demo",
        path: "people/ada-demo/person.md",
        title: "Ada Demo",
      },
    ],
  });
  const cal = person({ slug: "cal-demo", title: "Cal Demo" });
  assert.deepEqual(
    peopleMatchingRelationKind([ada, bea, cal], "family").map((item) => item.slug),
    ["ada-demo", "bea-demo"],
  );
  assert.deepEqual(peopleMatchingRelationKind([ada, bea, cal], "business"), []);
  assert.equal(filterPeopleByRelation([ada, bea, cal], "sibling", "family").length, 2);
  assert.equal(filterPeopleByRelation([ada, bea, cal], "Cal", "").length, 1);
});

test("relation rows resolve the other person's title, not their slug", () => {
  const ada = person({
    slug: "ada-demo",
    title: "Ada Demo",
    relations: [
      {
        kind: "family",
        role: "sibling",
        slug: "bea-demo",
        path: "people/bea-demo/person.md",
        title: "bea-demo",
      },
    ],
  });
  const bea = person({
    slug: "bea-demo",
    title: "Bea Demo",
    relations: [
      {
        kind: "family",
        role: "sibling",
        slug: "ada-demo",
        path: "people/ada-demo/person.md",
        title: "ada-demo",
      },
    ],
  });
  const [adaTitled, beaTitled] = resolveRelationTitles([ada, bea]);
  assert.equal(adaTitled?.relations[0]?.title, "Bea Demo");
  assert.equal(beaTitled?.relations[0]?.title, "Ada Demo");
});

test("Suggest facts and Research collapse to one sibling offer; dismiss covers both ids", () => {
  const ask = {
    id: "demo-relation-bea-demo",
    source: "ask" as const,
    kind: "relation" as const,
    title: "Sibling of Bea Demo (demo)",
    relationKind: "family" as const,
    relationRole: "sibling",
    relatedSlug: "bea-demo",
  };
  const research = {
    id: "legacy-research-relation-bea-demo",
    source: "research" as const,
    kind: "relation" as const,
    title: "Sibling of Bea Demo (demo)",
    relationKind: "family" as const,
    relationRole: "sibling",
    relatedSlug: "bea-demo",
  };
  const note = {
    id: "demo-research-ada-note",
    source: "research" as const,
    kind: "note" as const,
    title: "Public park mention (demo)",
  };
  assert.equal(relationOfferKey(ask), relationOfferKey(research));
  const collapsed = collapseEquivalentSuggestions([ask, research, note]);
  assert.deepEqual(
    collapsed.map((item) => item.id),
    ["demo-relation-bea-demo", "demo-research-ada-note"],
  );
  assert.deepEqual(equivalentSuggestionIds([ask, research, note], research).sort(), [
    "demo-relation-bea-demo",
    "legacy-research-relation-bea-demo",
  ]);
});

test("demo ask and research mint the same sibling id so Accept cannot write a twin", () => {
  const other = { slug: "bea-demo", title: "Bea Demo" };
  const fromAsk = demoRelationSuggestion("ask", other);
  const fromResearch = demoRelationSuggestion("research", other);
  assert.equal(fromAsk.id, "demo-relation-bea-demo");
  assert.equal(fromResearch.id, fromAsk.id);
  assert.equal(relationOfferKey(fromAsk), relationOfferKey(fromResearch));
});

test("never uploads and never stores tokens on a relation write", () => {
  const write = writesForAcceptedRelation("ada-demo", {
    id: "rel-1",
    kind: "relation",
    title: "Sibling of Bea Demo",
    relationKind: "family",
    relationRole: "sibling",
    relatedSlug: "bea-demo",
  });
  const blob = JSON.stringify(write);
  assert.doesNotMatch(blob, /token|secret|password|api[_-]?key|authorization|bearer/i);
  assert.doesNotMatch(blob, /https?:\/\/|skuffen\.cloud/i);
});
