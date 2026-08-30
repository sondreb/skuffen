import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  RELATIONS_TYPE,
  createPersonDocument,
  createRelationsDocument,
  inverseRelationRole,
  normalizeRelationList,
  parseDocument,
  personPath,
  relationsFromDocument,
  relationsPath,
  removeRelation,
  retargetRelationsForSlug,
  serializeDocument,
  slugFromPersonPath,
  upsertRelation,
  wipeRelationsForSlug,
} from "./index.ts";

test("file path is the Relations identity", () => {
  const doc = createRelationsDocument({
    slug: "ada-lovelace",
    relations: [{ kind: "family", role: "sibling", person: personPath("bea-demo") }],
  });
  assert.equal(doc.path, "people/ada-lovelace/relations.md");
  assert.equal(doc.id, "people/ada-lovelace/relations");
  assert.equal(relationsPath("ada-lovelace"), "people/ada-lovelace/relations.md");
  assert.equal(doc.frontmatter.type, RELATIONS_TYPE);
  assert.equal(slugFromPersonPath("people/bea-demo/person.md"), "bea-demo");
});

test("round-trips a sibling list on relations.md — no tokens", () => {
  const doc = createRelationsDocument({
    slug: "ada-demo",
    relations: [{ kind: "family", role: "sibling", person: personPath("bea-demo") }],
  });
  const raw = serializeDocument(doc);
  const parsed = parseDocument(doc.path, raw);
  assert.equal(parsed.frontmatter.type, "Relations");
  const edges = relationsFromDocument(parsed);
  assert.equal(edges.length, 1);
  assert.equal(edges[0]?.kind, "family");
  assert.equal(edges[0]?.role, "sibling");
  assert.equal(edges[0]?.person, "people/bea-demo/person.md");
  assert.doesNotMatch(raw, /token|secret|password|api[_-]?key|authorization|bearer/i);
  assert.doesNotMatch(raw, /skuffen\.cloud/i);
});

test("add sibling writes both sides; inverse parent/child", () => {
  const ada = upsertRelation([], { kind: "family", role: "sibling", person: personPath("bea-demo") });
  const bea = upsertRelation([], { kind: "family", role: inverseRelationRole("sibling"), person: personPath("ada-demo") });
  assert.deepEqual(ada, [{ kind: "family", role: "sibling", person: "people/bea-demo/person.md" }]);
  assert.deepEqual(bea, [{ kind: "family", role: "sibling", person: "people/ada-demo/person.md" }]);
  assert.equal(inverseRelationRole("parent"), "child");
  assert.equal(inverseRelationRole("child"), "parent");
  assert.equal(inverseRelationRole("cousin"), "cousin");
});

test("wiping a slug drops that person's edges from the list", () => {
  const edges = normalizeRelationList([
    { kind: "family", role: "sibling", person: personPath("bea-demo") },
    { kind: "other", role: "friend", person: personPath("cal-demo") },
  ]);
  const after = wipeRelationsForSlug(edges, "bea-demo");
  assert.deepEqual(after, [{ kind: "other", role: "friend", person: "people/cal-demo/person.md" }]);
  assert.deepEqual(removeRelation(edges, { person: personPath("bea-demo"), kind: "family", role: "sibling" }), [
    { kind: "other", role: "friend", person: "people/cal-demo/person.md" },
  ]);
});

test("retarget keeps file path as identity when a slug is merged", () => {
  const edges = [{ kind: "family", role: "sibling", person: personPath("ada-demo-twin") }];
  const next = retargetRelationsForSlug(edges, "ada-demo-twin", "ada-demo");
  assert.deepEqual(next, [{ kind: "family", role: "sibling", person: "people/ada-demo/person.md" }]);
});

test("persists relations.md beside a Person and survives reload", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-rel-"));
  const ada = createPersonDocument({ slug: "ada-demo", title: "Ada Demo" });
  const bea = createPersonDocument({ slug: "bea-demo", title: "Bea Demo" });
  const adaRel = createRelationsDocument({
    slug: "ada-demo",
    relations: [{ kind: "family", role: "sibling", person: personPath("bea-demo") }],
  });
  const beaRel = createRelationsDocument({
    slug: "bea-demo",
    relations: [{ kind: "family", role: "sibling", person: personPath("ada-demo") }],
  });
  for (const doc of [ada, bea, adaRel, beaRel]) {
    const abs = join(root, doc.path);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, serializeDocument(doc), "utf8");
  }
  const reloaded = relationsFromDocument(
    parseDocument(adaRel.path, readFileSync(join(root, adaRel.path), "utf8")),
  );
  const other = relationsFromDocument(
    parseDocument(beaRel.path, readFileSync(join(root, beaRel.path), "utf8")),
  );
  assert.equal(reloaded[0]?.person, "people/bea-demo/person.md");
  assert.equal(other[0]?.person, "people/ada-demo/person.md");
  assert.doesNotMatch(readFileSync(join(root, adaRel.path), "utf8"), /token|secret|api[_-]?key/i);
});

test("drops remote or non-person targets — path stays a local person.md", () => {
  const edges = normalizeRelationList([
    { kind: "family", role: "sibling", person: "https://example.com/bea" },
    { kind: "family", role: "sibling", person: "people/bea-demo/notes/x.md" },
    { kind: "family", role: "sibling", person: personPath("bea-demo") },
  ]);
  assert.deepEqual(edges, [{ kind: "family", role: "sibling", person: "people/bea-demo/person.md" }]);
});
