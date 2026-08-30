export const GITHUB_RELEASES_REPO = "sondreb/skuffen";
export const BROWSER_UPDATE_MESSAGE = "Updates need the desktop app.";
export const UPDATE_WHISPER =
  "Updates look at published GitHub Releases. Drafts stay unpublished until Sondre publishes them.";
export const NO_PUBLISHED_RELEASE_MESSAGE =
  "No published GitHub Release yet. Drafts are invisible until Sondre publishes one.";

export type UpdateOs = "windows" | "macos" | "linux";
export type UpdateArch = "x86_64" | "aarch64" | "x86" | "arm";

export interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
  content_type?: string;
  size?: number;
}

export interface GithubRelease {
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  html_url?: string;
  published_at?: string | null;
  assets?: GithubReleaseAsset[];
}

export interface DesktopRuntime {
  version: string;
  os: UpdateOs;
  arch: UpdateArch;
  appImage?: boolean;
}

export type UpdateKind = "browser" | "current" | "available" | "none-published" | "no-asset" | "error";

export interface UpdateAssetPick {
  name: string;
  url: string;
}

export interface UpdateDecision {
  kind: UpdateKind;
  currentVersion: string;
  latestVersion?: string;
  notes?: string;
  asset?: UpdateAssetPick;
  message: string;
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i;

export function parseSemver(raw: string): [number, number, number] | null {
  const match = SEMVER.exec(String(raw ?? "").trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function normalizeReleaseVersion(tag: string): string {
  const trimmed = String(tag ?? "").trim();
  return trimmed.startsWith("v") || trimmed.startsWith("V") ? trimmed.slice(1) : trimmed;
}

/** Negative if `a` is older than `b`, 0 if equal, positive if `a` is newer. */
export function compareVersions(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (left && right) {
    for (let i = 0; i < 3; i++) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return 0;
  }
  return normalizeReleaseVersion(a).localeCompare(normalizeReleaseVersion(b), "en");
}

export function isPublishedRelease(release: GithubRelease | null | undefined): boolean {
  if (!release || release.draft || release.prerelease) return false;
  return Boolean(release.tag_name || release.name);
}

export function selectPublishedRelease(releases: GithubRelease[]): GithubRelease | null {
  return releases.find((release) => isPublishedRelease(release)) ?? null;
}

function assetName(asset: GithubReleaseAsset): string {
  return (asset.name || "").toLowerCase();
}

function isSignatureOrSidecar(name: string): boolean {
  return (
    name.endsWith(".sig") ||
    name.endsWith(".asc") ||
    name.endsWith(".json") ||
    name.endsWith(".blockmap") ||
    name.includes(".nsis.zip") ||
    name.endsWith(".zip")
  );
}

function archTokens(arch: UpdateArch): string[] {
  if (arch === "aarch64") return ["aarch64", "arm64", "apple-silicon"];
  if (arch === "x86_64") return ["x86_64", "x64", "amd64", "win64", "x86-64"];
  if (arch === "x86") return ["x86", "i686", "win32", "ia32"];
  return ["arm", "armv7"];
}

function archMatches(name: string, arch: UpdateArch): boolean {
  const tokens = archTokens(arch);
  if (tokens.some((token) => name.includes(token))) return true;
  const others = (["x86_64", "aarch64", "x86", "arm"] as UpdateArch[])
    .filter((item) => item !== arch)
    .flatMap((item) => archTokens(item));
  return !others.some((token) => name.includes(token));
}

function scoreArch(name: string, arch: UpdateArch): number {
  if (archTokens(arch).some((token) => name.includes(token))) return 2;
  if (archMatches(name, arch)) return 1;
  return -10;
}

function pickBy(assets: GithubReleaseAsset[], pred: (name: string) => boolean, arch: UpdateArch): GithubReleaseAsset | null {
  const ranked = assets
    .filter((asset) => {
      const name = assetName(asset);
      return pred(name) && !isSignatureOrSidecar(name) && scoreArch(name, arch) >= 0;
    })
    .sort((a, b) => scoreArch(assetName(b), arch) - scoreArch(assetName(a), arch));
  return ranked[0] ?? null;
}

export function pickReleaseAsset(assets: GithubReleaseAsset[] | undefined, runtime: DesktopRuntime): GithubReleaseAsset | null {
  const list = assets ?? [];
  if (runtime.os === "windows") {
    return (
      pickBy(list, (name) => name.includes("-setup.exe") || name.endsWith("-setup.exe"), runtime.arch) ||
      pickBy(list, (name) => name.endsWith(".exe") && !name.includes("uninstall"), runtime.arch) ||
      pickBy(list, (name) => name.endsWith(".msi"), runtime.arch)
    );
  }
  if (runtime.os === "macos") {
    return (
      pickBy(list, (name) => name.endsWith(".dmg"), runtime.arch) ||
      pickBy(list, (name) => name.endsWith(".app.tar.gz"), runtime.arch)
    );
  }
  const appImage = pickBy(list, (name) => name.endsWith(".appimage"), runtime.arch);
  const deb = pickBy(list, (name) => name.endsWith(".deb"), runtime.arch);
  const rpm = pickBy(list, (name) => name.endsWith(".rpm"), runtime.arch);
  if (runtime.appImage) return appImage || deb || rpm;
  return deb || appImage || rpm;
}

export function windowsNsisInstallArgs(): string[] {
  return ["/P", "/UPDATE", "/R"];
}

export function windowsMsiInstallArgs(installerPath: string): string[] {
  return ["/i", installerPath, "/passive", "/norestart"];
}

export function evaluateUpdate(
  currentVersion: string,
  release: GithubRelease | null,
  runtime: DesktopRuntime,
): UpdateDecision {
  if (!isPublishedRelease(release) || !release) {
    return {
      kind: "none-published",
      currentVersion,
      message: NO_PUBLISHED_RELEASE_MESSAGE,
    };
  }
  const latestVersion = normalizeReleaseVersion(release.tag_name || release.name || "");
  const cmp = compareVersions(currentVersion, latestVersion);
  const notes = release.body?.trim() || undefined;
  if (cmp >= 0) {
    return {
      kind: "current",
      currentVersion,
      latestVersion,
      notes,
      message:
        cmp === 0
          ? `You're on ${currentVersion}. That's the latest published release.`
          : `You're on ${currentVersion}, newer than published ${latestVersion}.`,
    };
  }
  const picked = pickReleaseAsset(release.assets, runtime);
  if (!picked) {
    return {
      kind: "no-asset",
      currentVersion,
      latestVersion,
      notes,
      message: `${latestVersion} is available (you have ${currentVersion}), but there is no installer for this OS/arch.`,
    };
  }
  return {
    kind: "available",
    currentVersion,
    latestVersion,
    notes,
    asset: { name: picked.name, url: picked.browser_download_url },
    message: `${latestVersion} is available (you have ${currentVersion}).`,
  };
}

export function browserUpdateDecision(): UpdateDecision {
  return { kind: "browser", currentVersion: "", message: BROWSER_UPDATE_MESSAGE };
}
