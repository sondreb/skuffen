import assert from "node:assert/strict";
import { test } from "node:test";
import {
  demoPlaceSuggestion,
  dismissPlaceProposal,
  emptyPlacesCopy,
  placeOfferKey,
  placeWritesWithoutAccept,
  planAcceptedPlace,
  proposePlace,
  setPlaceChecked,
  writesForAcceptedPlace,
} from "./places.ts";

test("Accept is the only path that yields a Place write", () => {
  const proposal = proposePlace({
    slug: "ada-demo",
    placeName: "Golden Gate Park",
    address: "Golden Gate Park, San Francisco",
    latitude: 37.7694,
    longitude: -122.4862,
    placeRole: "met-at",
  });
  const write = planAcceptedPlace("ada-demo", proposal);
  assert.deepEqual(write, {
    slug: "ada-demo",
    placeName: "Golden Gate Park",
    notes: undefined,
    address: "Golden Gate Park, San Francisco",
    latitude: 37.7694,
    longitude: -122.4862,
    placeRole: "met-at",
    placeSlug: undefined,
  });
});

test("uncheck and reject write nothing", () => {
  const proposal = proposePlace({
    slug: "ada-demo",
    placeName: "Golden Gate Park",
    latitude: 37.7694,
    longitude: -122.4862,
  });
  assert.equal(planAcceptedPlace("ada-demo", setPlaceChecked(proposal, false)), null);
  assert.equal(dismissPlaceProposal(), null);
  assert.deepEqual(placeWritesWithoutAccept(proposal), []);
  assert.deepEqual(placeWritesWithoutAccept(null), []);
  assert.equal(writesForAcceptedPlace("ada-demo", { ...proposal.suggestion, kind: "note" }), null);
});

test("demo Place suggestion is propose-only and stays local", () => {
  const item = demoPlaceSuggestion("research");
  assert.equal(item.kind, "place");
  assert.equal(item.placeName, "Golden Gate Park");
  assert.equal(item.placeRole, "met-at");
  assert.match(item.title, /demo/i);
  assert.doesNotMatch(JSON.stringify(item), /skuffen\.cloud|uploadGraph|token|land-plot/i);
  assert.ok(placeOfferKey(item));
});

test("demo ask and research mint the same Place id so Accept cannot write a twin", () => {
  const fromAsk = demoPlaceSuggestion("ask");
  const fromResearch = demoPlaceSuggestion("research");
  assert.equal(fromAsk.id, "demo-place-park");
  assert.equal(fromResearch.id, fromAsk.id);
  assert.equal(placeOfferKey(fromAsk), placeOfferKey(fromResearch));
});

test("empty Places copy is a local empty state — no network", () => {
  const copy = emptyPlacesCopy();
  assert.equal(copy.lede, "No places yet");
  assert.equal(copy.whisper, "");
  assert.doesNotMatch(copy.lede, /skuffen\.cloud|upload|network/i);
});
