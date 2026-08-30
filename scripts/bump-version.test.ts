import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyVersion,
  isVersionBumpCommitMessage,
  parseArgs,
  releaseVersionSpec,
  resolveVersion,
  shouldSkipReleaseReentry,
  versionBumpCommitMessage,
} from "./bump-version.mjs";

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

test("parseArgs treats empty as patch and supports dry-run/root/from-github-event", () => {
  assert.deepEqual(parseArgs([]), {
    dryRun: false,
    fromGithubEvent: false,
    root: undefined,
    spec: "patch",
  });
  assert.deepEqual(parseArgs(["--dry-run", "--from-github-event", "--root", "/tmp/x", "minor"]), {
    dryRun: true,
    fromGithubEvent: true,
    root: "/tmp/x",
    spec: "minor",
  });
});

test("push to main always patches; dispatch keeps inputs; tag uses the tag", () => {
  // After Latch merges this workflow PR, that push must mint 0.1.2. Do not bump the tree here.
  assert.equal(
    resolveVersion("0.1.1", releaseVersionSpec({ eventName: "push", ref: "refs/heads/main" })),
    "0.1.2",
  );
  assert.equal(releaseVersionSpec({ eventName: "push", ref: "refs/heads/main" }), "patch");
  assert.equal(releaseVersionSpec({ eventName: "workflow_dispatch" }), "patch");
  assert.equal(releaseVersionSpec({ eventName: "workflow_dispatch", dispatchSpec: "" }), "patch");
  assert.equal(releaseVersionSpec({ eventName: "workflow_dispatch", dispatchSpec: "minor" }), "minor");
  assert.equal(releaseVersionSpec({ eventName: "workflow_dispatch", dispatchSpec: "0.2.0" }), "0.2.0");
  assert.equal(releaseVersionSpec({ eventName: "push", ref: "refs/tags/v0.1.2" }), "0.1.2");
  assert.throws(
    () => releaseVersionSpec({ eventName: "push", ref: "refs/heads/feature" }),
    /Unsupported release trigger/,
  );

  const root = mkdtempSync(join(tmpdir(), "skuffen-release-spec-"));
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ version: "0.1.1" }, null, 2)}\n`);
  const script = fileURLToPath(new URL("./bump-version.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--dry-run", "--from-github-event", "--root", root], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main", INPUT_VERSION: "" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "0.1.2");
});

test("skip-loop: bot or chore bump commit must not bump again", () => {
  const bump = versionBumpCommitMessage("0.1.2");
  assert.equal(bump, "chore: bump version to 0.1.2");
  assert.equal(isVersionBumpCommitMessage(bump), true);
  assert.equal(isVersionBumpCommitMessage(`${bump}\n\nCo-authored-by: bot`), true);
  assert.equal(isVersionBumpCommitMessage("Draft-release on every merge to main"), false);

  assert.equal(shouldSkipReleaseReentry({ eventName: "workflow_dispatch", actor: "github-actions[bot]" }), false);
  assert.equal(
    shouldSkipReleaseReentry({
      eventName: "push",
      actor: "latch",
      commitMessage: "Merge pull request #30 from cursor/draft-release-on-main",
    }),
    false,
  );
  assert.equal(
    shouldSkipReleaseReentry({
      eventName: "push",
      actor: "github-actions[bot]",
      commitMessage: bump,
    }),
    true,
  );
  assert.equal(
    shouldSkipReleaseReentry({
      eventName: "push",
      actor: "github-actions[bot]",
      commitMessage: "chore: generate v0.1.2 tag",
    }),
    true,
  );
  assert.equal(
    shouldSkipReleaseReentry({
      eventName: "push",
      actor: "someone-with-a-pat",
      commitMessage: bump,
    }),
    true,
  );
});

test("release.yml quotes skip-loop if so YAML does not parse a colon mapping", () => {
  const yaml = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "..", ".github", "workflows", "release.yml"), "utf8");
  const ifLines = yaml.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("if:"));
  const skipLoopIfs = ifLines.filter((line) => line.includes("!startsWith"));
  assert.equal(skipLoopIfs.length, 2, "version and build jobs must both have the skip-loop if");
  // ${{ }} alone is not enough: the colon in 'chore: bump version to ' is a
  // YAML mapping on an unquoted scalar (run 33299195969). Quote the entire if.
  const quotedSkipLoop =
    'if: "${{ github.event_name == \'workflow_dispatch\' || (github.actor != \'github-actions[bot]\' && !startsWith(github.event.head_commit.message, \'chore: bump version to \')) }}"';
  for (const line of skipLoopIfs) {
    assert.match(line, /^if: "\$\{\{ .+ \}\}"$/, `skip-loop if must be quoted if: "\${{ ... }}", not merely wrapped in \${{ }}: ${line}`);
    assert.equal(line, quotedSkipLoop);
  }
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
