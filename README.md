# Skuffen

Agentic AI Driven Personal Intelligence

Skuffen is **local-only** personal intelligence software. You keep a private people-graph on your own machine: contacts, notes, social links, and photos. There is no Skuffen account, no analytics, and no cloud backend for people data.

The people-graph is stored as an [Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundle. File path is identity. Tokens for Grok and Gemini live in the OS credential store, never in the OKF bundle.

Domain (later): [skuffen.no](https://skuffen.no)

## Stack

- Desktop: [Tauri](https://tauri.app) 2 (latest stable)
- UI: [Angular](https://angular.dev) 22 standalone components, TypeScript
- Rust only in the Tauri shell (filesystem, OS keyring, Grok OAuth loopback)
- Package manager: **npm** (`packageManager` in `package.json`)

## Develop

```bash
npm install
npm run tauri dev
```

Frontend only (no desktop shell):

```bash
npm start
```

## Local MCP

The same OKF bundle is exposed to local agents over stdio (optional HTTP). See [docs/mcp.md](docs/mcp.md).

```bash
npm run mcp
```

## License

MIT © 2026 SondreB
