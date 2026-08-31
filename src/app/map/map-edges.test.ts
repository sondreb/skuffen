import assert from "node:assert/strict";
import { test } from "node:test";
import type { PersonView } from "../models.ts";
import { edgeId, mapRelationEdges } from "./map-edges.ts";

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
    places: [],
    ...overrides,
  };
}

function pin(slug: string, latitude: number, longitude: number) {
  return {
    path: `people/${slug}/place.md`,
    title: "Demo pin",
    latitude,
    longitude,
    source: "pin",
  };
}

test("draws one family line when both people have a place", () => {
  const ada = person({
    slug: "ada-demo",
    title: "Ada Demo",
    location: pin("ada-demo", 37.7694, -122.4862),
    relations: [
      { kind: "family", role: "sibling", slug: "bea-demo", path: "people/bea-demo/person.md", title: "Bea Demo" },
    ],
  });
  const bea = person({
    slug: "bea-demo",
    title: "Bea Demo",
    location: pin("bea-demo", 37.8039, -122.4662),
    relations: [
      { kind: "family", role: "sibling", slug: "ada-demo", path: "people/ada-demo/person.md", title: "Ada Demo" },
    ],
  });
  const edges = mapRelationEdges([ada, bea]);
  assert.equal(edges.length, 1);
  assert.equal(edges[0]?.id, edgeId("ada-demo", "bea-demo", "family"));
  assert.equal(edges[0]?.kind, "family");
  assert.equal(edges[0]?.from.slug, "ada-demo");
  assert.equal(edges[0]?.to.slug, "bea-demo");
});

test("sibling both sides collapses to one overlay line", () => {
  const ada = person({
    slug: "ada-demo",
    location: pin("ada-demo", 1, 2),
    relations: [
      { kind: "family", role: "sibling", slug: "bea-demo", path: "people/bea-demo/person.md", title: "Bea Demo" },
    ],
  });
  const bea = person({
    slug: "bea-demo",
    title: "Bea Demo",
    location: pin("bea-demo", 3, 4),
    relations: [
      { kind: "family", role: "sibling", slug: "ada-demo", path: "people/ada-demo/person.md", title: "Ada Demo" },
    ],
  });
  assert.equal(mapRelationEdges([ada, bea]).length, 1);
  assert.equal(mapRelationEdges([bea, ada]).length, 1);
});

test("skips an edge when the other person has no place", () => {
  const ada = person({
    location: pin("ada-demo", 1, 2),
    relations: [
      { kind: "family", role: "sibling", slug: "bea-demo", path: "people/bea-demo/person.md", title: "Bea Demo" },
    ],
  });
  const bea = person({ slug: "bea-demo", title: "Bea Demo" });
  assert.deepEqual(mapRelationEdges([ada, bea]), []);
});

test("empty graph and people without places stay empty — no invented pins", () => {
  assert.deepEqual(mapRelationEdges([]), []);
  assert.deepEqual(
    mapRelationEdges([
      person({
        relations: [
          { kind: "other", role: "friend", slug: "bea-demo", path: "people/bea-demo/person.md", title: "Bea Demo" },
        ],
      }),
      person({ slug: "bea-demo", title: "Bea Demo" }),
    ]),
    [],
  );
});

test("family, business, and other are separate lines — no ranking", () => {
  const ada = person({
    location: pin("ada-demo", 1, 2),
    relations: [
      { kind: "family", role: "sibling", slug: "bea-demo", path: "people/bea-demo/person.md", title: "Bea Demo" },
      { kind: "business", role: "colleague", slug: "bea-demo", path: "people/bea-demo/person.md", title: "Bea Demo" },
      { kind: "other", role: "friend", slug: "bea-demo", path: "people/bea-demo/person.md", title: "Bea Demo" },
    ],
  });
  const bea = person({
    slug: "bea-demo",
    title: "Bea Demo",
    location: pin("bea-demo", 3, 4),
    relations: [],
  });
  const kinds = mapRelationEdges([ada, bea]).map((edge) => edge.kind);
  assert.deepEqual(kinds, ["family", "business", "other"]);
});

test("never uploads and never stores tokens on an overlay projection", () => {
  const ada = person({
    location: pin("ada-demo", 1, 2),
    relations: [
      { kind: "family", role: "sibling", slug: "bea-demo", path: "people/bea-demo/person.md", title: "Bea Demo" },
    ],
  });
  const bea = person({
    slug: "bea-demo",
    title: "Bea Demo",
    location: pin("bea-demo", 3, 4),
  });
  const dumped = JSON.stringify(mapRelationEdges([ada, bea]));
  assert.doesNotMatch(dumped, /token|secret|password|api[_-]?key|skuffen\.cloud/i);
});
