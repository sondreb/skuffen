import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  PLACE_TYPE,
  createPersonDocument,
  createPlaceDocument,
  locationFromDocument,
  parseDocument,
  placePath,
  serializeDocument,
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
