import assert from "node:assert/strict";
import { test } from "node:test";
import type { PersonView } from "../models.ts";
import {
  dismissRelationProposal,
  filterPeopleByRelation,
  inverseWrite,
  peopleMatchingRelationKind,
  planAcceptedRelation,
  proposeRelation,
  relationWritesWithoutAccept,
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
