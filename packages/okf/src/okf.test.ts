import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  OKF_VERSION,
  appendLog,
  createNoteDocument,
  createPersonDocument,
  createSocialDocument,
  parseDocument,
  parseIndex,
  personPath,
  redactSensitiveRecord,
  serializeBundleIndex,
  serializeDocument,
  slugify,
} from "./index.ts";

test("file path is the concept identity", () => {
  const doc = createPersonDocument({ slug: "ada-lovelace", title: "Ada Lovelace" });
  assert.equal(doc.path, "people/ada-lovelace/person.md");
  assert.equal(doc.id, "people/ada-lovelace/person");
  assert.equal(personPath("ada-lovelace"), "people/ada-lovelace/person.md");
});

test("round-trips a Person with required type", () => {
  const doc = createPersonDocument({
    slug: "ada-lovelace",
    title: "Ada Lovelace",
    description: "Mathematician",
    givenName: "Ada",
    familyName: "Lovelace",
  });
  const raw = serializeDocument(doc);
  const parsed = parseDocument(doc.path, raw);
  assert.equal(parsed.frontmatter.type, "Person");
  assert.equal(parsed.frontmatter.title, "Ada Lovelace");
  assert.equal(parsed.frontmatter.given_name, "Ada");
});

test("bundle-root index declares okf_version 0.2", () => {
  const raw = serializeBundleIndex([
    { title: "Ada Lovelace", path: "people/ada-lovelace/person.md", description: "Mathematician" },
  ]);
  const parsed = parseIndex(raw);
  assert.equal(parsed.okfVersion, OKF_VERSION);
  assert.match(parsed.body, /Ada Lovelace/);
});

test("persists person + note + social to disk and survives reload", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-okf-"));
  const person = createPersonDocument({ slug: "ada-lovelace", title: "Ada Lovelace" });
  const note = createNoteDocument({
    slug: "ada-lovelace",
    noteSlug: "analytical-engine",
    title: "Analytical Engine",
    body: "Wrote the first algorithm intended for a machine.",
  });
  const social = createSocialDocument({
    slug: "ada-lovelace",
    network: "wikipedia",
    handle: "Ada_Lovelace",
    url: "https://en.wikipedia.org/wiki/Ada_Lovelace",
  });

  for (const doc of [person, note, social]) {
    const abs = join(root, doc.path);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, serializeDocument(doc), "utf8");
  }
  writeFileSync(
    join(root, "index.md"),
    serializeBundleIndex([{ title: "Ada Lovelace", path: person.path, description: "Mathematician" }]),
    "utf8",
  );

  const reloaded = parseDocument(person.path, readFileSync(join(root, person.path), "utf8"));
  const reloadedNote = parseDocument(note.path, readFileSync(join(root, note.path), "utf8"));
  const reloadedSocial = parseDocument(social.path, readFileSync(join(root, social.path), "utf8"));
  const index = parseIndex(readFileSync(join(root, "index.md"), "utf8"));

  assert.equal(reloaded.frontmatter.type, "Person");
  assert.equal(reloadedNote.frontmatter.type, "Note");
  assert.equal(reloadedSocial.frontmatter.type, "SocialProfile");
  assert.equal(reloadedSocial.frontmatter.resource, "https://en.wikipedia.org/wiki/Ada_Lovelace");
  assert.equal(index.okfVersion, "0.2");
});

test("slugify and redaction", () => {
  assert.equal(slugify("Ada Lovelace"), "ada-lovelace");
  const redacted = redactSensitiveRecord({
    title: "Ada",
    email: "ada@example.com",
    note: "Call +47 123 45 678 or ada@example.com",
  });
  assert.equal(redacted.email, "[redacted]");
  assert.match(redacted.note, /\[redacted-phone\]/);
  assert.match(redacted.note, /\[redacted-email\]/);
});

test("appendLog groups by ISO date newest-first", () => {
  const next = appendLog("# Directory Update Log\n", "Creation", "Added [Ada](/people/ada-lovelace/person.md).");
  assert.match(next, /\*\*Creation\*\*/);
  assert.match(next, /## \d{4}-\d{2}-\d{2}/);
});
