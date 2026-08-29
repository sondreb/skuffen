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

In the browser preview, Grok/Gemini API keys and OAuth tokens stay in memory for the current tab only. They are never written to `localStorage`, `sessionStorage`, or any other durable browser storage, and they vanish on reload. Use `npm run tauri dev` when you want tokens in the OS credential store.

OKF / MCP / browser-secret checks:

```bash
npm run test:okf
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
index.md                 # okf_version: "0.2"
log.md
people/
  <slug>/person.md       # type: Person
  <slug>/notes/*.md      # type: Note
  <slug>/social/*.md     # type: SocialProfile
  <slug>/photos/<file>   # photo bytes
  <slug>/photos/<file>.md # type: Photo, resource points at the file
```

Photos are files, not markdown blobs. Suggested facts from Grok or Gemini are written only after you accept them.

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
