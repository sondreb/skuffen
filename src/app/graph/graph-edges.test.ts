import assert from "node:assert/strict";
import { test } from "node:test";
import type { PersonView, RelationKind } from "../models.ts";
import {
  graphEdgeId,
  graphKindLabel,
  graphLegendKinds,
  layoutPeopleGraph,
  peopleGraphModel,
} from "./graph-edges.ts";

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
    tags: [],
    ...overrides,
  };
}

function edge(
  kind: RelationKind | "knows" | "introduced-by",
  slug: string,
  title: string,
): PersonView["relations"][number] {
  return {
    kind: kind as RelationKind,
    role: kind === "family" ? "sibling" : kind,
    slug,
    path: `people/${slug}/person.md`,
    title,
  };
}

test("two related people become nodes with one typed family edge", () => {
  const ada = person({
    slug: "ada-demo",
    title: "Ada Demo",
    relations: [edge("family", "bea-demo", "Bea Demo")],
  });
  const bea = person({
    slug: "bea-demo",
    title: "Bea Demo",
    relations: [edge("family", "ada-demo", "Ada Demo")],
  });
  const graph = peopleGraphModel([ada, bea]);
  assert.deepEqual(
    graph.nodes.map((node) => node.slug),
    ["ada-demo", "bea-demo"],
  );
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0]?.id, graphEdgeId("ada-demo", "bea-demo", "family"));
  assert.equal(graph.edges[0]?.kind, "family");
});

test("sibling both sides collapses to one edge — no ranking", () => {
  const ada = person({
    relations: [edge("family", "bea-demo", "Bea Demo")],
  });
  const bea = person({
    slug: "bea-demo",
    title: "Bea Demo",
    relations: [edge("family", "ada-demo", "Ada Demo")],
  });
  assert.equal(peopleGraphModel([ada, bea]).edges.length, 1);
  assert.equal(peopleGraphModel([bea, ada]).edges.length, 1);
});

test("people without a place still appear — this is not the map", () => {
  const ada = person({
    relations: [edge("family", "bea-demo", "Bea Demo")],
  });
  const bea = person({ slug: "bea-demo", title: "Bea Demo" });
  const graph = peopleGraphModel([ada, bea]);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0]?.kind, "family");
});

test("empty graph invents nothing", () => {
  assert.deepEqual(peopleGraphModel([]), { nodes: [], edges: [] });
});

test("isolated people stay as nodes with no invented edges", () => {
  const graph = peopleGraphModel([person(), person({ slug: "bea-demo", title: "Bea Demo" })]);
  assert.equal(graph.nodes.length, 2);
  assert.deepEqual(graph.edges, []);
});

test("family, business, and other stay separate typed lines", () => {
  const ada = person({
    relations: [
      edge("family", "bea-demo", "Bea Demo"),
      edge("business", "bea-demo", "Bea Demo"),
      edge("other", "bea-demo", "Bea Demo"),
    ],
  });
  const bea = person({ slug: "bea-demo", title: "Bea Demo" });
  const kinds = peopleGraphModel([ada, bea]).edges.map((item) => item.kind);
  assert.deepEqual(kinds, ["business", "family", "other"]);
});

test("knows and introduced-by draw when those labels exist as edge types", () => {
  const ada = person({
    relations: [edge("knows", "bea-demo", "Bea Demo"), edge("introduced-by", "bea-demo", "Bea Demo")],
  });
  const bea = person({ slug: "bea-demo", title: "Bea Demo" });
  const kinds = peopleGraphModel([ada, bea]).edges.map((item) => item.kind);
  assert.deepEqual(kinds, ["introduced-by", "knows"]);
  assert.deepEqual(graphLegendKinds(peopleGraphModel([ada, bea]).edges), ["knows", "introduced-by"]);
  assert.equal(graphKindLabel("knows"), "Knows");
  assert.equal(graphKindLabel("introduced-by"), "Introduced by");
});

test("layout is slug-ordered and same-size — never closeness", () => {
  const two = layoutPeopleGraph(["bea-demo", "ada-demo"], 1000, 700);
  assert.ok(two.get("ada-demo"));
  assert.ok(two.get("bea-demo"));
  assert.equal(two.get("ada-demo")!.x < two.get("bea-demo")!.x, true);
  const again = layoutPeopleGraph(["bea-demo", "ada-demo"], 1000, 700);
  assert.deepEqual(two.get("ada-demo"), again.get("ada-demo"));
  assert.deepEqual(layoutPeopleGraph([], 1000, 700).size, 0);
});

test("projection never scores, never heats, never stores tokens", () => {
  const ada = person({
    relations: [edge("family", "bea-demo", "Bea Demo")],
  });
  const bea = person({ slug: "bea-demo", title: "Bea Demo" });
  const dumped = JSON.stringify(peopleGraphModel([ada, bea]));
  assert.doesNotMatch(dumped, /score|heat|rank|closeness|friend-heat/i);
  assert.doesNotMatch(dumped, /token|secret|password|api[_-]?key|skuffen\.cloud/i);
  for (const edge of peopleGraphModel([ada, bea]).edges) {
    assert.equal("score" in edge, false);
    assert.equal("weight" in edge, false);
    assert.equal("rank" in edge, false);
  }
});
