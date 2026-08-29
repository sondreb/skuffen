import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseIndex } from "../../packages/okf/src/index.ts";
import { EncryptedBundleError, generateKey, isEncrypted } from "../../packages/okf/src/vault.ts";
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
  const pdf = Buffer.from("%PDF-1.4 land-plot-bytes", "utf8");
  writeFileSync(pdfPath, pdf);
  const bundle = new OkfBundle(root);
  bundle.ensure();
  const ada = bundle.createPerson({ title: "Ada Lovelace" });
  const other = bundle.createPerson({ title: "Other Contact" });
  bundle.addDocument({
    slug: ada.slug,
    title: "Plot 12, Hvaler",
    filePath: pdfPath,
    kind: "land-plot",
    note: "Survey scan.",
  });
  bundle.linkDocument("plot-12-hvaler", other.slug);

  const reloaded = new OkfBundle(root).getPerson(ada.slug);
  assert.ok(reloaded);
  assert.equal(reloaded.documents.length, 1);
  assert.equal(reloaded.documents[0].title, "Plot 12, Hvaler");
  assert.equal(reloaded.documents[0].kind, "land-plot");
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

test("MCP with a vault key writes ciphertext and refuses reads without the key", () => {
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
    kind: "land-plot",
  });

  const personOnDisk = readFileSync(join(root, "people/ada-lovelace/person.md"));
  assert.ok(isEncrypted(personOnDisk));
  assert.doesNotMatch(personOnDisk.toString("latin1"), /Ada Lovelace/);
  assert.doesNotMatch(personOnDisk.toString("latin1"), /Mathematician/);
  assert.ok(isEncrypted(readFileSync(join(root, "index.md"))));
  const plotOnDisk = readFileSync(join(root, "documents/plot-12-hvaler/incoming-plot.pdf"));
  assert.ok(isEncrypted(plotOnDisk));
  assert.doesNotMatch(plotOnDisk.toString("latin1"), /vault-plot/);
  assert.ok(isEncrypted(readFileSync(join(root, "documents/plot-12-hvaler/document.md"))));

  const reloaded = new OkfBundle(root, key).getPerson(created.slug);
  assert.ok(reloaded);
  assert.equal(reloaded.title, "Ada Lovelace");
  assert.equal(reloaded.notes[0].title, "Analytical Engine");
  assert.equal(reloaded.documents[0].title, "Plot 12, Hvaler");
  assert.equal(reloaded.documents[0].kind, "land-plot");

  assert.throws(() => new OkfBundle(root, null).getPerson(created.slug), EncryptedBundleError);
});
