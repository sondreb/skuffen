import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  DOCUMENT_KIND,
  DOCUMENT_TYPE,
  OKF_VERSION,
  acceptHumanVerification,
  actorAgent,
  actorHuman,
  addDocumentSubject,
  removeDocumentSubject,
  appendLog,
  applyAcceptProvenance,
  createDocumentDocument,
  createNoteDocument,
  createPersonDocument,
  createPhotoDocument,
  defaultStaleAfter,
  hasVisibleProvenance,
  normalizeSources,
  normalizeTag,
  normalizeTagList,
  provenanceFromFrontmatter,
  createSocialDocument,
  documentConceptPath,
  documentFilePath,
  documentLinkedToPerson,
  parseDocument,
  parseIndex,
  personImageResource,
  personPath,
  photoFilePath,
  redactSensitiveRecord,
  serializeBundleIndex,
  serializeDocument,
  slugify,
  verifiedList,
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

test("person tags live on person.md and stay local labels", () => {
  assert.equal(normalizeTag("# family"), "family");
  assert.deepEqual(normalizeTagList(["Family", "family", "#work", "  "]), ["Family", "work"]);
  const doc = createPersonDocument({
    slug: "ada-lovelace",
    title: "Ada Lovelace",
    tags: ["#family", "work", "Family"],
  });
  const raw = serializeDocument(doc);
  const parsed = parseDocument(doc.path, raw);
  assert.deepEqual(parsed.frontmatter.tags, ["family", "work"]);
  assert.doesNotMatch(raw, /skuffen\.cloud|encrypt|score|rank/i);
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

test("Document concept: file path is identity and resource points at the file", () => {
  const doc = createDocumentDocument({
    docSlug: "survey-scan",
    fileName: "survey.pdf",
    title: "Survey scan",
    kind: DOCUMENT_KIND,
    note: "Survey scan. Not uploaded.",
    subjectSlugs: ["ada-lovelace"],
  });
  assert.equal(doc.path, "documents/survey-scan/document.md");
  assert.equal(doc.id, "documents/survey-scan/document");
  assert.equal(documentConceptPath("survey-scan"), doc.path);
  assert.equal(documentFilePath("survey-scan", "survey.pdf"), "documents/survey-scan/survey.pdf");
  assert.equal(doc.frontmatter.type, DOCUMENT_TYPE);
  assert.equal(doc.frontmatter.title, "Survey scan");
  assert.equal(doc.frontmatter.resource, "/documents/survey-scan/survey.pdf");
  assert.equal(doc.frontmatter.kind, DOCUMENT_KIND);
  assert.doesNotMatch(doc.body, /land-plot/i);
  assert.deepEqual(doc.frontmatter.subjects, ["people/ada-lovelace/person.md"]);
  assert.match(doc.body, /Survey scan/);
  assert.ok(documentLinkedToPerson(doc.frontmatter, "ada-lovelace"));
});

test("Person profile image is a local bundle path — never http(s)", () => {
  const photo = createPhotoDocument({ slug: "ada-lovelace", fileName: "portrait.jpg" });
  assert.equal(photo.path, "people/ada-lovelace/photos/portrait.md");
  assert.equal(photo.frontmatter.resource, "/people/ada-lovelace/photos/portrait.jpg");
  assert.equal(photoFilePath("ada-lovelace", "portrait.jpg"), "people/ada-lovelace/photos/portrait.jpg");

  const person = createPersonDocument({
    slug: "ada-lovelace",
    title: "Ada Lovelace",
    image: photo.frontmatter.resource,
  });
  assert.equal(person.frontmatter.image, "/people/ada-lovelace/photos/portrait.jpg");
  assert.equal(personImageResource(person.frontmatter.image), "/people/ada-lovelace/photos/portrait.jpg");
  assert.equal(personImageResource("https://cdn.example/ada.jpg"), undefined);
  assert.equal(personImageResource("http://cdn.example/ada.jpg"), undefined);
  assert.equal(personImageResource("//cdn.example/ada.jpg"), undefined);
  assert.equal(personImageResource("javascript:alert(1)"), undefined);

  const remote = createPersonDocument({
    slug: "remote-ada",
    title: "Remote Ada",
    image: "https://cdn.example/ada.jpg",
  });
  assert.equal(remote.frontmatter.image, undefined);
});

test("Person and Note without trust fields still load and do not invent them", () => {
  const personRaw = `---
type: Person
title: Ada Lovelace
---

# About
`;
  const noteRaw = `---
type: Note
title: Engine
---

Wrote notes on the Analytical Engine.
`;
  const person = parseDocument("people/ada-lovelace/person.md", personRaw);
  const note = parseDocument("people/ada-lovelace/notes/engine.md", noteRaw);
  assert.equal(person.frontmatter.generated, undefined);
  assert.equal(person.frontmatter.verified, undefined);
  assert.equal(person.frontmatter.sources, undefined);
  assert.equal(person.frontmatter.status, undefined);
  assert.equal(person.frontmatter.stale_after, undefined);
  assert.equal(note.frontmatter.generated, undefined);
  const personAgain = serializeDocument(person);
  const noteAgain = serializeDocument(note);
  assert.doesNotMatch(personAgain, /generated:|verified:|sources:|stale_after:|status:/);
  assert.doesNotMatch(noteAgain, /generated:|verified:|sources:|stale_after:/);
  assert.equal(parseDocument(person.path, personAgain).frontmatter.title, "Ada Lovelace");
});

test("OKF v0.2 trust fields round-trip on Person and Note", () => {
  const note = createNoteDocument({
    slug: "ada-lovelace",
    noteSlug: "engine",
    title: "Analytical Engine",
    body: "Wrote the first algorithm intended for a machine.",
    generatedBy: actorAgent("grok", "grok-4-latest"),
    sources: [{ resource: "https://example.invalid/ada", title: "Public page (demo)" }],
    staleAfter: "2027-03-07",
  });
  assert.equal(note.frontmatter.generated?.by, "grok/grok-4-latest");
  assert.equal(note.frontmatter.verified, undefined);
  applyAcceptProvenance(note.frontmatter, {
    generatedBy: actorAgent("grok", "grok-4-latest"),
    sources: [{ resource: "https://example.invalid/ada", title: "Public page (demo)" }],
    staleAfter: "2027-03-07",
  });
  assert.equal(verifiedList(note.frontmatter.verified)[0]?.by, actorHuman());
  assert.equal(note.frontmatter.status, "stable");
  const raw = serializeDocument(note);
  assert.match(raw, /generated:/);
  assert.match(raw, /verified:/);
  assert.match(raw, /sources:/);
  assert.match(raw, /stale_after:/);
  assert.doesNotMatch(raw, /encrypt|skuffen\.cloud|dataplex|knowledge catalog/i);
  const parsed = parseDocument(note.path, raw);
  assert.equal(parsed.frontmatter.generated?.by, "grok/grok-4-latest");
  assert.deepEqual(parsed.frontmatter.sources, [
    { resource: "https://example.invalid/ada", title: "Public page (demo)" },
  ]);
  assert.equal(parsed.frontmatter.stale_after, "2027-03-07");
  assert.equal(parsed.frontmatter.status, "stable");
  const view = provenanceFromFrontmatter(parsed.frontmatter);
  assert.equal(hasVisibleProvenance(view), true);
  assert.equal(view.verified[0]?.by, "human:user");
});

test("model create is generated-only; human Accept adds verified", () => {
  const person = createPersonDocument({
    slug: "ada-lovelace",
    title: "Ada Lovelace",
    generatedBy: actorAgent("gemini", "gemini-2.5-flash"),
  });
  assert.equal(person.frontmatter.generated?.by, "gemini/gemini-2.5-flash");
  assert.equal(person.frontmatter.verified, undefined);
  acceptHumanVerification(person.frontmatter);
  assert.equal(verifiedList(person.frontmatter.verified)[0]?.by, "human:user");
  assert.equal(person.frontmatter.status, "stable");
  assert.equal(person.frontmatter.generated?.by, "gemini/gemini-2.5-flash");
});

test("human creates still stamp generated and verified", () => {
  const doc = createPersonDocument({ slug: "ada-lovelace", title: "Ada Lovelace" });
  assert.equal(doc.frontmatter.generated?.by, actorHuman());
  assert.equal(verifiedList(doc.frontmatter.verified)[0]?.by, actorHuman());
});

test("normalizeSources accepts strings and objects; defaultStaleAfter is a date", () => {
  assert.deepEqual(normalizeSources("https://example.invalid/a"), [{ resource: "https://example.invalid/a" }]);
  assert.deepEqual(normalizeSources([{ resource: "https://example.invalid/a", title: "A" }, { resource: "https://example.invalid/a" }]), [
    { resource: "https://example.invalid/a", title: "A" },
  ]);
  assert.match(defaultStaleAfter("2026-09-08T00:00:00Z", 180), /^\d{4}-\d{2}-\d{2}$/);
});

test("removeDocumentSubject unlinks a person and leaves the document", () => {
  const doc = createDocumentDocument({
    docSlug: "plot-12-hvaler",
    fileName: "plot-12.pdf",
    title: "Plot 12, Hvaler",
    subjectSlugs: ["ada-lovelace"],
  });
  addDocumentSubject(doc, "other-contact");
  removeDocumentSubject(doc, "ada-lovelace");
  assert.deepEqual(doc.frontmatter.subjects, ["people/other-contact/person.md"]);
  assert.equal(documentLinkedToPerson(doc.frontmatter, "ada-lovelace"), false);
  assert.equal(doc.path, "documents/plot-12-hvaler/document.md");
});

test("Document requires type, title, and resource; file bytes stay beside the concept", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-okf-doc-"));
  const person = createPersonDocument({ slug: "ada-lovelace", title: "Ada Lovelace" });
  const concept = createDocumentDocument({
    docSlug: "plot-12-hvaler",
    fileName: "nested/plot-12.pdf",
    title: "Plot 12, Hvaler",
    kind: DOCUMENT_KIND,
    note: "Optional file note.",
    subjectSlugs: ["ada-lovelace"],
  });
  const other = createPersonDocument({ slug: "other-contact", title: "Other Contact" });
  addDocumentSubject(concept, "other-contact");

  for (const doc of [person, other, concept]) {
    const abs = join(root, doc.path);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, serializeDocument(doc), "utf8");
  }
  const pdf = Buffer.from("%PDF-1.4 document-bytes", "utf8");
  const fileRel = documentFilePath("plot-12-hvaler", "plot-12.pdf");
  writeFileSync(join(root, fileRel), pdf);

  const reloaded = parseDocument(concept.path, readFileSync(join(root, concept.path), "utf8"));
  assert.equal(reloaded.frontmatter.type, "Document");
  assert.equal(reloaded.frontmatter.title, "Plot 12, Hvaler");
  assert.equal(reloaded.frontmatter.resource, "/documents/plot-12-hvaler/plot-12.pdf");
  assert.deepEqual(reloaded.frontmatter.subjects, [
    "people/ada-lovelace/person.md",
    "people/other-contact/person.md",
  ]);
  assert.deepEqual(readFileSync(join(root, fileRel)), pdf);
  assert.doesNotMatch(readFileSync(join(root, concept.path), "utf8"), /%PDF-1.4/);

  assert.throws(
    () => parseDocument("documents/bad/document.md", "---\ntype: Document\n---\n"),
    /title/,
  );
  assert.throws(
    () =>
      parseDocument(
        "documents/bad/document.md",
        "---\ntype: Document\ntitle: Missing file\n---\n",
      ),
    /resource/,
  );
  assert.throws(
    () =>
      createDocumentDocument({
        docSlug: "x",
        fileName: "a.pdf",
        title: "   ",
        subjectSlugs: ["ada-lovelace"],
      }),
    /title/,
  );
});

