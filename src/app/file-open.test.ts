import assert from "node:assert/strict";
import { test } from "node:test";
import { localDocumentBundlePath, localFileMime, localFileName, localFileObjectUrl } from "./file-open.ts";

test("document paths stay bundle-relative and never remote", () => {
  assert.equal(
    localDocumentBundlePath("/documents/park-slip/notes.txt"),
    "documents/park-slip/notes.txt",
  );
  assert.equal(localDocumentBundlePath("documents/park-slip/notes.txt"), "documents/park-slip/notes.txt");
  assert.equal(localDocumentBundlePath("https://cdn.example/notes.txt"), null);
  assert.equal(localDocumentBundlePath("http://cdn.example/notes.txt"), null);
  assert.equal(localDocumentBundlePath("data:text/plain;base64,aa"), null);
});

test("open uses a local name and a local mime — no host to fetch", () => {
  assert.equal(localFileName("/documents/park-slip/notes.txt"), "notes.txt");
  assert.equal(localFileName("https://cdn.example/notes.txt", "file"), "file");
  assert.equal(localFileMime("documents/park-slip/notes.txt"), "text/plain");
  assert.equal(localFileMime("documents/park-slip/brief.pdf"), "application/pdf");
});

test("object URLs from local bytes are blob: — never http(s)", () => {
  const bytes = new TextEncoder().encode("local file, not uploaded");
  const url = localFileObjectUrl(bytes, "documents/park-slip/notes.txt");
  assert.ok(url);
  assert.match(url ?? "", /^blob:/);
  assert.doesNotMatch(url ?? "", /^https?:/);
  if (url) URL.revokeObjectURL(url);
  assert.equal(localFileObjectUrl(new Uint8Array(), "notes.txt"), null);
});
