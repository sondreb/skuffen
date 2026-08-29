import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
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

test("MCP with a vault key writes ciphertext and refuses reads without the key", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-mcp-vault-"));
  const key = generateKey();
  const bundle = new OkfBundle(root, key);
  bundle.ensure();
  const created = bundle.createPerson({ title: "Ada Lovelace", description: "Mathematician" });
  bundle.addNote(created.slug, "Analytical Engine", "First algorithm.");

  const personOnDisk = readFileSync(join(root, "people/ada-lovelace/person.md"));
  assert.ok(isEncrypted(personOnDisk));
  assert.doesNotMatch(personOnDisk.toString("latin1"), /Ada Lovelace/);
  assert.doesNotMatch(personOnDisk.toString("latin1"), /Mathematician/);
  assert.ok(isEncrypted(readFileSync(join(root, "index.md"))));

  const reloaded = new OkfBundle(root, key).getPerson(created.slug);
  assert.ok(reloaded);
  assert.equal(reloaded.title, "Ada Lovelace");
  assert.equal(reloaded.notes[0].title, "Analytical Engine");

  assert.throws(() => new OkfBundle(root, null).getPerson(created.slug), EncryptedBundleError);
});
