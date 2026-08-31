import assert from "node:assert/strict";
import { test } from "node:test";
import { publicPersonView } from "./redact.ts";

test("MCP default view drops raw email and phone", () => {
  const view = publicPersonView({
    id: "people/ada/person",
    slug: "ada",
    title: "Ada",
    email: "ada@example.com",
    phone: "+47 123 45 678",
    notes: [{ title: "Call", body: "ada@example.com / +47 123 45 678" }],
  });
  assert.equal(view.email, undefined);
  assert.equal(view.phone, undefined);
  const notes = view.notes as Array<{ body: string }>;
  assert.match(notes[0].body, /\[redacted-email\]/);
  assert.match(notes[0].body, /\[redacted-phone\]/);
});

test("list/search view omits relations and tags; get_person can keep this card's edges and tags", () => {
  const person = {
    id: "people/ada-demo/person",
    slug: "ada-demo",
    title: "Ada Demo",
    tags: ["family"],
    relations: [
      {
        kind: "family",
        role: "sibling",
        slug: "bea-demo",
        path: "people/bea-demo/person.md",
        title: "Bea Demo",
      },
    ],
  };
  const listed = publicPersonView(person);
  assert.equal(listed.relations, undefined);
  assert.equal(listed.tags, undefined);
  const edgesOnly = publicPersonView(person, { includeRelations: true });
  assert.deepEqual(edgesOnly.relations, person.relations);
  assert.equal(edgesOnly.tags, undefined);
  const tagsOnly = publicPersonView(person, { includeTags: true });
  assert.equal(tagsOnly.relations, undefined);
  assert.deepEqual(tagsOnly.tags, ["family"]);
  const one = publicPersonView(person, { includeRelations: true, includeTags: true });
  assert.deepEqual(one.relations, person.relations);
  assert.deepEqual(one.tags, ["family"]);
});
