import assert from "node:assert/strict";
import { test } from "node:test";
import type { PersonView } from "../models.ts";
import {
  demoTagSuggestion,
  dismissTagProposal,
  existingTags,
  parsePeopleFilter,
  personHasAllTags,
  planAcceptedTag,
  proposeTag,
  setTagChecked,
  suggestTags,
  tagOfferKey,
  tagWritesWithoutAccept,
  writesForAcceptedTag,
} from "./tags.ts";

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

test("Accept is the only path that yields a tag write", () => {
  const proposal = proposeTag({ slug: "ada-demo", tag: "family" });
  const write = planAcceptedTag("ada-demo", proposal);
  assert.deepEqual(write, { slug: "ada-demo", tag: "family" });
});

test("uncheck and reject write nothing", () => {
  const proposal = proposeTag({ slug: "ada-demo", tag: "family" });
  assert.equal(planAcceptedTag("ada-demo", setTagChecked(proposal, false)), null);
  assert.equal(dismissTagProposal(), null);
  assert.deepEqual(tagWritesWithoutAccept(proposal), []);
  assert.deepEqual(tagWritesWithoutAccept(null), []);
  assert.equal(writesForAcceptedTag("ada-demo", { ...proposal.suggestion, kind: "note" }), null);
});

test("demo tag suggestion is propose-only and stays local", () => {
  const item = demoTagSuggestion("research");
  assert.equal(item.kind, "tag");
  assert.equal(item.tag, "family");
  assert.match(item.title, /demo/i);
  assert.doesNotMatch(JSON.stringify(item), /skuffen\.cloud|uploadGraph|token|score|rank|heat/i);
  assert.ok(tagOfferKey(item));
});

test("demo ask and research mint the same tag id so Accept cannot write a twin", () => {
  const fromAsk = demoTagSuggestion("ask");
  const fromResearch = demoTagSuggestion("research");
  assert.equal(fromAsk.id, "demo-tag-family");
  assert.equal(fromResearch.id, fromAsk.id);
  assert.equal(tagOfferKey(fromAsk), tagOfferKey(fromResearch));
});

test("filter parses #family and # family and mixes with name text", () => {
  assert.deepEqual(parsePeopleFilter("#family"), { tags: ["family"], text: "" });
  assert.deepEqual(parsePeopleFilter("# family"), { tags: ["family"], text: "" });
  assert.deepEqual(parsePeopleFilter("Ada #family"), { tags: ["family"], text: "Ada" });
  assert.deepEqual(parsePeopleFilter("#family Ada"), { tags: ["family"], text: "Ada" });
  assert.deepEqual(parsePeopleFilter("#family #work bea"), { tags: ["family", "work"], text: "bea" });
  assert.deepEqual(parsePeopleFilter("Ada"), { tags: [], text: "Ada" });
});

test("tag match is case-insensitive; name text is separate", () => {
  const ada = person({ tags: ["Family"] });
  const bea = person({ slug: "bea-demo", title: "Bea Demo", tags: ["work"] });
  assert.equal(personHasAllTags(ada, ["family"]), true);
  assert.equal(personHasAllTags(bea, ["family"]), false);
  assert.equal(personHasAllTags(ada, ["family", "work"]), false);
});

test("suggests existing tags as the user types; already-on-card tags stay hidden", () => {
  const known = existingTags([person({ tags: ["family"] }), person({ slug: "bea-demo", tags: ["work", "Family"] })]);
  assert.deepEqual(known, ["family", "work"]);
  assert.deepEqual(suggestTags(known, "fa", []), ["family"]);
  assert.deepEqual(suggestTags(known, "family", ["Family"]), []);
  assert.deepEqual(suggestTags(known, "", []), []);
});
