import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  PLACE_LINKS_TYPE,
  PLACE_TYPE,
  addDocumentPlaceSubject,
  createDocumentDocument,
  createEntityPlaceDocument,
  createPersonDocument,
  createPlaceDocument,
  createPlaceFileDocument,
  createPlaceLinksDocument,
  documentLinkedToPlace,
  entityPlacePath,
  locationFromDocument,
  parseDocument,
  placeLinkKey,
  placeLinksFromDocument,
  placeLinksPath,
  placePath,
  removePlaceLink,
  serializeDocument,
  slugFromPlacePath,
  upsertPlaceLink,
  wipePlaceLinksForPlace,
} from "./index.ts";

test("file path is the Place identity", () => {
  const doc = createPlaceDocument({
    slug: "ada-lovelace",
    address: "St James's Square, London",
    latitude: 51.5085,
    longitude: -0.1257,
    source: "search",
  });
  assert.equal(doc.path, "people/ada-lovelace/place.md");
  assert.equal(doc.id, "people/ada-lovelace/place");
  assert.equal(placePath("ada-lovelace"), "people/ada-lovelace/place.md");
  assert.equal(doc.frontmatter.type, PLACE_TYPE);
});

test("rejects coordinates outside WGS84 bounds", () => {
  assert.throws(
    () => createPlaceDocument({ slug: "ada-lovelace", latitude: 91, longitude: 0 }),
    /latitude/,
  );
  assert.throws(
    () => createPlaceDocument({ slug: "ada-lovelace", latitude: 0, longitude: 181 }),
    /longitude/,
  );
});

test("round-trips Place frontmatter and locationFromDocument", () => {
  const doc = createPlaceDocument({
    slug: "ada-lovelace",
    title: "St James's Square",
    address: "St James's Square, London",
    latitude: 51.5085,
    longitude: -0.1257,
    source: "pin",
  });
  const parsed = parseDocument(doc.path, serializeDocument(doc));
  assert.equal(parsed.frontmatter.type, "Place");
  assert.equal(parsed.frontmatter.latitude, 51.5085);
  assert.equal(parsed.frontmatter.longitude, -0.1257);
  assert.equal(parsed.frontmatter.address, "St James's Square, London");
  assert.equal(parsed.frontmatter.source, "pin");
  const location = locationFromDocument(parsed);
  assert.ok(location);
  assert.equal(location.latitude, 51.5085);
  assert.equal(location.longitude, -0.1257);
  assert.equal(location.source, "pin");
});

test("persists a linked Place beside a Person and survives reload", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-place-"));
  const person = createPersonDocument({ slug: "ada-lovelace", title: "Ada Lovelace" });
  const place = createPlaceDocument({
    slug: "ada-lovelace",
    address: "12 St James's Square, London",
    latitude: 51.50848,
    longitude: -0.12574,
    source: "search",
  });

  for (const doc of [person, place]) {
    const abs = join(root, doc.path);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, serializeDocument(doc), "utf8");
  }

  const reloadedPerson = parseDocument(person.path, readFileSync(join(root, person.path), "utf8"));
  const reloadedPlace = parseDocument(place.path, readFileSync(join(root, place.path), "utf8"));
  const location = locationFromDocument(reloadedPlace);

  assert.equal(reloadedPerson.frontmatter.type, "Person");
  assert.equal(reloadedPlace.frontmatter.type, "Place");
  assert.ok(location);
  assert.equal(location.path, "people/ada-lovelace/place.md");
  assert.equal(location.address, "12 St James's Square, London");
  assert.equal(location.latitude, 51.50848);
  assert.equal(location.longitude, -0.12574);
  assert.doesNotMatch(readFileSync(join(root, place.path), "utf8"), /skuffen\.cloud|api\.skuffen/);
});

test("locationFromDocument ignores a Person and invalid Place coords", () => {
  const person = createPersonDocument({ slug: "ada-lovelace", title: "Ada Lovelace" });
  assert.equal(locationFromDocument(person), null);
  const broken = parseDocument(
    "people/ada-lovelace/place.md",
    "---\ntype: Place\ntitle: Nowhere\nlatitude: 999\nlongitude: 0\n---\n",
  );
  assert.equal(locationFromDocument(broken), null);
});

test("first-class Place uses places/{slug}/place.md as identity", () => {
  const doc = createEntityPlaceDocument({
    slug: "golden-gate-park",
    title: "Golden Gate Park",
    notes: "Met at the tea garden.",
    address: "Golden Gate Park, San Francisco",
    latitude: 37.7694,
    longitude: -122.4862,
    source: "search",
  });
  assert.equal(doc.path, "places/golden-gate-park/place.md");
  assert.equal(doc.id, "places/golden-gate-park/place");
  assert.equal(entityPlacePath("golden-gate-park"), "places/golden-gate-park/place.md");
  assert.equal(slugFromPlacePath(doc.path), "golden-gate-park");
  assert.equal(doc.frontmatter.type, PLACE_TYPE);
  assert.equal(doc.frontmatter.title, "Golden Gate Park");
  assert.match(doc.body, /tea garden/);
  assert.doesNotMatch(doc.body, /land-plot|skuffen\.cloud/i);
});

test("first-class Place may omit coordinates", () => {
  const doc = createEntityPlaceDocument({ slug: "studio", title: "The studio" });
  assert.equal(doc.frontmatter.latitude, undefined);
  assert.equal(doc.frontmatter.longitude, undefined);
  assert.equal(locationFromDocument(doc), null);
});

test("first-class Place rejects a single coordinate or out-of-bounds pair", () => {
  assert.throws(
    () => createEntityPlaceDocument({ slug: "x", title: "X", latitude: 10 }),
    /both latitude and longitude/,
  );
  assert.throws(
    () => createEntityPlaceDocument({ slug: "x", title: "X", latitude: 91, longitude: 0 }),
    /latitude/,
  );
  assert.throws(() => createEntityPlaceDocument({ slug: "x", title: "" }), /name/);
});

test("person links to a Place as lives / works / met-at — no land-plot kind", () => {
  const links = upsertPlaceLink([], {
    role: "lives",
    place: entityPlacePath("golden-gate-park"),
  });
  const next = upsertPlaceLink(links, { role: "met-at", place: entityPlacePath("studio") });
  assert.deepEqual(next, [
    { role: "lives", place: "places/golden-gate-park/place.md" },
    { role: "met-at", place: "places/studio/place.md" },
  ]);
  assert.equal(placeLinkKey(next[0]!), "lives|places/golden-gate-park/place.md");
  assert.deepEqual(removePlaceLink(next, { place: entityPlacePath("studio"), role: "met-at" }), [
    { role: "lives", place: "places/golden-gate-park/place.md" },
  ]);
  assert.deepEqual(wipePlaceLinksForPlace(next, "golden-gate-park"), [
    { role: "met-at", place: "places/studio/place.md" },
  ]);
  const doc = createPlaceLinksDocument({ slug: "ada-demo", links: next });
  assert.equal(doc.path, "people/ada-demo/place-links.md");
  assert.equal(placeLinksPath("ada-demo"), "people/ada-demo/place-links.md");
  assert.equal(doc.frontmatter.type, PLACE_LINKS_TYPE);
  const raw = serializeDocument(doc);
  assert.doesNotMatch(raw, /land-plot|token|secret|skuffen\.cloud/i);
  const parsed = placeLinksFromDocument(parseDocument(doc.path, raw));
  assert.equal(parsed.length, 2);
});

test("documents can link to a Place; files sit beside the Place", () => {
  const place = createEntityPlaceDocument({ slug: "golden-gate-park", title: "Golden Gate Park" });
  const file = createPlaceFileDocument({ slug: "golden-gate-park", fileName: "map-sketch.png" });
  assert.equal(file.path, "places/golden-gate-park/files/map-sketch.md");
  assert.equal(file.frontmatter.resource, "/places/golden-gate-park/files/map-sketch.png");
  const doc = createDocumentDocument({
    docSlug: "park-scan",
    fileName: "scan.pdf",
    title: "Park scan",
    subjectSlugs: [],
    placeSlugs: ["golden-gate-park"],
  });
  assert.ok(documentLinkedToPlace(doc.frontmatter, "golden-gate-park"));
  addDocumentPlaceSubject(doc, "studio");
  assert.ok(documentLinkedToPlace(doc.frontmatter, "studio"));
  assert.equal(place.frontmatter.type, PLACE_TYPE);
});

test("first-class Place persists on disk and survives reload — no upload", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-entity-place-"));
  const place = createEntityPlaceDocument({
    slug: "golden-gate-park",
    title: "Golden Gate Park",
    notes: "Local park pin.",
    latitude: 37.7694,
    longitude: -122.4862,
    source: "search",
  });
  const person = createPersonDocument({ slug: "ada-demo", title: "Ada Demo" });
  const links = createPlaceLinksDocument({
    slug: "ada-demo",
    links: [{ role: "met-at", place: place.path }],
  });
  for (const item of [place, person, links]) {
    const abs = join(root, item.path);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, serializeDocument(item), "utf8");
  }
  const reloaded = parseDocument(place.path, readFileSync(join(root, place.path), "utf8"));
  const pin = locationFromDocument(reloaded);
  assert.ok(pin);
  assert.equal(pin.path, "places/golden-gate-park/place.md");
  assert.equal(pin.latitude, 37.7694);
  const reloadedLinks = placeLinksFromDocument(
    parseDocument(links.path, readFileSync(join(root, links.path), "utf8")),
  );
  assert.equal(reloadedLinks[0]?.role, "met-at");
  assert.doesNotMatch(readFileSync(join(root, place.path), "utf8"), /skuffen\.cloud|api\.skuffen|upload/i);
});
