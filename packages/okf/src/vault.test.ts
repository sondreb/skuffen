import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDocumentDocument, createPersonDocument, createPhotoDocument, createPlaceDocument, parseDocument, serializeDocument } from "./index.ts";
import {
  EncryptedBundleError,
  decodeKey,
  decryptBytes,
  encodeKey,
  encryptBytes,
  generateKey,
  isEncrypted,
  normalizeVaultPath,
  VAULT_KEY_ID,
  VAULT_MAGIC,
} from "./vault.ts";
import { exportPlainBundle, listBundleFiles, readBundleFile, unsealBundle, writeBundleFile } from "./vault-fs.ts";

test("file path is identity: leftover encrypting does not rename the document", () => {
  const key = generateKey();
  const path = "people/ada-lovelace/person.md";
  const doc = createPersonDocument({
    slug: "ada-lovelace",
    title: "Ada Lovelace",
    email: "ada@example.com",
  });
  const plain = Buffer.from(serializeDocument(doc), "utf8");
  const sealed = encryptBytes(key, path, plain);
  assert.equal(normalizeVaultPath(path), path);
  assert.ok(isEncrypted(sealed));
  assert.equal(decryptBytes(key, path, sealed).toString("utf8"), plain.toString("utf8"));
});

test("leftover ciphertext is not plaintext markdown, YAML, or the email", () => {
  const key = generateKey();
  const path = "people/ada-lovelace/person.md";
  const plain = Buffer.from(
    serializeDocument(
      createPersonDocument({
        slug: "ada-lovelace",
        title: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+47 123 45 678",
        body: "Secret note about the Analytical Engine.",
      }),
    ),
    "utf8",
  );
  const sealed = encryptBytes(key, path, plain);
  const hay = sealed.toString("latin1");
  assert.match(hay.slice(0, 5), new RegExp(VAULT_MAGIC));
  assert.doesNotMatch(hay, /Ada Lovelace/);
  assert.doesNotMatch(hay, /ada@example.com/);
  assert.doesNotMatch(hay, /given_name/);
  assert.doesNotMatch(hay, /Analytical Engine/);
  assert.doesNotMatch(hay, /okf_version/);
});

test("document files (binary) and photos still decrypt leftover ciphertext; concept path stays identity", () => {
  const key = generateKey();
  const filePath = "documents/plot-12-hvaler/plot-12.pdf";
  const pdf = Buffer.from("%PDF-1.4 secret-document", "utf8");
  const sealed = encryptBytes(key, filePath, pdf);
  assert.ok(isEncrypted(sealed));
  assert.doesNotMatch(Buffer.from(sealed).toString("latin1"), /secret-document/);
  assert.deepEqual(Buffer.from(decryptBytes(key, filePath, sealed)), pdf);

  const concept = createDocumentDocument({
    docSlug: "plot-12-hvaler",
    fileName: "plot-12.pdf",
    title: "Plot 12, Hvaler",
    kind: "document",
    subjectSlugs: ["ada-lovelace"],
  });
  assert.equal(concept.path, "documents/plot-12-hvaler/document.md");
});

test("photos (binary) leftover ciphertext still round-trips", () => {
  const key = generateKey();
  const path = "people/ada-lovelace/photos/portrait.jpg";
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xaa, 0xbb]);
  const sealed = encryptBytes(key, path, jpeg);
  assert.ok(isEncrypted(sealed));
  assert.deepEqual(Buffer.from(decryptBytes(key, path, sealed)), jpeg);
  const concept = createPhotoDocument({ slug: "ada-lovelace", fileName: "portrait.jpg" });
  assert.equal(concept.path, "people/ada-lovelace/photos/portrait.md");
});

test("wrong key or swapped path fails closed and does not rewrite", () => {
  const key = generateKey();
  const other = generateKey();
  const path = "people/ada-lovelace/person.md";
  const sealed = encryptBytes(key, path, Buffer.from("hello", "utf8"));
  assert.throws(() => decryptBytes(other, path, sealed), /Could not decrypt/);
  assert.throws(() => decryptBytes(key, "people/other/person.md", sealed), /Could not decrypt/);
});

test("encode/decode leftover key is 32-byte base64", () => {
  const key = generateKey();
  assert.equal(key.length, 32);
  const encoded = encodeKey(key);
  assert.equal(decodeKey(encoded).length, 32);
  assert.deepEqual(Buffer.from(decodeKey(encoded)), Buffer.from(key));
  assert.throws(() => decodeKey("dG9vLXNob3J0"), /32 bytes/);
  assert.equal(VAULT_KEY_ID, "okf-master-key");
});

test("writes are plaintext markdown+YAML; leftover ciphertext is rewritten once", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-vault-"));
  const dest = mkdtempSync(join(tmpdir(), "skuffen-export-"));
  const key = generateKey();
  const person = createPersonDocument({
    slug: "ada-lovelace",
    title: "Ada Lovelace",
    email: "ada@example.com",
  });
  const abs = join(root, person.path);
  mkdirSync(join(abs, ".."), { recursive: true });
  const plain = serializeDocument(person);
  writeFileSync(abs, encryptBytes(key, person.path, Buffer.from(plain, "utf8")));
  writeFileSync(
    join(root, "index.md"),
    encryptBytes(key, "index.md", Buffer.from('---\nokf_version: "0.2"\n---\n\n# Skuffen\n', "utf8")),
  );
  const photo = Buffer.from("FAKEJPEG-ada-portrait", "utf8");
  mkdirSync(join(root, "people/ada-lovelace/photos"), { recursive: true });
  writeFileSync(
    join(root, "people/ada-lovelace/photos/portrait.jpg"),
    encryptBytes(key, "people/ada-lovelace/photos/portrait.jpg", photo),
  );
  writeFileSync(join(root, ".skuffen-vault.json"), '{"format":"skuffen-okf-vault","encrypted":true}\n');

  assert.ok(isEncrypted(readFileSync(abs)));
  assert.throws(() => readBundleFile(root, person.path, null), EncryptedBundleError);
  assert.ok(isEncrypted(readFileSync(abs)), "missing key must leave leftover ciphertext unchanged");

  const { rewritten } = unsealBundle(root, key);
  assert.equal(rewritten, 3);
  assert.match(readFileSync(abs, "utf8"), /Ada Lovelace/);
  assert.match(readFileSync(abs, "utf8"), /ada@example.com/);
  assert.match(readFileSync(join(root, "index.md"), "utf8"), /okf_version: "0.2"/);
  assert.deepEqual(readFileSync(join(root, "people/ada-lovelace/photos/portrait.jpg")), photo);
  assert.equal(existsSync(join(root, ".skuffen-vault.json")), false);
  assert.deepEqual(listBundleFiles(root), [
    "index.md",
    "people/ada-lovelace/person.md",
    "people/ada-lovelace/photos/portrait.jpg",
  ]);

  writeBundleFile(root, "log.md", Buffer.from("# Directory Update Log\n* **Accept**: wrote plaintext.\n", "utf8"));
  assert.match(readFileSync(join(root, "log.md"), "utf8"), /Accept/);
  assert.ok(!isEncrypted(readFileSync(join(root, "log.md"))));

  exportPlainBundle(root, dest, null);
  assert.equal(readFileSync(join(dest, person.path), "utf8"), plain);
  assert.match(readFileSync(join(dest, "index.md"), "utf8"), /okf_version: "0.2"/);
  assert.deepEqual(readFileSync(join(dest, "people/ada-lovelace/photos/portrait.jpg")), photo);
});

test("readBundleFile decrypts leftover ciphertext once and rewrites plaintext", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-rewrite-"));
  const key = generateKey();
  const path = "log.md";
  const plain = "# Directory Update Log\n";
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, path), encryptBytes(key, path, Buffer.from(plain, "utf8")));
  const opened = readBundleFile(root, path, key);
  assert.equal(opened?.toString("utf8"), plain);
  const onDisk = readFileSync(join(root, path));
  assert.ok(!isEncrypted(onDisk));
  assert.equal(onDisk.toString("utf8"), plain);
});

test("wrong leftover key leaves the ciphertext file unchanged", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-wrong-key-"));
  const key = generateKey();
  const other = generateKey();
  const path = "log.md";
  mkdirSync(root, { recursive: true });
  const sealed = Buffer.from(encryptBytes(key, path, Buffer.from("# secret\n", "utf8")));
  writeFileSync(join(root, path), sealed);
  assert.throws(() => readBundleFile(root, path, other), /Could not decrypt log.md/);
  assert.deepEqual(readFileSync(join(root, path)), sealed);
});

test("Place coordinates are stored as plaintext markdown+YAML", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-place-"));
  const place = createPlaceDocument({
    slug: "ada-lovelace",
    address: "12 St James's Square, London",
    latitude: 51.50848,
    longitude: -0.12574,
    source: "search",
  });
  writeBundleFile(root, place.path, Buffer.from(serializeDocument(place), "utf8"));
  const onDisk = readFileSync(join(root, place.path), "utf8");
  assert.match(onDisk, /St James's Square/);
  assert.match(onDisk, /51\.50848/);
  assert.match(onDisk, /-0\.12574/);
  assert.match(onDisk, /type: Place/);
  const plain = readBundleFile(root, place.path, null);
  assert.ok(plain);
  const reloaded = parseDocument(place.path, plain.toString("utf8"));
  assert.equal(reloaded.frontmatter.address, "12 St James's Square, London");
  assert.equal(reloaded.frontmatter.latitude, 51.50848);
});

test("writeBundleFile always leaves plaintext, even when a leftover key is passed", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-plain-write-"));
  const key = generateKey();
  writeBundleFile(root, "index.md", Buffer.from('---\nokf_version: "0.2"\n---\n'), key);
  assert.match(readFileSync(join(root, "index.md"), "utf8"), /okf_version/);
  assert.ok(!isEncrypted(readFileSync(join(root, "index.md"))));
});

test("known vector: leftover AES-256-GCM with fixed key and nonce still decrypts", () => {
  const key = Buffer.alloc(32, 0x11);
  const nonce = Buffer.alloc(12, 0x22);
  const path = "people/ada-lovelace/person.md";
  const plain = Buffer.from("hello-okf", "utf8");
  const sealed = encryptBytes(key, path, plain, nonce);
  const hex = Buffer.from(sealed).toString("hex");
  assert.equal(
    hex,
    "534b554631012222222222222222222222227f926b25afe2f0348330e625b791e5c2a953a861ff200aafef",
  );
  assert.equal(decryptBytes(key, path, sealed).toString("utf8"), "hello-okf");
});
