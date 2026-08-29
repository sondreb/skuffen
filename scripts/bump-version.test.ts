import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyVersion, parseArgs, resolveVersion } from "./bump-version.mjs";

test("resolveVersion default and keywords", () => {
  assert.equal(resolveVersion("0.1.0", "patch"), "0.1.1");
  assert.equal(resolveVersion("0.1.0", ""), "0.1.1");
  assert.equal(resolveVersion("0.1.0", "minor"), "0.2.0");
  assert.equal(resolveVersion("0.1.0", "major"), "1.0.0");
  assert.equal(resolveVersion("0.1.0", "0.3.2"), "0.3.2");
  assert.equal(resolveVersion("0.1.0", "v1.2.3"), "1.2.3");
});

test("resolveVersion rejects junk", () => {
  assert.throws(() => resolveVersion("0.1.0", "beta"), /Invalid version spec/);
  assert.throws(() => resolveVersion("nope", "patch"), /Invalid semver/);
});

test("parseArgs treats empty as patch and supports dry-run/root", () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, root: undefined, spec: "patch" });
  assert.deepEqual(parseArgs(["--dry-run", "--root", "/tmp/x", "minor"]), {
    dryRun: true,
    root: "/tmp/x",
    spec: "minor",
  });
});

test("applyVersion writes lockstep files and leaves identifier alone", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-version-"));
  mkdirSync(join(root, "src-tauri"), { recursive: true });
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "skuffen", version: "0.1.0" }, null, 2)}\n`);
  writeFileSync(
    join(root, "package-lock.json"),
    `${JSON.stringify({ name: "skuffen", version: "0.1.0", packages: { "": { name: "skuffen", version: "0.1.0" } } }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, "src-tauri", "tauri.conf.json"),
    `${JSON.stringify({ version: "0.1.0", identifier: "me.grok.skuffen" }, null, 2)}\n`,
  );
  writeFileSync(join(root, "src-tauri", "Cargo.toml"), '[package]\nname = "skuffen"\nversion = "0.1.0"\n');
  writeFileSync(join(root, "src-tauri", "Cargo.lock"), 'name = "skuffen"\nversion = "0.1.0"\n');

  applyVersion(root, "0.1.1");

  assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, "0.1.1");
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  assert.equal(lock.version, "0.1.1");
  assert.equal(lock.packages[""].version, "0.1.1");
  const tauri = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  assert.equal(tauri.version, "0.1.1");
  assert.equal(tauri.identifier, "me.grok.skuffen");
  assert.match(readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8"), /^version = "0\.1\.1"$/m);
  assert.match(readFileSync(join(root, "src-tauri", "Cargo.lock"), "utf8"), /name = "skuffen"\nversion = "0\.1\.1"/);
});

test("applyVersion refuses a drifted identifier", () => {
  const root = mkdtempSync(join(tmpdir(), "skuffen-id-"));
  mkdirSync(join(root, "src-tauri"), { recursive: true });
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ version: "0.1.0" }, null, 2)}\n`);
  writeFileSync(
    join(root, "src-tauri", "tauri.conf.json"),
    `${JSON.stringify({ version: "0.1.0", identifier: "com.example.wrong" }, null, 2)}\n`,
  );
  writeFileSync(join(root, "src-tauri", "Cargo.toml"), 'version = "0.1.0"\n');
  assert.throws(() => applyVersion(root, "0.1.1"), /identifier must stay me\.grok\.skuffen/);
});
