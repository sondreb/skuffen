# Skuffen

Agentic AI Driven Personal Intelligence

Skuffen is **local-only** personal intelligence software. You keep a private people-graph on your own machine: contacts, notes, social links, photos, and documents. There is no Skuffen account, no analytics, and no cloud backend for people data.

The people-graph is stored as an [Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundle. File path is identity. On desktop, tokens for Grok and Gemini live in the OS credential store. They never enter the OKF bundle.

Homepage (later): [https://skuffen.grok.me](https://skuffen.grok.me)

Sole developer: Sondre Bjellås ([sondreb](https://github.com/sondreb)).

## Screenshots

Real Angular web preview (`npm start`) at 1280×720. Synthetic **Ada Demo** data. Grok and Gemini are mocked — no live API keys.

![Empty people drawer in the Skuffen web preview](docs/media/screenshot-drawer.png)

*Hero still. Real browser UI. Synthetic demo data. AI providers mocked.*

![New person form for Ada Demo in the People Drawer](docs/media/screenshot-person.png)

*Add a person. Real browser UI. Synthetic demo data. AI providers mocked.*

![Review cards for researched facts, with Accept selected](docs/media/screenshot-research.png)

*Grok research, you accept. Real browser UI. Synthetic demo data. AI providers mocked. Nothing is written until you accept.*

## Demos

Short walkthroughs of the same real web preview. On-screen labels. Voice-over may be missing. AI providers mocked.

- [What is Skuffen](docs/media/01-what-is-skuffen.mp4)
- [Add a person and a place](docs/media/02-add-person-and-place.mp4)
- [Grok research, you accept](docs/media/03-grok-research-you-accept.mp4)

## Stack

- Desktop: [Tauri](https://tauri.app) 2 (latest stable), app identifier `me.grok.skuffen`
- UI: [Angular](https://angular.dev) 22 standalone components, TypeScript
- Rust only in the Tauri shell (filesystem, OS keyring, Grok OAuth device flow)
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

OKF / vault / MCP / browser-secret / OAuth / research-follow / merge-proposal / update-check checks:

```bash
npm run test:okf
npm run test:vault
npm run test:mcp
npm run test:secrets
npm run test:oauth
npm run test:research
npm run test:merge
npm run test:update
npm run test:version
npm run test:e2e
```

Labeled README stills and MP4s (mocked providers, `?demo=1`):

```bash
npm run demo:record
```

Pull-request CI (`.github/workflows/ci.yml`) runs those checks plus `npm run build` on Node 22.22.3. It does **not** build the Tauri desktop app.

## Draft desktop release

Unsigned Windows, Linux, and macOS installers are built by **Draft desktop release** (`.github/workflows/release.yml`), not by PR CI. Every merge to `main` bumps the patch version in lockstep and opens a new **draft** GitHub Release. `workflow_dispatch` is optional. The GitHub Release is always `draft: true`. Sondre tests an installer, then publishes. There is no iOS/Android job, no notarization, and no SmartScreen/Play/App Store signing.

- Merge to `main`: always bump **patch**, commit `chore: bump version to X.Y.Z` as github-actions[bot], build from that SHA. The bump push itself is skipped (no second matrix).
- Optional: Actions → Draft desktop release → Run workflow. Version input default is **patch**. Or pass `0.1.1` / `minor` / `major`.
- Tag `v*` is skip-safe for tauri-action.

The workflow keeps versions in lockstep: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`. App identifier stays `me.grok.skuffen`. Installers only — never people-graph data, tokens, or OKF fixtures.

Windows NSIS is a per-user one-click overwrite (same folder, no language / directory / start-menu / component pages). macOS replaces the `.app`. Linux uses the existing `.deb` / `.AppImage` targets. The people-graph stays in app data, not next to the exe.

**Check for update** (Latch) looks at the latest **published** GitHub Release for `sondreb/skuffen`. Drafts are invisible to the public API — Sondre still publishes drafts himself. The browser preview (`npm start`) cannot install updates. No GitHub token and no signing private key live in the app or the repo. Nothing from the people-graph is uploaded.

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
documents/
  <slug>/<file>          # document bytes (PDF, images, other docs)
  <slug>/document.md     # type: Document; required title + resource; optional kind / note
```

Photos and documents are files, not markdown blobs. A Document has required `type`, `title`, and `resource` pointing at the file. File path is identity. Land plots are documents (`kind: land-plot`) with a title, file, optional note, and `subjects` linking one or more people. Drop a file onto a person or use Add document — nothing is uploaded.

A person's map pin is a linked `Place` concept (`people/<slug>/place.md`). Suggested facts from Grok or Gemini are written only after you accept them. On desktop, the *bytes* of those files (markdown, YAML, photos, documents, places) are AES-256-GCM ciphertext.

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

- **Grok**: RFC 8628 device authorization at `https://auth.x.ai` (public Grok CLI client, OS keychain `me.grok.skuffen` / `grok_oauth`) plus an API-key fallback for `console.x.ai` developer keys. Calls `https://api.x.ai/v1`. The access token is never shown in the UI.
- **Gemini**: API key + `@google/genai`.
- If both are connected, pick one in the UI. Default is Grok.
- Prompts include only the person you asked about — never the full graph.

## Research and Follow

From a person, **Research with Grok** (or Gemini if you chose it) searches public web info. Results are suggestions. Nothing is written to the OKF bundle until you **Accept** — same gate as v1 Ask.

**Follow** is a local scheduler in the desktop app. Pick a per-person interval (daily, weekly, monthly). While Skuffen is open it re-runs that person’s public search and proposes new facts. It never auto-writes, never auto-sends messages, and never uploads the people-graph. The prompt includes only that person.

Follow schedules and pending proposals live in local app settings, not in the OKF bundle. Latch → **Memory** lists that inspectable store: research suggestions, follow schedules, pending facts, and a deletable log of what the model was told. Public web is treated as hostile until you Accept. Nothing durable is written to the OKF bundle without Accept. Tokens stay in the OS credential store — never `localStorage`, never OKF.

```bash
npm run test:research
```

## Duplicate-person merge

When two cards share a hard identity signal — the same email, phone, or social URL/handle — Skuffen proposes a merge. **Name string alone is never enough.** You review fields from the other card (keep or drop), then Accept, Dismiss, or Keep both.

Nothing is written until you Accept. There is no auto-merge. Dismiss leaves both cards. The browser preview (`npm start ?demo=1`) uses two synthetic cards (`Ada Demo` / `Ada Demo Twin`) so the same gate is visible without API keys.

```bash
npm run test:merge
```

## Local MCP

stdio (optional loopback HTTP) against the same OKF bundle. Setup for Cursor and Claude Desktop: [docs/mcp.md](docs/mcp.md).

```bash
npm run mcp
```

## Docs

- [Software factory (Grok Bot)](docs/software-factory.md) — stand up a similar factory
- [Local MCP](docs/mcp.md)

## License

MIT © 2026 SondreB
