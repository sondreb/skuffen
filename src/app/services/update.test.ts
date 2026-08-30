import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  BROWSER_UPDATE_MESSAGE,
  compareVersions,
  evaluateUpdate,
  normalizeReleaseVersion,
  pickReleaseAsset,
  selectPublishedRelease,
  windowsMsiInstallArgs,
  windowsNsisInstallArgs,
  type DesktopRuntime,
  type GithubRelease,
} from "./update.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "update.fixture.json"), "utf8")) as {
  draftOnly: GithubRelease[];
  published: GithubRelease;
  mixed: GithubRelease[];
};

function runtime(overrides: Partial<DesktopRuntime> = {}): DesktopRuntime {
  return { version: "0.1.6", os: "linux", arch: "x86_64", appImage: false, ...overrides };
}

test("compareVersions orders semver and strips the v prefix", () => {
  assert.equal(compareVersions("0.1.6", "0.1.6"), 0);
  assert.equal(compareVersions("v0.1.6", "0.1.6"), 0);
  assert.ok(compareVersions("0.1.5", "0.1.6") < 0);
  assert.ok(compareVersions("0.2.0", "0.1.9") > 0);
  assert.ok(compareVersions("1.0.0", "0.9.9") > 0);
  assert.equal(normalizeReleaseVersion("v0.2.0"), "0.2.0");
});

test("selectPublishedRelease skips drafts and prereleases", () => {
  assert.equal(selectPublishedRelease(fixture.draftOnly), null);
  const published = selectPublishedRelease(fixture.mixed);
  assert.equal(published?.tag_name, "v0.1.8");
});

test("pickReleaseAsset prefers NSIS on Windows and matches arch", () => {
  const assets = fixture.published.assets ?? [];
  const win64 = pickReleaseAsset(assets, runtime({ os: "windows", arch: "x86_64" }));
  assert.equal(win64?.name, "Skuffen_0.2.0_x64-setup.exe");
  const winArm = pickReleaseAsset(assets, runtime({ os: "windows", arch: "aarch64" }));
  assert.equal(winArm?.name, "Skuffen_0.2.0_arm64-setup.exe");
  assert.deepEqual(windowsNsisInstallArgs(), ["/P", "/UPDATE", "/R"]);
  assert.deepEqual(windowsMsiInstallArgs("C:\\Temp\\Skuffen.msi"), [
    "/i",
    "C:\\Temp\\Skuffen.msi",
    "/passive",
    "/norestart",
  ]);
});

test("pickReleaseAsset prefers dmg on macOS and matches arch", () => {
  const assets = fixture.published.assets ?? [];
  const apple = pickReleaseAsset(assets, runtime({ os: "macos", arch: "aarch64" }));
  assert.equal(apple?.name, "Skuffen_0.2.0_aarch64.dmg");
  const intel = pickReleaseAsset(assets, runtime({ os: "macos", arch: "x86_64" }));
  assert.equal(intel?.name, "Skuffen_0.2.0_x64.dmg");
});

test("pickReleaseAsset prefers deb on Linux and AppImage when running as one", () => {
  const assets = fixture.published.assets ?? [];
  const deb = pickReleaseAsset(assets, runtime({ os: "linux", arch: "x86_64" }));
  assert.equal(deb?.name, "Skuffen_0.2.0_amd64.deb");
  const image = pickReleaseAsset(assets, runtime({ os: "linux", arch: "x86_64", appImage: true }));
  assert.equal(image?.name, "Skuffen_0.2.0_amd64.AppImage");
  const armDeb = pickReleaseAsset(assets, runtime({ os: "linux", arch: "aarch64" }));
  assert.equal(armDeb?.name, "Skuffen_0.2.0_aarch64.deb");
});

test("pickReleaseAsset ignores updater sidecars and signatures", () => {
  const assets = fixture.published.assets ?? [];
  const picked = pickReleaseAsset(assets, runtime({ os: "windows", arch: "x86_64" }));
  assert.ok(picked);
  assert.doesNotMatch(picked.name, /\.sig$|\.json$/i);
});

test("evaluateUpdate reports up to date, newer, and no published release", () => {
  const current = evaluateUpdate("0.2.0", fixture.published, runtime({ os: "windows", arch: "x86_64" }));
  assert.equal(current.kind, "current");
  assert.match(current.message, /latest published release/);

  const newer = evaluateUpdate("0.1.6", fixture.published, runtime({ os: "windows", arch: "x86_64" }));
  assert.equal(newer.kind, "available");
  assert.equal(newer.latestVersion, "0.2.0");
  assert.equal(newer.asset?.name, "Skuffen_0.2.0_x64-setup.exe");
  assert.match(newer.notes ?? "", /People-graph stays in app data/);

  const none = evaluateUpdate("0.1.6", selectPublishedRelease(fixture.draftOnly), runtime());
  assert.equal(none.kind, "none-published");
  assert.match(none.message, /Drafts are invisible/);
});

test("evaluateUpdate says so when this OS has no installer asset", () => {
  const empty: GithubRelease = { ...fixture.published, assets: [] };
  const decision = evaluateUpdate("0.1.0", empty, runtime({ os: "macos", arch: "aarch64" }));
  assert.equal(decision.kind, "no-asset");
  assert.match(decision.message, /no installer for this OS\/arch/);
});

test("browser preview never implies a GitHub download", () => {
  assert.match(BROWSER_UPDATE_MESSAGE, /desktop app/);
});

test("bundle stays unsigned GitHub fallback: no updater artifacts, ayatana-only apt", () => {
  const root = join(here, "..", "..", "..");
  const tauri = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8")) as {
    identifier: string;
    bundle: {
      targets?: string | string[];
      createUpdaterArtifacts?: boolean;
      windows?: { nsis?: { installMode?: string; displayLanguageSelector?: boolean; template?: string } };
    };
  };
  assert.equal(tauri.identifier, "me.grok.skuffen");
  assert.equal(tauri.bundle.createUpdaterArtifacts, false);
  assert.deepEqual(tauri.bundle.targets, ["nsis", "app", "dmg", "deb", "rpm", "appimage"]);
  assert.ok(!Array.isArray(tauri.bundle.targets) || !tauri.bundle.targets.includes("msi"));
  assert.equal(tauri.bundle.windows?.nsis?.installMode, "currentUser");
  assert.equal(tauri.bundle.windows?.nsis?.displayLanguageSelector, false);
  assert.equal(tauri.bundle.windows?.nsis?.template, "windows/nsis/installer.nsi");

  // Manual verify: install 0.1.x, run the next NSIS setup (double-click, no flags),
  // same $INSTDIR, app launches, people-graph intact, no Already Installed prompt.
  const nsis = readFileSync(join(root, "src-tauri", "windows", "nsis", "installer.nsi"), "utf8");
  const onInit = nsis.match(/Function \.onInit[\s\S]*?^FunctionEnd/m)?.[0] ?? "";
  assert.match(onInit, /StrCpy \$PassiveMode 1/);
  assert.doesNotMatch(onInit, /GetOptions \$CMDLINE "\/P" \$PassiveMode/);
  assert.match(nsis, /Skuffen one-click: overwrite/);
  assert.match(nsis, /Do not ExecWait the uninstaller/);
  assert.match(nsis, /WiX leftover: uninstall that MSI once/);
  assert.doesNotMatch(nsis, /TAURI_SIGNING_PRIVATE_KEY/);

  // #73: one-click skips the finish page, so .onInstSuccess must launch.
  // Stock Tauri gated that on /R (never present on double-click).
  const onInstSuccess = nsis.match(/Function \.onInstSuccess[\s\S]*?^FunctionEnd/m)?.[0] ?? "";
  assert.match(onInstSuccess, /\$UpdateMode = 1/);
  assert.match(onInstSuccess, /Return/);
  assert.match(onInstSuccess, /\$\{Silent\}/);
  assert.match(onInstSuccess, /\$\{GetOptions\} \$CMDLINE "\/R"/);
  const passiveIdx = onInstSuccess.indexOf("${ElseIf} $PassiveMode = 1");
  assert.ok(passiveIdx >= 0, "PassiveMode launch branch is missing");
  const passiveLaunch = onInstSuccess.slice(passiveIdx);
  assert.match(passiveLaunch, /nsis_tauri_utils::RunAsUser/);
  assert.doesNotMatch(passiveLaunch, /\$\{GetOptions\} \$CMDLINE "\/R"/);

  const release = readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8");
  assert.match(release, /releaseDraft: true/);
  assert.match(release, /uploadUpdaterJson: false/);
  const apt = release.match(/sudo apt-get install -y \\([\s\S]*?)patchelf/)?.[1] ?? "";
  assert.match(apt, /libayatana-appindicator3-dev/);
  assert.doesNotMatch(apt, /libappindicator3-dev/);
  assert.doesNotMatch(release, /TAURI_SIGNING_PRIVATE_KEY/);
});
