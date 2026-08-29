# Skuffen

Agentic AI Driven Personal Intelligence

Skuffen is **local-only** personal intelligence software. You keep a private people-graph on your own machine: contacts, notes, social links, and photos. There is no Skuffen account, no analytics, and no cloud backend for people data.

The people-graph is stored as an [Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundle. File path is identity. On desktop, tokens for Grok and Gemini live in the OS credential store. They never enter the OKF bundle.

Homepage (later): [https://skuffen.grok.me](https://skuffen.grok.me)

Sole developer: Sondre Bjellås ([sondreb](https://github.com/sondreb)).

## Stack

- Desktop: [Tauri](https://tauri.app) 2 (latest stable), app identifier `me.grok.skuffen`
- UI: [Angular](https://angular.dev) 22 standalone components, TypeScript
- Rust only in the Tauri shell (filesystem, OS keyring, Grok OAuth loopback)
- Gemini via [`@google/genai`](https://github.com/googleapis/js-genai) — Grok is never routed through that SDK
- Package manager: **npm** (`packageManager` in `package.json`)

## Develop

```bash
npm install
npm run tauri dev
```

Node.js 22.22.3+ is required for Angular 22. On Linux, install Tauri's GTK/WebKit packages (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`). Rust 1.98+ is pinned in `rust-toolchain.toml`.

Frontend only (browser preview, localStorage stand-in for the people-graph bundle):

```bash
npm start
```

The browser preview **cannot encrypt the people-graph honestly** — there is no OS keychain in `npm start`. The graph stays in a localStorage stand-in (plaintext). Use `npm run tauri dev` for OS-backed encryption. Grok/Gemini API keys and OAuth tokens still stay in memory for the current tab only. They are never written to `localStorage`, `sessionStorage`, or any other durable browser storage, and they vanish on reload.

OKF / vault / MCP / browser-secret checks:

```bash
npm run test:okf
npm run test:vault
npm run test:mcp
npm run test:secrets
npm run test:version
```

Pull-request CI (`.github/workflows/ci.yml`) runs those checks plus `npm run build` on Node 22.22.3. It does **not** build the Tauri desktop app.

## Draft desktop release

Unsigned Windows, Linux, and macOS installers are built by **Draft desktop release** (`.github/workflows/release.yml`), not by PR CI. The GitHub Release is always `draft: true`. Sondre tests an installer, then publishes. There is no iOS/Android job, no notarization, and no SmartScreen/Play/App Store signing.

- Actions → Draft desktop release → Run workflow. Version input default is **patch**. Or pass `0.1.1` / `minor` / `major`.
- Or push a tag `v0.1.1`.

The workflow keeps versions in lockstep: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`. App identifier stays `me.grok.skuffen`. Installers only — never people-graph data, tokens, or OKF fixtures.

## Storage (OKF v0.2)

Default bundle: the app data directory `people-graph` folder, or a folder you choose.

```
.skuffen-vault.json      # vault sidecar (not secret; no key)
index.md                 # okf_version: "0.2"
log.md
people/
  <slug>/person.md       # type: Person
  <slug>/notes/*.md      # type: Note
  <slug>/social/*.md     # type: SocialProfile
  <slug>/photos/<file>   # photo bytes
  <slug>/photos/<file>.md # type: Photo, resource points at the file
  <slug>/place.md        # type: Place (lat/lng/address pin)
```

Photos are files, not markdown blobs. A person's map pin is a linked `Place` concept (`people/<slug>/place.md`). Suggested facts from Grok or Gemini are written only after you accept them. File path is still identity. On desktop, the *bytes* of those files (markdown, YAML, photos, places) are AES-256-GCM ciphertext.

## People map

The people-graph can be plotted on a map. Search an address or drop a pin from person detail or the map view. **Pins and people stay on disk** in the OKF bundle. They are never sent to a Skuffen cloud backend (there is none). Map tiles and Nominatim geocoding may use the public internet (OpenStreetMap). No analytics.

## Encryption at rest

A stolen laptop should not be a stolen graph. Desktop Skuffen (`npm run tauri dev` or an installer) encrypts every people-graph file in place.

**Why encrypted files, not SQLCipher.** OKF on disk is the product: path is identity, photos are files, MCP and export are folders of markdown. Replacing the graph with a database would hide that until export. Encrypted files keep the tree and only change the bytes.

**Cipher.** AES-256-GCM per file. Header `SKUF1` + version + 12-byte nonce + ciphertext + tag. Additional data is the bundle-relative path, so files cannot be swapped. Closing or locking the app leaves ciphertext on disk.

**Where the key lives.** A 32-byte wrapping key is created on first unlock and stored in the OS credential store:

- Service: `me.grok.skuffen`
- Account: `okf-master-key`
- macOS Keychain, Windows Credential Manager, Linux Secret Service
- If no OS keychain is available, the same 0600 file fallback used for provider tokens (`<app-data>/credentials/okf-master-key.secret`)

Unlock uses your OS login session (the keychain). There is no Skuffen password, no Skuffen account, and no cloud KMS. The people-graph, tokens, and the vault key are never uploaded.

`.skuffen-vault.json` records that the folder is a vault. It is not secret and does not contain the key.

**Browser `npm start`.** Encryption is gated. The preview cannot talk to the OS keychain, so it does not invent a cloud secret store. It keeps the graph in localStorage as a stand-in and tells you to use the desktop app. Tokens still never land in `localStorage`.

**Export plaintext OKF.** Export is an explicit action (rail → Export plaintext OKF). Desktop writes a decrypted OKF v0.2 folder you choose. That export is portable and honest — and plaintext. Do not sync it to a cloud drive if a stolen copy of the graph would matter. The browser preview downloads a JSON map of its localStorage stand-in; that is not OS-backed encryption.

**MCP.** Point `SKUFFEN_BUNDLE` at an exported plaintext folder, or set `SKUFFEN_OKF_KEY` to the base64 vault key from the OS keychain to read the live vault. Never upload that key.

## Providers

- **Grok**: OIDC at `https://auth.x.ai` (PKCE, loopback `http://127.0.0.1:56121/callback`) plus an API-key fallback. Calls `https://api.x.ai/v1`.
- **Gemini**: API key + `@google/genai`.
- If both are connected, pick one in the UI. Default is Grok.
- Prompts include only the person you asked about — never the full graph.

## Local MCP

stdio (optional loopback HTTP) against the same OKF bundle. Setup for Cursor and Claude Desktop: [docs/mcp.md](docs/mcp.md).

```bash
npm run mcp
```

## License

MIT © 2026 SondreB
