import assert from "node:assert/strict";
import { test } from "node:test";
import type { PersonView, PlaceView } from "../models.ts";
import { mapPinsForGraph, personMapLocation } from "./map-pins.ts";

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

function place(overrides: Partial<PlaceView> = {}): PlaceView {
  const slug = overrides.slug ?? "golden-gate-park";
  return {
    id: `places/${slug}/place`,
    slug,
    path: `places/${slug}/place.md`,
    title: overrides.title ?? "Golden Gate Park",
    notes: "",
    files: [],
    notesList: [],
    people: [],
    documents: [],
    ...overrides,
  };
}

test("prefers a first-class Place pin over a person pin linked to it", () => {
  const park = place({
    latitude: 37.7694,
    longitude: -122.4862,
    location: {
      path: "places/golden-gate-park/place.md",
      title: "Golden Gate Park",
      latitude: 37.7694,
      longitude: -122.4862,
    },
  });
  const ada = person({
    location: {
      path: "people/ada-demo/place.md",
      title: "Old pin",
      latitude: 1,
      longitude: 2,
    },
    places: [
      {
        role: "met-at",
        slug: "golden-gate-park",
        path: "places/golden-gate-park/place.md",
        title: "Golden Gate Park",
        location: park.location,
      },
    ],
  });
  const pins = mapPinsForGraph({ places: [park], people: [ada] });
  assert.equal(pins.length, 1);
  assert.equal(pins[0]?.kind, "place");
  assert.equal(pins[0]?.slug, "golden-gate-park");
  assert.equal(pins[0]?.location.latitude, 37.7694);
});

test("people without a Place still show from people/{slug}/place.md", () => {
  const ada = person({
    location: {
      path: "people/ada-demo/place.md",
      title: "Park pin",
      latitude: 37.7694,
      longitude: -122.4862,
    },
  });
  const pins = mapPinsForGraph({ places: [], people: [ada] });
  assert.equal(pins.length, 1);
  assert.equal(pins[0]?.kind, "person");
  assert.equal(pins[0]?.slug, "ada-demo");
});

test("empty Places and people without location invent nothing", () => {
  assert.deepEqual(mapPinsForGraph({ places: [], people: [] }), []);
  assert.deepEqual(mapPinsForGraph({ places: [place()], people: [person()] }), []);
});

test("personMapLocation prefers a linked Place over people/{slug}/place.md", () => {
  const linked = {
    path: "places/studio/place.md",
    title: "Studio",
    latitude: 10,
    longitude: 20,
  };
  const ada = person({
    location: {
      path: "people/ada-demo/place.md",
      title: "Old",
      latitude: 1,
      longitude: 2,
    },
    places: [{ role: "works", slug: "studio", path: "places/studio/place.md", title: "Studio", location: linked }],
  });
  assert.deepEqual(personMapLocation(ada), linked);
});

test("never uploads and never stores tokens on a pin projection", () => {
  const dumped = JSON.stringify(
    mapPinsForGraph({
      places: [
        place({
          location: {
            path: "places/golden-gate-park/place.md",
            title: "Golden Gate Park",
            latitude: 37.7694,
            longitude: -122.4862,
          },
        }),
      ],
      people: [person()],
    }),
  );
  assert.doesNotMatch(dumped, /token|secret|password|api[_-]?key|skuffen\.cloud|land-plot/i);
});
