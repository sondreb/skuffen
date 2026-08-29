import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPersonDocument, createPhotoDocument, createPlaceDocument, parseDocument, serializeDocument } from "./index.ts";
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
import { exportPlainBundle, listBundleFiles, readBundleFile, sealBundle, writeBundleFile } from "./vault-fs.ts";

test("file path is identity: encrypting does not rename the document", () => {
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

test("ciphertext is not plaintext markdown, YAML, or the email", () => {
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

test("photos (binary) round-trip and stay non-plaintext", () => {
  const key = generateKey();
  const path = "people/ada-lovelace/photos/portrait.jpg";
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xaa, 0xbb]);
  const sealed = encryptBytes(key, path, jpeg);
  assert.ok(isEncrypted(sealed));
  assert.notDeepEqual(Buffer.from(sealed.subarray(0, jpeg.length)), jpeg);
  assert.deepEqual(Buffer.from(decryptBytes(key, path, sealed)), jpeg);
  const concept = createPhotoDocument({ slug: "ada-lovelace", fileName: "portrait.jpg" });
  assert.equal(concept.path, "people/ada-lovelace/photos/portrait.md");
});

test("wrong key or swapped path fails closed", () => {
  const key = generateKey();
  const other = generateKey();
  const path = "people/ada-lovelace/person.md";
  const sealed = encryptBytes(key, path, Buffer.from("hello", "utf8"));
  assert.throws(() => decryptBytes(other, path, sealed), /Could not decrypt/);
  assert.throws(() => decryptBytes(key, "people/other/person.md", sealed), /Could not decrypt/);
});

test("encode/decode key is 32-byte base64", () => {
  const key = generateKey();
  assert.equal(key.length, 32);
  const encoded = encodeKey(key);
  assert.equal(decodeKey(encoded).length, 32);
  assert.deepEqual(Buffer.from(decodeKey(encoded)), Buffer.from(key));
  assert.throws(() => decodeKey("dG9vLXNob3J0"), /32 bytes/);
  assert.equal(VAULT_KEY_ID, "okf-master-key");
});

test("sealBundle encrypts a directory in place; export restores plaintext OKF", () => {
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
  writeFileSync(abs, plain, "utf8");
  writeFileSync(join(root, "index.md"), '---\nokf_version: "0.2"\n---\n\n# Skuffen\n', "utf8");
  const photo = Buffer.from("FAKEJPEG-ada-portrait", "utf8");
  mkdirSync(join(root, "people/ada-lovelace/photos"), { recursive: true });
  writeFileSync(join(root, "people/ada-lovelace/photos/portrait.jpg"), photo);

  const { sealed } = sealBundle(root, key);
  assert.equal(sealed, 3);

  const onDisk = readFileSync(abs);
  assert.ok(isEncrypted(onDisk));
  assert.doesNotMatch(onDisk.toString("latin1"), /Ada Lovelace/);
  assert.doesNotMatch(onDisk.toString("latin1"), /ada@example.com/);
  assert.doesNotMatch(readFileSync(join(root, "people/ada-lovelace/photos/portrait.jpg")).toString("latin1"), /FAKEJPEG/);
  assert.doesNotMatch(readFileSync(join(root, "index.md")).toString("latin1"), /okf_version/);
  assert.ok(readFileSync(join(root, ".skuffen-vault.json"), "utf8").includes("aes-256-gcm"));
  assert.deepEqual(listBundleFiles(root), [
    "index.md",
    "people/ada-lovelace/person.md",
    "people/ada-lovelace/photos/portrait.jpg",
  ]);

  assert.throws(() => readBundleFile(root, person.path, null), EncryptedBundleError);

  exportPlainBundle(root, dest, key);
  assert.equal(readFileSync(join(dest, person.path), "utf8"), plain);
  assert.match(readFileSync(join(dest, "index.md"), "utf8"), /okf_version: "0.2"/);
  assert.deepEqual(readFileSync(join(dest, "people/ada-lovelace/photos/portrait.jpg")), photo);
});

test("Place coordinates and address are sealed with the vault key", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-place-vault-"));
  const key = generateKey();
  const place = createPlaceDocument({
    slug: "ada-lovelace",
    address: "12 St James's Square, London",
    latitude: 51.50848,
    longitude: -0.12574,
    source: "search",
  });
  writeBundleFile(root, place.path, Buffer.from(serializeDocument(place), "utf8"), key);
  const onDisk = readFileSync(join(root, place.path));
  assert.ok(isEncrypted(onDisk));
  assert.doesNotMatch(onDisk.toString("latin1"), /St James's Square/);
  assert.doesNotMatch(onDisk.toString("latin1"), /51\.50848/);
  assert.doesNotMatch(onDisk.toString("latin1"), /-0\.12574/);
  assert.doesNotMatch(onDisk.toString("latin1"), /type: Place/);
  const plain = readBundleFile(root, place.path, key);
  assert.ok(plain);
  const reloaded = parseDocument(place.path, plain.toString("utf8"));
  assert.equal(reloaded.frontmatter.address, "12 St James's Square, London");
  assert.equal(reloaded.frontmatter.latitude, 51.50848);
});

test("writeBundleFile with a key never leaves plaintext; without a key it stays honest portable OKF", () => {
  const encryptedRoot = mkdtempSync(join(tmpdir(), "skuffen-enc-"));
  const plainRoot = mkdtempSync(join(tmpdir(), "skuffen-plain-"));
  const key = generateKey();
  writeBundleFile(encryptedRoot, "index.md", Buffer.from('---\nokf_version: "0.2"\n---\n'), key);
  writeBundleFile(plainRoot, "index.md", Buffer.from('---\nokf_version: "0.2"\n---\n'), null);
  assert.ok(isEncrypted(readFileSync(join(encryptedRoot, "index.md"))));
  assert.match(readFileSync(join(plainRoot, "index.md"), "utf8"), /okf_version/);
});

test("known vector: AES-256-GCM with fixed key and nonce", () => {
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
