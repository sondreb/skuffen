import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseIndex } from "../../packages/okf/src/index.ts";
import { EncryptedBundleError, encryptBytes, generateKey, isEncrypted } from "../../packages/okf/src/vault.ts";
import { OkfBundle } from "./bundle.ts";

test("MCP writes person, note, social and reloads from disk", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-mcp-"));
  const bundle = new OkfBundle(root);
  bundle.ensure();
  const created = bundle.createPerson({ title: "Ada Lovelace", description: "Mathematician" });
  bundle.addNote(created.slug, "Analytical Engine", "First algorithm.");
  bundle.addSocial(created.slug, "wikipedia", "https://en.wikipedia.org/wiki/Ada_Lovelace", "Ada_Lovelace");

  const reloaded = new OkfBundle(root).getPerson(created.slug);
  assert.ok(reloaded);
  assert.equal(reloaded.title, "Ada Lovelace");
  assert.equal(reloaded.notes[0].title, "Analytical Engine");
  assert.equal(reloaded.social[0].url, "https://en.wikipedia.org/wiki/Ada_Lovelace");
  assert.equal(parseIndex(readFileSync(join(root, "index.md"), "utf8")).okfVersion, "0.2");
});

test("MCP persists a Place pin on disk and reload keeps coordinates local", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-mcp-place-"));
  const bundle = new OkfBundle(root);
  bundle.ensure();
  const created = bundle.createPerson({ title: "Ada Lovelace", description: "Mathematician" });
  bundle.setLocation(created.slug, {
    address: "12 St James's Square, London",
    latitude: 51.50848,
    longitude: -0.12574,
    source: "search",
  });

  const onDisk = readFileSync(join(root, "people/ada-lovelace/place.md"), "utf8");
  assert.match(onDisk, /type: Place/);
  assert.match(onDisk, /51\.50848/);
  assert.doesNotMatch(onDisk, /skuffen\.cloud|api\.skuffen/);

  const reloaded = new OkfBundle(root).getPerson(created.slug);
  assert.ok(reloaded?.location);
  assert.equal(reloaded.location.address, "12 St James's Square, London");
  assert.equal(reloaded.location.latitude, 51.50848);
  assert.equal(reloaded.location.longitude, -0.12574);

  const cleared = bundle.clearLocation(created.slug);
  assert.equal(cleared.location, undefined);
  assert.equal(new OkfBundle(root).getPerson(created.slug)?.location, undefined);
});

test("MCP stores a Document as file bytes plus concept markdown and can link another person", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-mcp-doc-"));
  const pdfPath = join(root, "incoming-plot.pdf");
  const pdf = Buffer.from("%PDF-1.4 document-bytes", "utf8");
  writeFileSync(pdfPath, pdf);
  const bundle = new OkfBundle(root);
  bundle.ensure();
  const ada = bundle.createPerson({ title: "Ada Lovelace" });
  const other = bundle.createPerson({ title: "Other Contact" });
  bundle.addDocument({
    slug: ada.slug,
    title: "Plot 12, Hvaler",
    filePath: pdfPath,
    kind: "document",
    note: "Survey scan.",
  });
  bundle.linkDocument("plot-12-hvaler", other.slug);

  const reloaded = new OkfBundle(root).getPerson(ada.slug);
  assert.ok(reloaded);
  assert.equal(reloaded.documents.length, 1);
  assert.equal(reloaded.documents[0].title, "Plot 12, Hvaler");
  assert.equal(reloaded.documents[0].kind, "document");
  assert.equal(reloaded.documents[0].resource, "/documents/plot-12-hvaler/incoming-plot.pdf");
  assert.deepEqual(reloaded.documents[0].subjects, [
    "people/ada-lovelace/person.md",
    "people/other-contact/person.md",
  ]);
  const concept = readFileSync(join(root, "documents/plot-12-hvaler/document.md"), "utf8");
  assert.match(concept, /type: Document/);
  assert.doesNotMatch(concept, /%PDF-1.4/);
  assert.deepEqual(readFileSync(join(root, "documents/plot-12-hvaler/incoming-plot.pdf")), pdf);

  const otherView = new OkfBundle(root).getPerson(other.slug);
  assert.equal(otherView?.documents[0].title, "Plot 12, Hvaler");
});

test("MCP writes plaintext even when a leftover vault key is present", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-mcp-vault-"));
  const key = generateKey();
  const bundle = new OkfBundle(root, key);
  bundle.ensure();
  const created = bundle.createPerson({ title: "Ada Lovelace", description: "Mathematician" });
  bundle.addNote(created.slug, "Analytical Engine", "First algorithm.");
  const pdfPath = join(root, "incoming-plot.pdf");
  writeFileSync(pdfPath, Buffer.from("%PDF-1.4 vault-plot", "utf8"));
  bundle.addDocument({
    slug: created.slug,
    title: "Plot 12, Hvaler",
    filePath: pdfPath,
    kind: "document",
  });

  const personOnDisk = readFileSync(join(root, "people/ada-lovelace/person.md"), "utf8");
  assert.match(personOnDisk, /Ada Lovelace/);
  assert.match(personOnDisk, /Mathematician/);
  assert.match(readFileSync(join(root, "index.md"), "utf8"), /okf_version/);
  assert.ok(!isEncrypted(readFileSync(join(root, "people/ada-lovelace/person.md"))));
  const plotOnDisk = readFileSync(join(root, "documents/plot-12-hvaler/incoming-plot.pdf"));
  assert.ok(!isEncrypted(plotOnDisk));
  assert.match(plotOnDisk.toString("utf8"), /vault-plot/);

  const reloaded = new OkfBundle(root, null).getPerson(created.slug);
  assert.ok(reloaded);
  assert.equal(reloaded.title, "Ada Lovelace");
  assert.equal(reloaded.notes[0].title, "Analytical Engine");
  assert.equal(reloaded.documents[0].title, "Plot 12, Hvaler");
  assert.equal(reloaded.documents[0].kind, "document");
});

test("MCP add sibling writes both cards; delete slug edges; no tokens", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-mcp-rel-"));
  const bundle = new OkfBundle(root);
  bundle.ensure();
  const ada = bundle.createPerson({ title: "Ada Demo" });
  const bea = bundle.createPerson({ title: "Bea Demo" });
  bundle.addRelation(ada.slug, { relatedSlug: bea.slug, kind: "family", role: "sibling" });

  const adaView = bundle.getPerson(ada.slug);
  const beaView = bundle.getPerson(bea.slug);
  assert.equal(adaView?.relations[0]?.slug, bea.slug);
  assert.equal(adaView?.relations[0]?.role, "sibling");
  assert.equal(beaView?.relations[0]?.slug, ada.slug);
  assert.equal(beaView?.relations[0]?.title, "Ada Demo");

  const onDisk = readFileSync(join(root, "people/ada-demo/relations.md"), "utf8");
  assert.match(onDisk, /type: Relations/);
  assert.match(onDisk, /people\/bea-demo\/person\.md/);
  assert.doesNotMatch(onDisk, /token|secret|password|api[_-]?key|authorization|bearer/i);
  assert.doesNotMatch(onDisk, /skuffen\.cloud/);

  bundle.removeRelation(ada.slug, { relatedSlug: bea.slug, kind: "family", role: "sibling" });
  assert.equal(bundle.getPerson(ada.slug)?.relations.length, 0);
  assert.equal(bundle.getPerson(bea.slug)?.relations.length, 0);
});

test("MCP creates a first-class Place and links a person — stays on disk", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-mcp-entity-place-"));
  const bundle = new OkfBundle(root);
  bundle.ensure();
  const ada = bundle.createPerson({ title: "Ada Demo" });
  const place = bundle.createPlace({
    title: "Golden Gate Park",
    notes: "Met at the tea garden.",
    latitude: 37.7694,
    longitude: -122.4862,
  });
  assert.equal(place.path, "places/golden-gate-park/place.md");
  const linked = bundle.linkPersonToPlace(ada.slug, { placeSlug: place.slug, role: "met-at" });
  assert.equal(linked.places[0]?.slug, "golden-gate-park");
  assert.equal(linked.places[0]?.role, "met-at");
  const onDisk = readFileSync(join(root, "places/golden-gate-park/place.md"), "utf8");
  assert.match(onDisk, /type: Place/);
  assert.doesNotMatch(onDisk, /skuffen\.cloud|land-plot|token/i);
  assert.equal(bundle.listPlaces().length, 1);
});

test("MCP leftover ciphertext decrypts once, then refuses without the key", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-mcp-leftover-"));
  const key = generateKey();
  const person = [
    "---",
    "type: Person",
    "title: Ada Lovelace",
    "---",
    "",
    "# About",
    "",
  ].join("\n");
  mkdirSync(join(root, "people/ada-lovelace"), { recursive: true });
  writeFileSync(
    join(root, "people/ada-lovelace/person.md"),
    encryptBytes(key, "people/ada-lovelace/person.md", Buffer.from(person, "utf8")),
  );

  assert.throws(() => new OkfBundle(root, null).getPerson("ada-lovelace"), EncryptedBundleError);
  assert.ok(isEncrypted(readFileSync(join(root, "people/ada-lovelace/person.md"))));

  const opened = new OkfBundle(root, key).getPerson("ada-lovelace");
  assert.equal(opened?.title, "Ada Lovelace");
  assert.match(readFileSync(join(root, "people/ada-lovelace/person.md"), "utf8"), /Ada Lovelace/);
  assert.ok(!isEncrypted(readFileSync(join(root, "people/ada-lovelace/person.md"))));
});
