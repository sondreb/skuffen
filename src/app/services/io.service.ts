import { Injectable } from "@angular/core";
import type { Settings, VaultStatus } from "../models";
import {
  BROWSER_OAUTH_ERROR,
  type GrokDevicePending,
  type GrokOAuthPoll,
  type GrokOAuthStatus,
  publicDevicePending,
  publicOauthPoll,
  publicOauthStatus,
} from "./grok-oauth";
import type { DesktopRuntime, GithubRelease } from "./update";
import { purgeDurableBrowserSecrets, webSecretDelete, webSecretGet, webSecretSet } from "./web-secrets";

export const BROWSER_VAULT_MESSAGE =
  "Browser preview keeps the people-graph in this tab's localStorage stand-in (plaintext). Use npm run tauri dev for the on-disk OKF folder. Tokens still never go to localStorage.";

const FILES_KEY = "skuffen.bundle.files";
const BLOBS_KEY = "skuffen.bundle.blobs";
const SETTINGS_KEY = "skuffen.settings";

export function isTauri(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

@Injectable({ providedIn: "root" })
export class IoService {
  constructor() {
    if (!isTauri()) purgeDurableBrowserSecrets();
  }

  async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }

  async getSettings(): Promise<Settings> {
    if (isTauri()) return this.invoke<Settings>("get_settings");
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as Settings) : {};
  }

  async saveSettings(settings: Settings): Promise<void> {
    if (isTauri()) {
      await this.invoke("save_settings", { settings });
      return;
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  async defaultBundleRoot(): Promise<string> {
    if (isTauri()) return this.invoke<string>("default_bundle_root");
    return "localStorage://skuffen-people-graph";
  }

  async pickFolder(): Promise<string | null> {
    if (isTauri()) return this.invoke<string | null>("pick_folder");
    return null;
  }

  async pickImageFile(): Promise<string | null> {
    if (isTauri()) return this.invoke<string | null>("pick_image_file");
    return null;
  }

  async pickDocumentFile(): Promise<string | null> {
    if (isTauri()) return this.invoke<string | null>("pick_document_file");
    return null;
  }

  async ensureBundle(root?: string | null): Promise<string> {
    if (isTauri()) return this.invoke<string>("ensure_bundle", { root: root ?? null });
    const files = this.webFiles();
    if (!files["index.md"]) {
      files["index.md"] =
        "---\nokf_version: \"0.2\"\n---\n\n# Skuffen\n\nLocal personal intelligence. The people-graph lives on this machine as an Open Knowledge Format v0.2 bundle.\n\n# People\n\n*Empty — add a person in Skuffen. Data stays on disk.*\n";
      files["log.md"] =
        "# Directory Update Log\n\n## " +
        new Date().toISOString().slice(0, 10) +
        "\n* **Initialization**: Created Skuffen OKF v0.2 people-graph bundle.\n";
      files["people/index.md"] = "# People\n\n*No people yet.*\n";
      this.setWebFiles(files);
    }
    return root || "localStorage://skuffen-people-graph";
  }

  async listFiles(root: string, prefix?: string): Promise<string[]> {
    if (isTauri()) return this.invoke<string[]>("list_files", { root, prefix: prefix ?? null });
    const paths = new Set([...Object.keys(this.webFiles()), ...Object.keys(this.webBlobs())]);
    return [...paths].filter((path) => !prefix || path.startsWith(prefix)).sort();
  }

  async readText(root: string, path: string): Promise<string | null> {
    if (isTauri()) return this.invoke<string | null>("read_text", { root, path });
    return this.webFiles()[path] ?? null;
  }

  async writeText(root: string, path: string, contents: string): Promise<void> {
    if (isTauri()) {
      await this.invoke("write_text", { root, path, contents });
      return;
    }
    const files = this.webFiles();
    files[path] = contents;
    this.setWebFiles(files);
    const blobs = this.webBlobs();
    if (path in blobs) {
      delete blobs[path];
      this.setWebBlobs(blobs);
    }
  }

  async deleteFile(root: string, path: string): Promise<void> {
    if (isTauri()) {
      await this.invoke("delete_file", { root, path });
      return;
    }
    const files = this.webFiles();
    delete files[path];
    this.setWebFiles(files);
    const blobs = this.webBlobs();
    if (path in blobs) {
      delete blobs[path];
      this.setWebBlobs(blobs);
    }
  }

  async copyFileIntoBundle(root: string, source: string, dest: string): Promise<void> {
    if (isTauri()) {
      await this.invoke("copy_file_into_bundle", { root, source, dest });
      return;
    }
    throw new Error("Copying a disk path needs the Skuffen desktop shell. Drop the file instead.");
  }

  async writeBytes(root: string, path: string, contents: Uint8Array): Promise<void> {
    if (isTauri()) {
      await this.invoke("write_bytes", { root, path, contents: Array.from(contents) });
      return;
    }
    const blobs = this.webBlobs();
    blobs[path] = bytesToBase64(contents);
    this.setWebBlobs(blobs);
    const files = this.webFiles();
    if (path in files) {
      delete files[path];
      this.setWebFiles(files);
    }
  }

  async readBytes(root: string, path: string): Promise<Uint8Array | null> {
    if (isTauri()) {
      const raw = await this.invoke<number[] | null>("read_bytes", { root, path });
      return raw ? Uint8Array.from(raw) : null;
    }
    const blob = this.webBlobs()[path];
    if (blob) return base64ToBytes(blob);
    const text = this.webFiles()[path];
    return text === undefined ? null : new TextEncoder().encode(text);
  }

  async fetchPublicBytes(url: string): Promise<Uint8Array | null> {
    try {
      if (isTauri()) {
        const raw = await this.invoke<number[] | null>("fetch_public_bytes", { url });
        return raw ? Uint8Array.from(raw) : null;
      }
      return await fetchPublicPhotoBytes(url);
    } catch {
      return null;
    }
  }

  /** Public HTML for research photo discovery. Never persisted. Fail closed. */
  async fetchPublicHtml(url: string): Promise<string | null> {
    try {
      if (isTauri()) {
        return await this.invoke<string | null>("fetch_public_html", { url });
      }
      return await fetchPublicHtmlText(url);
    } catch {
      return null;
    }
  }

  async secretGet(key: string): Promise<string | null> {
    if (isTauri()) return this.invoke<string | null>("secret_get", { key });
    return webSecretGet(key);
  }

  async secretSet(key: string, value: string): Promise<void> {
    if (isTauri()) {
      await this.invoke("secret_set", { key, value });
      return;
    }
    webSecretSet(key, value);
  }

  async secretDelete(key: string): Promise<void> {
    if (isTauri()) {
      await this.invoke("secret_delete", { key });
      return;
    }
    webSecretDelete(key);
  }

  async grokOauthBegin(): Promise<GrokDevicePending> {
    if (!isTauri()) throw new Error(BROWSER_OAUTH_ERROR);
    return publicDevicePending(await this.invoke("grok_oauth_begin"));
  }

  async grokOauthWait(): Promise<GrokOAuthStatus> {
    if (!isTauri()) throw new Error(BROWSER_OAUTH_ERROR);
    return publicOauthStatus(await this.invoke("grok_oauth_wait"));
  }

  async grokOauthPoll(): Promise<GrokOAuthPoll> {
    if (!isTauri()) throw new Error(BROWSER_OAUTH_ERROR);
    return publicOauthPoll(await this.invoke("grok_oauth_poll"));
  }

  async grokOauthStatus(): Promise<GrokOAuthStatus> {
    if (isTauri()) return publicOauthStatus(await this.invoke("grok_oauth_status"));
    return { connected: false };
  }

  async grokOauthLogout(): Promise<void> {
    if (isTauri()) {
      await this.invoke("grok_oauth_logout");
    }
  }

  browserVaultStatus(): VaultStatus {
    return {
      available: false,
      unlocked: true,
      encrypted: false,
      keyBackend: "none",
      message: BROWSER_VAULT_MESSAGE,
    };
  }

  async vaultStatus(): Promise<VaultStatus> {
    if (isTauri()) return this.invoke<VaultStatus>("vault_status");
    return this.browserVaultStatus();
  }

  async unlockVault(): Promise<VaultStatus> {
    if (isTauri()) return this.invoke<VaultStatus>("unlock_vault");
    return this.browserVaultStatus();
  }

  async lockVault(): Promise<VaultStatus> {
    if (isTauri()) return this.invoke<VaultStatus>("lock_vault");
    return this.browserVaultStatus();
  }

  async desktopRuntimeInfo(): Promise<DesktopRuntime> {
    if (!isTauri()) {
      throw new Error("Desktop runtime info needs the Skuffen desktop shell.");
    }
    return this.invoke<DesktopRuntime>("desktop_runtime_info");
  }

  async githubPublishedRelease(): Promise<GithubRelease | null> {
    if (!isTauri()) {
      throw new Error("GitHub release checks need the Skuffen desktop shell.");
    }
    return this.invoke<GithubRelease | null>("github_published_release");
  }

  async downloadAndRunInstaller(url: string, fileName: string): Promise<void> {
    if (!isTauri()) {
      throw new Error("Installing an update needs the Skuffen desktop shell.");
    }
    await this.invoke("download_and_run_installer", { url, fileName });
  }

  async exportPlainOkf(root: string): Promise<string | null> {
    if (isTauri()) return this.invoke<string | null>("export_plain_okf", { root });
    const files = this.webFiles();
    const blobs = this.webBlobs();
    const blob = new Blob([JSON.stringify({ okf_version: "0.2", files, blobs }, null, 2)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "skuffen-okf-plaintext-export.json";
    a.click();
    URL.revokeObjectURL(href);
    return "download:skuffen-okf-plaintext-export.json";
  }

  private webFiles(): Record<string, string> {
    const raw = localStorage.getItem(FILES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  }

  private setWebFiles(files: Record<string, string>): void {
    localStorage.setItem(FILES_KEY, JSON.stringify(files));
  }

  private webBlobs(): Record<string, string> {
    const raw = localStorage.getItem(BLOBS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  }

  private setWebBlobs(blobs: Record<string, string>): void {
    localStorage.setItem(BLOBS_KEY, JSON.stringify(blobs));
  }
}

async function fetchPublicHtmlText(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const response = await fetch(url, {
      redirect: "follow",
      credentials: "omit",
      headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (
      type &&
      !type.startsWith("text/html") &&
      !type.startsWith("application/xhtml+xml") &&
      !type.startsWith("text/plain")
    ) {
      return null;
    }
    const text = await response.text();
    if (!text || text.length > 1_500_000) return null;
    return text;
  } catch {
    return null;
  }
}

async function fetchPublicPhotoBytes(url: string): Promise<Uint8Array | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const response = await fetch(url, { redirect: "follow", credentials: "omit" });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (type && !type.startsWith("image/") && !type.startsWith("application/octet-stream")) {
      return null;
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > 8 * 1024 * 1024) return null;
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
