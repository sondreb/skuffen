#!/usr/bin/env node
/**
 * Keep Skuffen versions in lockstep:
 * package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml
 * (plus package-lock.json root and the skuffen crate in Cargo.lock).
 *
 * Usage: node scripts/bump-version.mjs [--dry-run] [--root DIR] [--from-github-event] [patch|minor|major|x.y.z|vx.y.z]
 * Default spec is patch.
 *
 * Release workflow (.github/workflows/release.yml) contract:
 * - push to main: always bump patch (unless skip-loop), commit as github-actions[bot]
 * - workflow_dispatch: optional extra, same inputs as today (semver or patch/minor/major, default patch)
 * - tag v*: skip-safe path for tauri-action; do not bump again
 * Skip-loop: github-actions[bot] / "chore: bump version to X.Y.Z" must not bump or start a second matrix.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const IDENTIFIER = "me.grok.skuffen";
export const GITHUB_ACTIONS_BOT = "github-actions[bot]";
export const VERSION_BUMP_COMMIT_PREFIX = "chore: bump version to ";

export function parseSemver(version) {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`Invalid semver: ${version}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function resolveVersion(current, spec = "patch") {
  const raw = String(spec ?? "patch").trim() || "patch";
  const normalized = raw.startsWith("v") && SEMVER.test(raw.slice(1)) ? raw.slice(1) : raw;
  if (SEMVER.test(normalized)) return normalized;
  const parsed = parseSemver(current);
  if (normalized === "patch") return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  if (normalized === "minor") return `${parsed.major}.${parsed.minor + 1}.0`;
  if (normalized === "major") return `${parsed.major + 1}.0.0`;
  throw new Error(`Invalid version spec: ${spec}`);
}

export function paths(root) {
  return {
    packageJson: join(root, "package.json"),
    packageLock: join(root, "package-lock.json"),
    tauriConf: join(root, "src-tauri", "tauri.conf.json"),
    cargoToml: join(root, "src-tauri", "Cargo.toml"),
    cargoLock: join(root, "src-tauri", "Cargo.lock"),
  };
}

export function readCurrentVersion(root) {
  return JSON.parse(readFileSync(paths(root).packageJson, "utf8")).version;
}

function replaceFirst(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Could not update ${label}`);
  return source.replace(pattern, replacement);
}

export function applyVersion(root, version) {
  parseSemver(version);
  const files = paths(root);

  const pkg = JSON.parse(readFileSync(files.packageJson, "utf8"));
  pkg.version = version;
  writeFileSync(files.packageJson, `${JSON.stringify(pkg, null, 2)}\n`);

  try {
    let lock = readFileSync(files.packageLock, "utf8");
    let replaced = 0;
    lock = lock.replace(/"version": "\d+\.\d+\.\d+"/g, (match, offset) => {
      if (replaced < 2 && offset < 500) {
        replaced += 1;
        return `"version": "${version}"`;
      }
      return match;
    });
    writeFileSync(files.packageLock, lock);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") throw error;
  }

  const tauriRaw = readFileSync(files.tauriConf, "utf8");
  const tauri = JSON.parse(tauriRaw);
  if (tauri.identifier !== IDENTIFIER) {
    throw new Error(`Refusing to bump: identifier must stay ${IDENTIFIER}`);
  }
  tauri.version = version;
  writeFileSync(files.tauriConf, `${JSON.stringify(tauri, null, 2)}\n`);
  if (JSON.parse(readFileSync(files.tauriConf, "utf8")).identifier !== IDENTIFIER) {
    throw new Error(`Identifier drifted away from ${IDENTIFIER}`);
  }

  const cargoToml = replaceFirst(
    readFileSync(files.cargoToml, "utf8"),
    /^version = "[^"]+"/m,
    `version = "${version}"`,
    "src-tauri/Cargo.toml",
  );
  writeFileSync(files.cargoToml, cargoToml);

  try {
    const cargoLock = replaceFirst(
      readFileSync(files.cargoLock, "utf8"),
      /name = "skuffen"\nversion = "[^"]+"/,
      `name = "skuffen"\nversion = "${version}"`,
      "src-tauri/Cargo.lock",
    );
    writeFileSync(files.cargoLock, cargoLock);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") throw error;
  }

  return version;
}

export function versionBumpCommitMessage(version) {
  parseSemver(version);
  return `${VERSION_BUMP_COMMIT_PREFIX}${version}`;
}

export function isVersionBumpCommitMessage(message) {
  const firstLine = String(message ?? "").split(/\r?\n/, 1)[0].trim();
  if (!firstLine.startsWith(VERSION_BUMP_COMMIT_PREFIX)) return false;
  return SEMVER.test(firstLine.slice(VERSION_BUMP_COMMIT_PREFIX.length));
}

/**
 * Job-level `if` in .github/workflows/release.yml must match this.
 * Skip the workflow's own re-entry so we do not bump twice or start a second matrix.
 * workflow_dispatch always runs. The first run's build job uses the bump commit SHA.
 */
export function shouldSkipReleaseReentry({ eventName, actor, commitMessage } = {}) {
  if (eventName === "workflow_dispatch") return false;
  if (actor === GITHUB_ACTIONS_BOT) return true;
  if (isVersionBumpCommitMessage(commitMessage)) return true;
  return false;
}

/**
 * Version spec for a release run. Merge/push to main always patches so a new
 * draft exists (do not rebuild the same unpublished draft).
 */
export function releaseVersionSpec({ eventName, ref, dispatchSpec } = {}) {
  if (eventName === "workflow_dispatch") {
    const spec = String(dispatchSpec ?? "").trim();
    return spec || "patch";
  }
  if (eventName === "push" && ref === "refs/heads/main") return "patch";
  if (eventName === "push" && typeof ref === "string" && ref.startsWith("refs/tags/")) {
    const tag = ref.slice("refs/tags/".length);
    return tag.startsWith("v") ? tag.slice(1) : tag;
  }
  throw new Error(`Unsupported release trigger: ${eventName} ${ref ?? ""}`.trim());
}

export function parseArgs(argv) {
  const args = { dryRun: false, fromGithubEvent: false, root: undefined, spec: "patch" };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--from-github-event") args.fromGithubEvent = true;
    else if (arg === "--root") {
      args.root = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--root=")) args.root = arg.slice("--root=".length);
    else rest.push(arg);
  }
  if (rest[0]) args.spec = rest[0];
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  const root = args.root ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  const spec = args.fromGithubEvent
    ? releaseVersionSpec({
        eventName: process.env.GITHUB_EVENT_NAME,
        ref: process.env.GITHUB_REF,
        dispatchSpec: process.env.INPUT_VERSION,
      })
    : args.spec;
  const next = resolveVersion(readCurrentVersion(root), spec);
  if (!args.dryRun) applyVersion(root, next);
  process.stdout.write(`${next}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
